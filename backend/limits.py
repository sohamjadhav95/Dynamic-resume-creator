"""Daily usage limits. Stored in Supabase so they work across serverless instances.

If Supabase is not configured (local dev) we fall back to an in-memory counter.
If Supabase is unreachable we allow the request: a broken counter must never break the app.
"""

import logging
import time
from collections import defaultdict
from dataclasses import dataclass

import httpx

from .auth import Identity
from .config import get_settings

log = logging.getLogger("resume.limits")

_memory: dict[str, list[float]] = defaultdict(list)


@dataclass
class Quota:
    allowed: bool
    limit: int
    remaining: int


def _memory_consume(key: str, limit: int) -> Quota:
    now = time.time()
    hits = [t for t in _memory[key] if now - t < 86_400]
    if len(hits) >= limit:
        _memory[key] = hits
        return Quota(False, limit, 0)
    hits.append(now)
    _memory[key] = hits
    return Quota(True, limit, limit - len(hits))


def service_headers(key: str) -> dict[str, str]:
    """New Supabase keys (sb_secret_...) go only in `apikey`; legacy JWT keys also need Authorization."""
    if key.startswith("sb_"):
        return {"apikey": key}
    return {"apikey": key, "Authorization": f"Bearer {key}"}


async def consume(identity: Identity, kind: str) -> Quota:
    settings = get_settings()
    limit = settings.limits[kind]["guest" if identity.is_guest else "user"]
    if not (settings.supabase_url and settings.supabase_service_role_key):
        return _memory_consume(f"{identity.subject}:{kind}", limit)
    key = settings.supabase_service_role_key
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            res = await client.post(
                f"{settings.supabase_url}/rest/v1/rpc/consume_quota",
                json={"p_subject": identity.subject, "p_kind": kind, "p_limit": limit},
                headers=service_headers(key),
            )
        res.raise_for_status()
        remaining = int(res.json())
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("limits.unavailable kind=%s error=%r", kind, exc)
        return Quota(True, limit, limit)
    return Quota(remaining >= 0, limit, max(remaining, 0))
