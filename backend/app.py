import base64
import json
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import prompts
from .ai.providers import GeminiProvider, GroqProvider
from .ai.router import Attempt, Event, collect, run_chain
from .auth import Identity, get_identity
from .config import Settings, get_settings
from .converter import convert_pdf_to_docx_bytes, extract_docx_text, update_docx_bullets
from .limits import consume
from .schemas import (
    DocTailorRequest,
    ParsedResume,
    ParseRequest,
    RewriteOutput,
    RewriteRequest,
    TailorOutput,
    TailorRequest,
)

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
log = logging.getLogger("resume.api")

app = FastAPI(title="Resume Tailor API", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["authorization", "content-type", "x-gemini-key"],
)

LIMIT_MESSAGES = {
    "guest": "You've used today's free AI runs. Sign in for more, or use the quick (offline) version.",
    "user": "You've reached today's AI limit. Add your own Gemini key in Settings, or use the quick (offline) version.",
}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Cache-Control"] = response.headers.get("Cache-Control", "no-store")
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "request"
    message = first.get("msg", "Invalid request")
    if field == "job_description" and "at least" in message:
        message = "Paste a longer job description (at least a few sentences)."
    elif field == "job_description":
        message = "That job description is too long. Paste only the job post itself."
    return JSONResponse({"error": f"{message}", "field": field}, status_code=422)


@app.exception_handler(Exception)
async def unexpected_error(_: Request, exc: Exception):
    log.exception("unhandled error: %r", exc)
    return JSONResponse({"error": "Something went wrong on our side. Please try again."}, status_code=500)


# ------------------------------------------------------------------ helpers


def build_attempts(settings: Settings, user_gemini_key: str | None, quick: bool = False) -> list[Attempt]:
    attempts: list[Attempt] = []
    gemini_budget = settings.ai_gemini_budget_seconds if not quick else 45
    groq_budget = settings.ai_groq_budget_seconds if not quick else 25
    if user_gemini_key:
        # Own key: only their Gemini, so our shared keys are never used without a quota.
        return [Attempt(GeminiProvider(user_gemini_key), settings.gemini_models, gemini_budget)]
    if settings.gemini_api_key:
        attempts.append(Attempt(GeminiProvider(settings.gemini_api_key), settings.gemini_models, gemini_budget))
    if settings.groq_api_key:
        attempts.append(
            Attempt(GroqProvider(settings.groq_api_key, timeout=groq_budget), settings.groq_models, groq_budget)
        )
    return attempts


def user_key(request: Request) -> str | None:
    key = request.headers.get("x-gemini-key", "").strip()
    return key if 20 <= len(key) <= 200 else None


def sse(event: Event) -> str:
    if event.type == "heartbeat":
        return ": keep-alive\n\n"
    return f"event: {event.type}\ndata: {json.dumps(event.data, ensure_ascii=False)}\n\n"


async def quota_or_none(identity: Identity, kind: str, own_key: str | None) -> dict | None:
    """Returns an error payload when the person is over their daily limit."""
    if own_key:
        return None
    quota = await consume(identity, kind)
    if quota.allowed:
        return None
    return {"message": LIMIT_MESSAGES["guest" if identity.is_guest else "user"], "limit": quota.limit}


