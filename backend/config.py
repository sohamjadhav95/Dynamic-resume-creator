"""Runtime settings, read once from environment variables."""

import os
from dataclasses import dataclass, field
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


def _list(name: str, default: str) -> list[str]:
    raw = os.environ.get(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str = ""
    gemini_models: list[str] = field(default_factory=list)
    groq_api_key: str = ""
    groq_models: list[str] = field(default_factory=list)

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    allowed_origins: list[str] = field(default_factory=list)
    ip_salt: str = ""

    # Timing. Slow is NOT a failure: we only give up on a provider when it errors,
    # stops sending anything for `ai_stall_seconds`, or uses up its whole budget.
    ai_stall_seconds: float = 90
    ai_gemini_budget_seconds: float = 240
    ai_groq_budget_seconds: float = 40
    ai_total_deadline_seconds: float = 285  # Vercel Hobby hard limit is 300s
    heartbeat_seconds: float = 10

    # Daily limits per person (guests are counted by hashed IP).
    limits: dict[str, dict[str, int]] = field(default_factory=dict)

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key)


@lru_cache
def get_settings() -> Settings:
    return Settings(
        gemini_api_key=os.environ.get("GEMINI_API_KEY", ""),
        gemini_models=_list(
            "GEMINI_MODELS",
            "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-2.5-flash",
        ),
        groq_api_key=os.environ.get("GROQ_API_KEY", ""),
        groq_models=_list("GROQ_MODELS", "openai/gpt-oss-120b,openai/gpt-oss-20b"),
        supabase_url=os.environ.get("SUPABASE_URL", "").rstrip("/"),
        # New key names (publishable / secret) and legacy names (anon / service_role) both work.
        supabase_anon_key=os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY", ""),
        supabase_service_role_key=os.environ.get("SUPABASE_SECRET_KEY")
        or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
        allowed_origins=_list("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"),
        ip_salt=os.environ.get("IP_HASH_SALT", "change-me"),
        ai_stall_seconds=_float("AI_STALL_SECONDS", 90),
        ai_gemini_budget_seconds=_float("AI_GEMINI_BUDGET_SECONDS", 240),
        ai_groq_budget_seconds=_float("AI_GROQ_BUDGET_SECONDS", 40),
        ai_total_deadline_seconds=_float("AI_TOTAL_DEADLINE_SECONDS", 285),
        heartbeat_seconds=_float("AI_HEARTBEAT_SECONDS", 10),
        limits={
            "tailor": {"guest": _int("LIMIT_GUEST_TAILOR", 5), "user": _int("LIMIT_USER_TAILOR", 25)},
            "rewrite": {"guest": _int("LIMIT_GUEST_REWRITE", 20), "user": _int("LIMIT_USER_REWRITE", 150)},
            "parse": {"guest": _int("LIMIT_GUEST_PARSE", 3), "user": _int("LIMIT_USER_PARSE", 10)},
        },
    )
