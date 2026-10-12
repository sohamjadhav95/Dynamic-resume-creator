import asyncio
import json

from pydantic import BaseModel

from backend.ai.providers import Chunk, ProviderError
from backend.ai.router import Attempt, collect, parse_json_text, run_chain


class Out(BaseModel):
    answer: str


GOOD = json.dumps({"answer": "ok"})


class FakeProvider:
    """Scripted provider: `script` is a list of (delay_seconds, chunk | exception)."""

    def __init__(self, name, script, streams=True):
        self.name = name
        self.label = name.title()
        self.streams = streams
        self.script = script
        self.calls: list[str] = []

    async def stream(self, model, system, prompt, schema, temperature):
        self.calls.append(model)
        for delay, item in self.script:
            await asyncio.sleep(delay)
            if isinstance(item, Exception):
                raise item
            yield item


def text(s, delay=0.0):
    return (delay, Chunk("text", s))


async def run(attempts, **kw):
    kw.setdefault("stall_seconds", 0.3)
    kw.setdefault("heartbeat_seconds", 0.05)
    kw.setdefault("total_deadline_seconds", 10)
    kw.setdefault("min_attempt_seconds", 0)
    events = [e async for e in run_chain(attempts, "sys", "prompt", Out, **kw)]
    return events, events[-1]


async def test_first_provider_success():
    gemini = FakeProvider("gemini", [text(GOOD[:5]), text(GOOD[5:])])
    _, final = await run([Attempt(gemini, ["m1"], 5)])
    assert final.type == "result"
    assert final.data["engine"] == "gemini"
    assert final.data["data"] == {"answer": "ok"}


async def test_error_falls_through_to_groq():
    gemini = FakeProvider("gemini", [(0, ProviderError("503", retry_same_provider=False))])
    groq = FakeProvider("groq", [text(GOOD)], streams=False)
    _, final = await run([Attempt(gemini, ["m1", "m2"], 5), Attempt(groq, ["g1"], 5)])
    assert final.data["engine"] == "groq"
    assert gemini.calls == ["m1"]  # non-retryable error skips the provider's other models


async def test_retryable_error_tries_next_model():
    calls = iter([ProviderError("429", retry_same_provider=True), None])

    class Flaky(FakeProvider):
        async def stream(self, model, *a):
            self.calls.append(model)
            err = next(calls)
            if err:
                raise err
            yield Chunk("text", GOOD)

    gemini = Flaky("gemini", [])
    _, final = await run([Attempt(gemini, ["m1", "m2"], 5)])
    assert final.type == "result" and final.data["model"] == "m2"


async def test_slow_but_streaming_provider_is_not_abandoned():
    # Total time (~0.8s) is far beyond the stall limit (0.3s), but chunks keep arriving.
    script = [text(c, delay=0.2) for c in GOOD]
    gemini = FakeProvider("gemini", script)
    groq = FakeProvider("groq", [text(GOOD)], streams=False)
    events, final = await run([Attempt(gemini, ["m1"], 30), Attempt(groq, ["g1"], 5)], stall_seconds=0.3)
    assert final.data["engine"] == "gemini"
    assert groq.calls == []
    assert any(e.type == "heartbeat" for e in events)


async def test_thoughts_count_as_activity():
    script = [(0.2, Chunk("thought", "reading")), (0.2, Chunk("thought", "planning")), text(GOOD, 0.2)]
    gemini = FakeProvider("gemini", script)
    events, final = await run([Attempt(gemini, ["m1"], 30)], stall_seconds=0.3)
    assert final.type == "result"
    assert [e.data["text"] for e in events if e.type == "thought"] == ["reading", "planning"]


async def test_silent_provider_triggers_stall_fallback():
    gemini = FakeProvider("gemini", [text(GOOD, delay=5)])
    groq = FakeProvider("groq", [text(GOOD)], streams=False)
    _, final = await run([Attempt(gemini, ["m1"], 30), Attempt(groq, ["g1"], 5)], stall_seconds=0.3)
    assert final.data["engine"] == "groq"


async def test_invalid_json_moves_on():
    gemini = FakeProvider("gemini", [text("not json")])
    groq = FakeProvider("groq", [text(GOOD)], streams=False)
    _, final = await run([Attempt(gemini, ["m1"], 5), Attempt(groq, ["g1"], 5)])
    assert final.data["engine"] == "groq"


async def test_everything_down_returns_fallback():
    gemini = FakeProvider("gemini", [(0, ProviderError("down"))])
    groq = FakeProvider("groq", [(0, ProviderError("down"))], streams=False)
    _, final = await run([Attempt(gemini, ["m1"], 5), Attempt(groq, ["g1"], 5)])
    assert final.type == "fallback"
    assert len(final.data["reasons"]) == 2


async def test_unexpected_exception_is_contained():
    gemini = FakeProvider("gemini", [(0, RuntimeError("sdk bug"))])
    final = await collect(
        run_chain([Attempt(gemini, ["m1"], 5)], "s", "p", Out, stall_seconds=1, min_attempt_seconds=0)
    )
    assert final.type == "fallback"


def test_parse_json_text_handles_fences_and_noise():
    assert parse_json_text('```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json_text('Here you go: {"a": 2} thanks') == {"a": 2}
