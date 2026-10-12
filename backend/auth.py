"""Who is calling? A signed-in Supabase user, or a guest identified by a hashed IP."""

import hashlib
import logging
import time
from dataclasses import dataclass

import httpx
from fastapi import Request

from .config import get_settings

log = logging.getLogger("resume.auth")

_TOKEN_CACHE: dict[str, tuple[float, str]] = {}  # token hash -> (expires_at, user_id)
_CACHE_SECONDS = 300


@dataclass
class Identity:
    subject: str  # used for rate limits
    user_id: str | None

    @property
    def is_guest(self) -> bool:
        return self.user_id is None


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


def _guest(request: Request) -> Identity:
    salt = get_settings().ip_salt
    digest = hashlib.sha256(f"{salt}:{client_ip(request)}".encode()).hexdigest()[:32]
    return Identity(subject=f"ip:{digest}", user_id=None)


async def _verify_with_supabase(token: str) -> str | None:
    """Ask Supabase Auth who owns this token. Works with both legacy and new signing keys."""
    settings = get_settings()
    key = hashlib.sha256(token.encode()).hexdigest()
    cached = _TOKEN_CACHE.get(key)
    if cached and cached[0] > time.time():
        return cached[1]
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.get(
                f"{settings.supabase_url}/auth/v1/user",
                headers={"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as exc:
        log.warning("auth.verify_failed network=%r", exc)
        return None
    if res.status_code != 200:
        return None
    user_id = res.json().get("id")
    if user_id:
        if len(_TOKEN_CACHE) > 5000:
            _TOKEN_CACHE.clear()
        _TOKEN_CACHE[key] = (time.time() + _CACHE_SECONDS, user_id)
    return user_id


async def get_identity(request: Request) -> Identity:
    settings = get_settings()
    header = request.headers.get("authorization", "")
    if settings.supabase_enabled and header.lower().startswith("bearer "):
        user_id = await _verify_with_supabase(header[7:].strip())
        if user_id:
            return Identity(subject=f"user:{user_id}", user_id=user_id)
    return _guest(request)
