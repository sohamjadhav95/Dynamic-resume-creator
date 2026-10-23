import base64
import binascii
import json
import logging
import time
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
from .fileedit.screen import screen_edits
from .fileedit.style import detect_style
from .limits import consume
from .schemas import (
    FileFixOutput,
    FileRenderRequest,
    FileTailorOutput,
    FileTailorRequest,
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


# ------------------------------------------------------------------ uploaded files (keep the original design)


class FileProblem(Exception):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


@app.exception_handler(FileProblem)
async def file_problem(_: Request, exc: FileProblem):
    return JSONResponse({"error": exc.message}, status_code=exc.status)


def decode_file(b64: str) -> bytes:
    try:
        data = base64.b64decode(b64, validate=False)
    except (binascii.Error, ValueError) as exc:
        raise FileProblem("That file could not be read. Please upload it again.") from exc
    if len(data) > fileedit.MAX_FILE_BYTES:
        raise FileProblem("That file is over 3 MB. Please upload a smaller PDF or Word file.")
    return data


async def read_file(file_type: str, data: bytes) -> fileedit.Extracted:
    try:
        return await run_in_threadpool(fileedit.extract, file_type, data)
    except Exception as exc:
        log.warning("file.extract_failed type=%s error=%r", file_type, exc)
        raise FileProblem("We couldn't read this file. If it is a scanned image, paste the text instead.") from exc


@app.post("/api/file/extract")
async def file_extract(req: FileUploadRequest):
    """Checks an uploaded resume and returns its text. The browser keeps the file itself."""
    data = decode_file(req.file_base64)
    file_type = fileedit.file_type_of(req.filename, data)
    if not file_type:
        raise FileProblem("Please upload a PDF (.pdf) or Word (.docx) file.")
    extracted = await read_file(file_type, data)
    if len(extracted.text.strip()) < 40:
        raise FileProblem("This file has almost no readable text (it may be a scanned image). Paste the text instead.")
    return {
        "file_type": file_type,
        "pages": extracted.pages,
        "text": extracted.text,
        "editable": len(extracted.segments),
        "font": extracted.font,
        "style": await run_in_threadpool(detect_style, file_type, data),
    }


@app.post("/api/file/render")
async def file_render(req: FileRenderRequest):
    """Writes a list of text changes into the original file. No AI involved."""
    data = decode_file(req.file_base64)
    edits = {e.id: e.text for e in req.edits if e.text.strip()}
    try:
        out, results = await run_in_threadpool(fileedit.apply, req.file_type, data, edits)
    except Exception as exc:
        log.exception("file.render_failed: %r", exc)
        raise FileProblem("We couldn't update this file. Please try again.", 500) from exc
    return {"file_base64": base64.b64encode(out).decode("ascii"), "results": [r.to_dict() for r in results]}


@app.post("/api/file/tailor")
async def file_tailor(req: FileTailorRequest, request: Request):
    """AI rewrites lines of the uploaded file in place; streams progress, then the finished file."""
    settings = get_settings()
    identity = await get_identity(request)
    own_key = user_key(request)
    data = decode_file(req.file_base64)
    extracted = await read_file(req.file_type, data)
    if not extracted.segments:
        raise FileProblem("We couldn't find bullet points or a summary to rewrite in this file.")
    info = extracted.to_dict()
    segments = {s["id"]: s for s in info["segments"]}
    order = {item["id"]: i for i, item in enumerate(info["outline"])}

    async def events() -> AsyncIterator[str]:
        yield ": connected\n\n"
        limited = await quota_or_none(identity, "tailor", own_key)
        if limited:
            yield sse(Event("limit", limited))
            return
        attempts = build_attempts(settings, own_key)
        if not attempts:
            yield sse(Event("fallback", {"reasons": ["No AI service is configured."]}))
            return
        started = time.monotonic()
        final: Event | None = None
        async for event in run_chain(
            attempts,
            prompts.file_tailor_system(req.options),
            prompts.file_tailor_prompt(info, req.job_description),
            FileTailorOutput,
            temperature=0.3,
            stall_seconds=settings.ai_stall_seconds,
            total_deadline_seconds=settings.ai_total_deadline_seconds - 30,
            heartbeat_seconds=settings.heartbeat_seconds,
        ):
            if event.type == "result":
                final = event
            else:
                yield sse(event)
        if final is None:
            return  # the fallback event was already sent

        ai = final.data["data"]
        yield sse(Event("checking", {}))
        edits = {e["id"]: e["text"] for e in ai["edits"] if e["id"] in segments}

        async def write(edits: dict[str, str]) -> tuple[bytes, list[fileedit.EditResult]]:
            allowed, refused = screen_edits(info, edits)  # no borrowed tools, no skills you don't have
            out, results = await run_in_threadpool(fileedit.apply, req.file_type, data, allowed)
            return out, results + refused

        out, results = await write(edits)

        # One more short AI round for lines whose rewrite was too long or too short.
        failed = [r for r in results if r.status in ("too_long", "too_short", "changed_facts")]
        remaining = settings.ai_total_deadline_seconds - (time.monotonic() - started)
        if failed and remaining > 45:
            items = []
            for r in failed:
                seg = segments[r.id]
                _aim, lo, hi = prompts.char_range(seg["text"], seg["min_chars"], seg["max_chars"])
                items.append({"id": r.id, "old": r.old, "tried": r.new, "lo": lo, "hi": hi, "problem": r.note})
            fixed: Event | None = None
            async for event in run_chain(
                build_attempts(settings, own_key, quick=True),
                prompts.FILE_FIX_SYSTEM,
                prompts.file_fix_prompt(items),
                FileFixOutput,
                temperature=0.4,
                stall_seconds=40,
                total_deadline_seconds=min(90, remaining - 15),
                heartbeat_seconds=settings.heartbeat_seconds,
                prefer_model=final.data["model"],
            ):
                if event.type == "result":
                    fixed = event
                elif event.type == "heartbeat":
                    yield sse(event)
            log.info("file.tailor_retry asked=%d answered=%s", len(items), fixed is not None)
            if fixed is not None:
                retry = {e["id"]: e["text"] for e in fixed.data["data"]["edits"] if e["id"] in edits}
                if retry:
                    edits.update(retry)
                    out, results = await write(edits)

        applied = [{"id": r.id, "text": r.new} for r in results if r.status == "applied"]
        log.info(
            "file.tailor type=%s segments=%d applied=%d refused=%d",
            req.file_type,
            len(segments),
            len(applied),
            sum(r.status in ("too_long", "too_short", "changed_facts") for r in results),
        )
        payload = {
            "job": ai["job"],
            "keywords": ai["keywords"],
            "project_ideas": ai["project_ideas"],
            "advice": ai["advice"],
            "edits": applied,
            "results": [r.to_dict() for r in sorted(results, key=lambda r: order.get(r.id, 9999))],
            "file_base64": base64.b64encode(out).decode("ascii"),
        }
        yield sse(
            Event(
                "result",
                {
                    "engine": final.data["engine"],
                    "model": final.data["model"],
                    "seconds": round(time.monotonic() - started, 1),
                    "data": payload,
                },
            )
        )

    return stream_response(events())
