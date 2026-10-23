import base64
import binascii
import json
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

from . import fileedit, prompts
from .ai.providers import GeminiProvider, GroqProvider
from .ai.router import Attempt, Event, collect, run_chain
from .auth import Identity, get_identity
from .config import Settings, get_settings
from .limits import consume
from .schemas import (
    FileRenderRequest,
    FileUploadRequest,
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


def build_attempts(
    settings: Settings, user_gemini_key: str | None, quick: bool = False, long_answer: bool = False
) -> list[Attempt]:
    """The models to try, in the order of AI_CHAIN (providers without a key are skipped)."""
    gemini_budget = settings.ai_gemini_budget_seconds if not quick else 45
    groq_budget = settings.ai_groq_budget_seconds if not quick else 25
    if user_gemini_key:
        # Own key: only their Gemini, so our shared keys are never used without a quota.
        return [Attempt(GeminiProvider(user_gemini_key), settings.gemini_models, gemini_budget)]
    attempts: list[Attempt] = []
    for spec in settings.ai_chain:
        provider, _, model = spec.partition(":")
        if provider == "groq" and settings.groq_api_key and model:
            attempts.append(Attempt(GroqProvider(settings.groq_api_key, timeout=groq_budget), [model], groq_budget))
        elif provider == "gemini" and settings.gemini_api_key and model:
            attempts.append(Attempt(GeminiProvider(settings.gemini_api_key), [model], gemini_budget))
    if long_answer:
        # Groq's free tier lets qwen write only ~1000 tokens a minute: too little for a whole tailored
        # resume, so it refuses at once. Ask it last for long answers.
        attempts.sort(key=lambda a: a.provider.name == "groq" and a.models[0].startswith("qwen/"))
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
        attempts = build_attempts(settings, own_key, long_answer=kind == "tailor")
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
        prompts.tailor_prompt(req.resume, req.job_description, req.limits),
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


# ------------------------------------------------------------------ uploaded PDFs (edited in place)


class FileProblem(Exception):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


@app.exception_handler(FileProblem)
async def file_problem(_: Request, exc: FileProblem):
    return JSONResponse({"error": exc.message}, status_code=exc.status)


def decode_pdf(b64: str) -> bytes:
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise FileProblem("That file could not be read. Please upload it again.") from exc
    if len(data) > fileedit.MAX_FILE_BYTES:
        raise FileProblem("That file is over 3 MB. Please upload a smaller PDF.")
    if not fileedit.is_pdf(data):
        raise FileProblem("Please upload a PDF file.")
    return data


@app.post("/api/file/extract")
async def file_extract(req: FileUploadRequest):
    """The PDF's text (for the AI) and its text blocks with positions (for editing on the page)."""
    data = decode_pdf(req.file_base64)
    try:
        info = await run_in_threadpool(fileedit.extract, data)
    except Exception as exc:
        log.warning("file.extract_failed error=%r", exc)
        raise FileProblem("We couldn't read this file. If it is a scanned image, paste the text instead.") from exc
    if len(info["text"].strip()) < 40:
        raise FileProblem("This file has almost no readable text (it may be a scanned image). Paste the text instead.")
    return info


@app.post("/api/file/render")
async def file_render(req: FileRenderRequest):
    """Writes text changes into the original PDF. No AI involved."""
    data = decode_pdf(req.file_base64)
    try:
        out, results = await run_in_threadpool(fileedit.apply, data, {e.id: e.text for e in req.edits})
        sheets = None
        if req.paper:
            out, sheets = await run_in_threadpool(fileedit.fit_to_paper, out, req.paper, req.fit)
    except Exception as exc:
        log.exception("file.render_failed: %r", exc)
        raise FileProblem("We couldn't update this file. Please try again.", 500) from exc
    return {"file_base64": base64.b64encode(out).decode("ascii"), "results": results, "sheets": sheets}
