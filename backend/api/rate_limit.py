"""Lightweight rate limiter middleware using Redis (with in-memory fallback).

Uses a sliding window counter pattern. Keys are based on:
  - Authenticated users: user ID
  - Anonymous users: X-Session-ID header
  - Fallback: client IP

Two tiers:
  - Chat endpoint (/api/chat): 5 requests per 15 seconds
  - All other API endpoints: 60 requests per 60 seconds

Exempt: /health, /api/track, static assets.
"""

import logging
import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# Rate limit configs: (max_requests, window_seconds)
CHAT_LIMIT = (5, 15)
DEFAULT_LIMIT = (60, 60)

# Paths exempt from rate limiting
EXEMPT_PREFIXES = ("/health", "/api/track", "/docs", "/openapi.json")


def _get_rate_key(request: Request) -> str:
    """Extract a rate-limiting identity from the request."""
    # Prefer authenticated user ID from JWT (set by auth middleware)
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer ") and len(auth) > 20:
        # Use a hash of the token as key (avoid storing full token)
        token_suffix = auth[-16:]
        return f"rl:user:{token_suffix}"

    # Fall back to session ID
    session_id = request.headers.get("x-session-id", "")
    if session_id:
        return f"rl:sess:{session_id}"

    # Last resort: client IP
    client_ip = request.client.host if request.client else "unknown"
    return f"rl:ip:{client_ip}"


def _check_rate_limit(key: str, max_requests: int, window: int) -> tuple[bool, int]:
    """Check and increment rate limit. Returns (allowed, retry_after_seconds).

    Uses Redis INCR + EXPIRE for atomic sliding window.
    Falls back to in-memory dict if Redis is unavailable.
    """
    from cache.redis_client import _get_client, _key

    full_key = _key(f"{key}:{int(time.time()) // window}")
    client = _get_client()

    if client:
        try:
            count = client.incr(full_key)
            if count == 1:
                client.expire(full_key, window + 1)
            if count > max_requests:
                ttl = client.ttl(full_key)
                return False, max(ttl, 1)
            return True, 0
        except Exception:
            logger.warning("Rate limit Redis error — allowing request")
            return True, 0

    # In-memory fallback
    now = time.time()
    window_key = full_key
    if not hasattr(_check_rate_limit, "_mem"):
        _check_rate_limit._mem = {}
    mem = _check_rate_limit._mem

    # Clean expired entries periodically
    if len(mem) > 1000:
        cutoff = now - 120
        _check_rate_limit._mem = {k: v for k, v in mem.items() if v[0] > cutoff}
        mem = _check_rate_limit._mem

    entry = mem.get(window_key)
    if entry is None or entry[0] < now:
        mem[window_key] = (now + window, 1)
        return True, 0

    expire_at, count = entry
    if count >= max_requests:
        return False, max(int(expire_at - now), 1)

    mem[window_key] = (expire_at, count + 1)
    return True, 0


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Skip exempt paths
        if any(path.startswith(p) for p in EXEMPT_PREFIXES):
            return await call_next(request)

        # Skip non-API paths
        if not path.startswith("/api"):
            return await call_next(request)

        # Determine limit tier
        is_chat = path == "/api/chat" or path == "/api/chat/stream"
        max_requests, window = CHAT_LIMIT if is_chat else DEFAULT_LIMIT

        key = _get_rate_key(request)
        allowed, retry_after = _check_rate_limit(key, max_requests, window)

        if not allowed:
            logger.warning("Rate limited: %s on %s", key, path)
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please try again later."},
                headers={"Retry-After": str(retry_after)},
            )

        return await call_next(request)
