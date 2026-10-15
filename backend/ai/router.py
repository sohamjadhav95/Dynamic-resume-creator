"""Runs an AI task across providers until one succeeds.

Rules (see README "How the AI fallback works"):
- A provider is abandoned only when it errors, returns invalid JSON, sends nothing at all for
  `stall_seconds`, or uses up its whole budget. Being slow but active is fine.
- While we wait we emit heartbeats so the browser connection stays open and the UI stays live.
- When every provider fails we emit `fallback`; the browser then runs the offline engine.
"""

import asyncio
import json
import logging
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from pydantic import BaseModel, ValidationError

from .providers import Provider, ProviderError

log = logging.getLogger("resume.ai")

MIN_ATTEMPT_SECONDS = 15  # don't start an attempt that can't realistically finish
BUSY_WAIT_SECONDS = 4  # pause before retrying a model that answered "503 busy"
COOLDOWN_SECONDS = 90  # a model that was busy or rate-limited is tried last for this long

# (provider, model) -> time until which it is "cooling down". Lives as long as the server process,
# so requests handled by the same warm instance learn from each other.
_cooldown: dict[tuple[str, str], float] = {}


def note_busy(provider: str, model: str) -> None:
    _cooldown[(provider, model)] = time.monotonic() + COOLDOWN_SECONDS


def ordered_models(provider: str, models: list[str], prefer: str | None = None) -> list[str]:
    """Healthy models first (keeping the configured order), then ones that were busy a moment ago."""
    now = time.monotonic()
    healthy = [m for m in models if _cooldown.get((provider, m), 0) <= now]
    cooling = [m for m in models if m not in healthy]
    ordered = healthy + cooling
    if prefer in ordered:
        ordered.remove(prefer)
        ordered.insert(0, prefer)
    return ordered


@dataclass
class Attempt:
    provider: Provider
    models: list[str]
    budget_seconds: float


@dataclass
class Event:
    type: str  # stage | thought | progress | heartbeat | result | fallback
    data: dict = field(default_factory=dict)


def parse_json_text(text: str) -> dict:
    """Parse model output, tolerating ```json fences or text around the object."""
    text = text.strip()
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.S)
    if fenced:
        text = fenced.group(1)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start : end + 1])
        raise


async def run_chain(
    attempts: list[Attempt],
    system: str,
    prompt: str,
    schema: type[BaseModel],
    *,
    temperature: float = 0.2,
    stall_seconds: float = 90,
    total_deadline_seconds: float = 285,
    heartbeat_seconds: float = 10,
    min_attempt_seconds: float = MIN_ATTEMPT_SECONDS,
    busy_wait: float = BUSY_WAIT_SECONDS,
    prefer_model: str | None = None,
) -> AsyncIterator[Event]:
    started = time.monotonic()
    deadline = started + total_deadline_seconds
    reasons: list[str] = []

    for attempt in attempts:
        provider = attempt.provider
        provider_deadline = min(time.monotonic() + attempt.budget_seconds, deadline)

        for model in ordered_models(provider.name, attempt.models, prefer_model):
            if provider_deadline - time.monotonic() < min_attempt_seconds:
                break
            yield Event("stage", {"provider": provider.name, "label": provider.label, "model": model})
            for try_no in range(2):
                outcome: dict = {}
                async for event in _run_one(
                    provider,
                    model,
                    system,
                    prompt,
                    schema,
                    temperature,
                    stall_seconds=stall_seconds,
                    deadline=provider_deadline,
                    heartbeat_seconds=heartbeat_seconds,
                    outcome=outcome,
                ):
                    yield event
                busy = outcome.get("status") == 503 and "result" not in outcome
                if not busy or try_no == 1 or provider_deadline - time.monotonic() < min_attempt_seconds + busy_wait:
                    break
                # "Busy right now" is usually over in seconds: wait once before using a weaker model.
                log.info("ai.busy_retry provider=%s model=%s wait=%ss", provider.name, model, busy_wait)
                yield Event("heartbeat", {"waiting": 0})
                await asyncio.sleep(busy_wait)
            if "result" in outcome:
                elapsed = round(time.monotonic() - started, 1)
                log.info("ai.success provider=%s model=%s seconds=%s", provider.name, model, elapsed)
                yield Event(
                    "result",
                    {"engine": provider.name, "model": model, "seconds": elapsed, "data": outcome["result"]},
                )
                return
            reason = outcome.get("reason", "unknown error")
            reasons.append(reason)
            if outcome.get("status") in (429, 503) or "no response" in reason:
                note_busy(provider.name, model)
            log.warning("ai.attempt_failed provider=%s model=%s reason=%s", provider.name, model, reason)
            if not outcome.get("retry_same_provider"):
                break
            yield Event("stage", {"provider": provider.name, "label": provider.label, "retry": True})

    log.error("ai.all_failed reasons=%s", reasons)
    yield Event("fallback", {"reasons": reasons[-3:]})


async def _run_one(
    provider: Provider,
    model: str,
    system: str,
    prompt: str,
    schema: type[BaseModel],
    temperature: float,
    *,
    stall_seconds: float,
    deadline: float,
    heartbeat_seconds: float,
    outcome: dict,
) -> AsyncIterator[Event]:
    chunks: list[str] = []
    stream = provider.stream(model, system, prompt, schema, temperature).__aiter__()
    last_activity = time.monotonic()
    pending: asyncio.Task | None = None
    try:
        while True:
            if pending is None:
                pending = asyncio.ensure_future(stream.__anext__())
            now = time.monotonic()
            if now >= deadline:
                outcome.update(reason="time budget used up", retry_same_provider=False)
                return
            if provider.streams and now - last_activity >= stall_seconds:
                outcome.update(reason=f"no response for {int(stall_seconds)}s", retry_same_provider=False)
                return
            wait_for = min(heartbeat_seconds, deadline - now)
            if provider.streams:
                wait_for = min(wait_for, stall_seconds - (now - last_activity))
            done, _ = await asyncio.wait({pending}, timeout=max(wait_for, 0.01))
            if not done:
                yield Event("heartbeat", {"waiting": round(time.monotonic() - last_activity)})
                continue
            task, pending = pending, None
            try:
                chunk = task.result()
            except StopAsyncIteration:
                break
            except ProviderError as exc:
                outcome.update(reason=str(exc), retry_same_provider=exc.retry_same_provider, status=exc.status)
                return
            except Exception as exc:  # unexpected SDK error: treat like a provider failure
                outcome.update(reason=f"{type(exc).__name__}: {exc}", retry_same_provider=True)
                return
            last_activity = time.monotonic()
            if chunk.kind == "thought":
                yield Event("thought", {"text": chunk.text[-400:]})
            else:
                chunks.append(chunk.text)
                yield Event("progress", {"chars": sum(len(c) for c in chunks)})

        text = "".join(chunks)
        try:
            outcome["result"] = schema.model_validate(parse_json_text(text)).model_dump()
        except (json.JSONDecodeError, ValidationError) as exc:
            outcome.update(reason=f"invalid output: {str(exc)[:200]}", retry_same_provider=True)
    finally:
        if pending is not None:
            pending.cancel()
            try:
                await pending
            except BaseException:  # CancelledError or the provider's own error
                pass
        aclose = getattr(stream, "aclose", None)
        if aclose:
            try:
                await aclose()
            except Exception:  # closing a cancelled stream can raise; nothing to do
                pass


async def collect(events: AsyncIterator[Event]) -> Event:
    """Run a chain to the end and return only the final result/fallback event."""
    final = Event("fallback", {})
    async for event in events:
        if event.type in ("result", "fallback"):
            final = event
    return final
