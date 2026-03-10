"""Redis-backed event response cache.

When users click event cards, every click generates the identical query.
Cache the first LLM response (summary) keyed by event ID to avoid
redundant pipeline runs. Persists across restarts via Redis.
"""
from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

_REDIS_PREFIX = "evt:"
_EVENT_CACHE_TTL = 6 * 3600  # 6 hours
_EVENT_ID_RE = re.compile(r"Event ID:\s*(\d+)")

_hits = 0
_misses = 0


def get_cached_event_response(message: str, language: str) -> dict | None:
    """Check if this is an event detail query with a cached response."""
    global _hits, _misses
    m = _EVENT_ID_RE.search(message)
    if not m:
        return None

    key = f"{_REDIS_PREFIX}{m.group(1)}:{language}"

    from cache.redis_client import redis_get
    data = redis_get(key)
    if data is None:
        _misses += 1
        return None

    _hits += 1
    logger.info("Event cache HIT (event_id=%s, lang=%s)", m.group(1), language)
    return data


def cache_event_response(message: str, language: str, response: str, sources: list, agent_used: str):
    """Cache the response for an event detail query."""
    m = _EVENT_ID_RE.search(message)
    if not m:
        return
    # Only cache the first response (summary), not follow-ups
    if "Tell me about this event:" not in message:
        return

    key = f"{_REDIS_PREFIX}{m.group(1)}:{language}"

    from cache.redis_client import redis_set
    redis_set(key, {
        "response": response,
        "sources": sources,
        "agent_used": agent_used,
    }, ttl=_EVENT_CACHE_TTL)

    logger.info("Event cache STORE (event_id=%s, lang=%s)", m.group(1), language)


def clear():
    """Wipe all event cache entries."""
    from cache.redis_client import redis_flush_prefix
    redis_flush_prefix(_REDIS_PREFIX)
    logger.info("Event cache cleared")


def stats() -> dict:
    total = _hits + _misses
    from cache.redis_client import redis_info
    return {
        "name": "events",
        "redis": redis_info(),
        "hits": _hits,
        "misses": _misses,
        "hit_rate": round(_hits / total, 3) if total else 0,
    }
