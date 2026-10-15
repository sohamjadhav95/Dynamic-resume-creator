"""AI providers. Each one streams chunks of text (and, when available, 'thought' progress)."""

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Literal, Protocol

import httpx
from pydantic import BaseModel

from ..prompts import json_instructions


@dataclass
class Chunk:
    kind: Literal["text", "thought"]
    text: str


class ProviderError(Exception):
    """A provider failed. `retry_same_provider` = worth trying the provider's next model."""

    def __init__(self, message: str, *, retry_same_provider: bool = False, status: int | None = None):
        super().__init__(message)
        self.retry_same_provider = retry_same_provider
        self.status = status


class Provider(Protocol):
    name: str
    label: str
    streams: bool  # False = sends the whole answer at the end (no stall detection)

    def stream(
        self, model: str, system: str, prompt: str, schema: type[BaseModel], temperature: float
    ) -> AsyncIterator[Chunk]: ...


# ------------------------------------------------------------------ Gemini


class GeminiProvider:
    name = "gemini"
    label = "Gemini"
    streams = True

    def __init__(self, api_key: str):
        self.api_key = api_key

    async def stream(self, model, system, prompt, schema, temperature):
        from google import genai
        from google.genai import errors, types

        client = genai.Client(api_key=self.api_key)
        config = types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_schema=schema,
            temperature=temperature,
            # Thought summaries keep the stream alive and show progress while the model thinks.
            thinking_config=types.ThinkingConfig(include_thoughts=True),
        )
        try:
            response = await client.aio.models.generate_content_stream(model=model, contents=prompt, config=config)
            async for part_response in response:
                for candidate in part_response.candidates or []:
                    content = candidate.content
                    for part in content.parts if content and content.parts else []:
                        if not part.text:
                            continue
                        yield Chunk("thought" if part.thought else "text", part.text)
        except errors.APIError as exc:
            code = getattr(exc, "code", None)
            # 404 unknown model, 429 quota on this model, 5xx overloaded: another model may work.
            # 400/401/403 (bad key, bad request) will fail the same on every model.
            retry = code in (404, 429) or (code is not None and code >= 500)
            raise ProviderError(
                f"Gemini {model}: {code} {exc.message or ''}".strip(), retry_same_provider=retry, status=code
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(f"Gemini {model}: network error {exc!r}", retry_same_provider=True) from exc


# ------------------------------------------------------------------ Groq (OpenAI-compatible)


class GroqProvider:
    name = "groq"
    label = "Groq"
    streams = False  # JSON mode + streaming is not reliable on Groq; it is fast anyway.

    url = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(self, api_key: str, timeout: float = 60):
        self.api_key = api_key
        self.timeout = timeout

    async def stream(self, model, system, prompt, schema, temperature):
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": system + json_instructions(schema.model_json_schema())},
                {"role": "user", "content": prompt},
            ],
            "temperature": temperature,
            "response_format": {"type": "json_object"},
            # Without a cap Groq estimates the answer length itself and can refuse the request on its
            # free-tier output-tokens-per-minute limit. 4096 is accepted and is plenty for our JSON.
            "max_tokens": 4096,
        }
        if model.startswith("qwen/"):
            body["reasoning_effort"] = "none"  # answer directly; thinking only slows this task down
        if model.startswith("openai/gpt-oss"):
            body["reasoning_effort"] = "low"
            body["include_reasoning"] = False
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.post(self.url, json=body, headers={"Authorization": f"Bearer {self.api_key}"})
        except httpx.HTTPError as exc:
            raise ProviderError(f"Groq {model}: network error {exc!r}", retry_same_provider=True) from exc
        if res.status_code != 200:
            # Only a bad key fails identically on every model.
            retry = res.status_code not in (401, 403)
            raise ProviderError(
                f"Groq {model}: {res.status_code} {res.text[:200]}", retry_same_provider=retry, status=res.status_code
            )
        try:
            text = res.json()["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, json.JSONDecodeError) as exc:
            raise ProviderError(f"Groq {model}: unexpected response", retry_same_provider=True) from exc
        yield Chunk("text", text)
