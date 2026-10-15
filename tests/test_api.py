import json

import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend import limits
from backend.ai.providers import Chunk
from backend.config import get_settings

SAMPLE = json.load(open("web/src/data/sample-resume.json"))
JD = "We are hiring a Data Analyst with SQL, Python, Tableau and stakeholder communication skills. " * 2

TAILOR_OK = {
    "job": {"title": "Data Analyst", "company": "Acme"},
    "summary": "Analyst.",
    "skills": [{"category": "Data", "items": ["SQL"]}],
    "experience": [],
    "projects": [],
    "project_order": [],
    "keywords": [{"term": "SQL", "importance": "must"}],
    "project_ideas": [],
    "advice": [],
}


def parse_sse(body: str) -> list[tuple[str, dict]]:
    events = []
    for block in body.strip().split("\n\n"):
        lines = [line for line in block.splitlines() if not line.startswith(":")]
        if not lines:
            continue
        name = lines[0].removeprefix("event: ")
        data = json.loads(lines[1].removeprefix("data: "))
        events.append((name, data))
    return events


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for key in (
        "GEMINI_API_KEY",
        "GROQ_API_KEY",
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_SECRET_KEY",
    ):
        monkeypatch.setenv(key, "")
    get_settings.cache_clear()
    limits._memory.clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def client():
    return TestClient(app_module.app)


def test_health(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["ok"] is True


def test_config_hides_accounts_when_not_configured(client):
    assert client.get("/api/config").json()["supabase"] is None


def test_tailor_without_any_ai_key_falls_back(client):
    res = client.post("/api/tailor", json={"resume": SAMPLE, "job_description": JD})
    assert res.status_code == 200
    assert parse_sse(res.text)[-1][0] == "fallback"


def test_tailor_rejects_short_job_description(client):
    res = client.post("/api/tailor", json={"resume": SAMPLE, "job_description": "too short"})
    assert res.status_code == 422
    assert "longer job description" in res.json()["error"]


def test_tailor_streams_result_from_gemini(client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    get_settings.cache_clear()

    async def fake_stream(self, model, system, prompt, schema, temperature):
        assert "Data Analyst" in prompt
        yield Chunk("thought", "Reading the job")
        yield Chunk("text", json.dumps(TAILOR_OK))

    monkeypatch.setattr(app_module.GeminiProvider, "stream", fake_stream)
    events = parse_sse(client.post("/api/tailor", json={"resume": SAMPLE, "job_description": JD}).text)
    names = [name for name, _ in events]
    assert names[0] == "stage" and "thought" in names
    assert events[-1][0] == "result"
    assert events[-1][1]["engine"] == "gemini"
    assert events[-1][1]["data"]["job"]["company"] == "Acme"


def test_guest_daily_limit(client, monkeypatch):
    monkeypatch.setenv("LIMIT_GUEST_TAILOR", "1")
    get_settings.cache_clear()
    body = {"resume": SAMPLE, "job_description": JD}
    assert parse_sse(client.post("/api/tailor", json=body).text)[-1][0] == "fallback"
    events = parse_sse(client.post("/api/tailor", json=body).text)
    assert events[-1][0] == "limit"
    assert "Sign in" in events[-1][1]["message"]


def test_own_gemini_key_skips_quota_and_shared_keys(client, monkeypatch):
    monkeypatch.setenv("LIMIT_GUEST_TAILOR", "0")
    monkeypatch.setenv("GROQ_API_KEY", "shared-groq")
    get_settings.cache_clear()
    attempts = app_module.build_attempts(get_settings(), "user-own-gemini-key-1234567890")
    assert [a.provider.name for a in attempts] == ["gemini"]
    res = client.post(
        "/api/tailor",
        json={"resume": SAMPLE, "job_description": JD},
        headers={"x-gemini-key": "user-own-gemini-key-1234567890"},
    )
    assert parse_sse(res.text)[0][0] != "limit"


def test_rewrite_unavailable_without_keys(client):
    res = client.post("/api/rewrite", json={"text": "Built dashboards for sales", "mode": "impact"})
    assert res.status_code == 503
    assert "error" in res.json()


def test_rewrite_returns_options(client, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "k")
    get_settings.cache_clear()

    async def fake_stream(self, model, system, prompt, schema, temperature):
        yield Chunk("text", json.dumps({"options": ['"Built 12 sales dashboards"', "B", "C", "D"]}))

    monkeypatch.setattr(app_module.GroqProvider, "stream", fake_stream)
    res = client.post("/api/rewrite", json={"text": "Built dashboards for sales", "mode": "impact"})
    assert res.json() == {"options": ["Built 12 sales dashboards", "B", "C"], "engine": "groq"}


def test_oversized_resume_rejected(client):
    huge = {"summary": "x" * 70_000}
    res = client.post("/api/tailor", json={"resume": huge, "job_description": JD})
    assert res.status_code == 422


def test_supabase_key_headers():
    assert limits.service_headers("sb_secret_abc") == {"apikey": "sb_secret_abc"}
    assert limits.service_headers("eyJhbGciOi.x.y")["Authorization"] == "Bearer eyJhbGciOi.x.y"


async def test_quota_fails_open_when_supabase_unreachable(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:9")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_x")
    get_settings.cache_clear()
    quota = await limits.consume(limits.Identity(subject="ip:x", user_id=None), "tailor")
    assert quota.allowed


def test_ai_chain_order_and_missing_keys(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "g")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("AI_CHAIN", "groq:qwen/qwen3.8-27b,gemini:gemini-3.1-flash-lite,groq:openai/gpt-oss-20b")
    get_settings.cache_clear()
    attempts = app_module.build_attempts(get_settings(), None)
    assert [(a.provider.name, a.models) for a in attempts] == [
        ("groq", ["qwen/qwen3.8-27b"]),
        ("groq", ["openai/gpt-oss-20b"]),
    ]  # no Gemini key -> Gemini entries are skipped
    own = app_module.build_attempts(get_settings(), "user-own-gemini-key-123456")
    assert [a.provider.name for a in own] == ["gemini"]  # an own key never uses our shared keys