def stream_response(events: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        events,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


async def stream_chain(request: Request, kind: str, system: str, prompt: str, schema, temperature: float):
    settings = get_settings()
    identity = await get_identity(request)
    own_key = user_key(request)

    async def events() -> AsyncIterator[str]:
        yield ": connected\n\n"
        limited = await quota_or_none(identity, kind, own_key)
        if limited:
            yield sse(Event("limit", limited))
            return
        attempts = build_attempts(settings, own_key)
        if not attempts:
            yield sse(Event("fallback", {"reasons": ["No AI service is configured."]}))
            return
        async for event in run_chain(
            attempts,
            system,
            prompt,
            schema,
            temperature=temperature,
            stall_seconds=settings.ai_stall_seconds,
            total_deadline_seconds=settings.ai_total_deadline_seconds,
            heartbeat_seconds=settings.heartbeat_seconds,
        ):
            yield sse(event)

    return stream_response(events())


# ------------------------------------------------------------------ routes


@app.get("/api/health")
async def health():
    s = get_settings()
    return {
        "ok": True,
        "ai": {"gemini": bool(s.gemini_api_key), "groq": bool(s.groq_api_key)},
        "accounts": s.supabase_enabled,
    }


@app.get("/api/config")
async def public_config():
    """Public settings for the browser (the anon key is designed to be public)."""
    s = get_settings()
    return JSONResponse(
        {
            "supabase": {"url": s.supabase_url, "anonKey": s.supabase_anon_key} if s.supabase_enabled else None,
            "ai": {"gemini": bool(s.gemini_api_key), "groq": bool(s.groq_api_key)},
            "limits": s.limits,
        },
        headers={"Cache-Control": "public, max-age=300"},
    )


@app.post("/api/tailor")
async def tailor(req: TailorRequest, request: Request):
    return await stream_chain(
        request,
        "tailor",
        prompts.tailor_system(req.options),
        prompts.tailor_prompt(req.resume, req.job_description),
        TailorOutput,
        temperature=0.3,
    )


@app.post("/api/parse")
async def parse(req: ParseRequest, request: Request):
    return await stream_chain(
        request, "parse", prompts.PARSE_SYSTEM, prompts.parse_prompt(req.text), ParsedResume, temperature=0.0
    )


@app.post("/api/rewrite")
async def rewrite(req: RewriteRequest, request: Request):
    identity = await get_identity(request)
    own_key = user_key(request)
    limited = await quota_or_none(identity, "rewrite", own_key)
    if limited:
        return JSONResponse({"error": limited["message"]}, status_code=429)
    attempts = build_attempts(get_settings(), own_key, quick=True)
    if not attempts:
        return JSONResponse({"error": "AI rewriting is not available right now."}, status_code=503)
    final = await collect(
        run_chain(
            attempts,
            prompts.rewrite_system(),
            prompts.rewrite_prompt(req.text, req.mode, req.keyword, req.context, req.job_description),
            RewriteOutput,
            temperature=0.7,
            stall_seconds=40,
            total_deadline_seconds=80,
        )
    )
    if final.type != "result":
        return JSONResponse({"error": "AI is busy right now. Please try again in a minute."}, status_code=503)
    options = [o.strip().strip('"') for o in final.data["data"]["options"] if o.strip()][:3]
    return {"options": options, "engine": final.data["engine"]}


@app.post("/api/convert-doc")
async def convert_doc(file: UploadFile = File(...)):
    """Upload a PDF or Word (.docx) resume. Converts PDF to Word DOCX preserving layout and format."""
    filename = file.filename or "resume.pdf"
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        return JSONResponse({"error": "File size exceeds 10MB limit."}, status_code=400)

    try:
        if filename.lower().endswith(".pdf"):
            docx_bytes = convert_pdf_to_docx_bytes(content)
            docx_name = filename.rsplit(".", 1)[0] + ".docx"
        elif filename.lower().endswith(".docx"):
            docx_bytes = content
            docx_name = filename
        else:
            return JSONResponse({"error": "Please upload a PDF (.pdf) or Word (.docx) file."}, status_code=400)

        extracted_text = extract_docx_text(docx_bytes)
        b64_doc = base64.b64encode(docx_bytes).decode("utf-8")
        return {
            "ok": True,
            "filename": docx_name,
            "text": extracted_text,
            "docx_base64": b64_doc,
        }
    except Exception as e:
        log.exception("Error converting document: %r", e)
        return JSONResponse({"error": f"Failed to convert document: {str(e)}"}, status_code=500)


@app.post("/api/tailor-doc")
async def tailor_doc(req: DocTailorRequest):
    """Updates a DOCX resume in-place with tailored bullets, keeping fonts, layout, and styles intact."""
    try:
        docx_bytes = base64.b64decode(req.docx_base64)
        replacements = [r.model_dump() for r in req.replacements]
        updated_bytes = update_docx_bullets(docx_bytes, replacements)
        return {
            "ok": True,
            "docx_base64": base64.b64encode(updated_bytes).decode("utf-8"),
        }
    except Exception as e:
        log.exception("Error tailoring doc: %r", e)
        return JSONResponse({"error": f"Failed to update document: {str(e)}"}, status_code=500)
