"""Tavily result caching via Redis (with in-memory fallback).

Thin wrapper around cache.redis_client with tool-specific prefixes and TTLs.
Redis handles eviction, TTL, and persistence — no custom LRU needed.

Usage:
    from tools.cache import tavily_cache_get, tavily_cache_set

    cached = tavily_cache_get("web", query)
    if cached is None:
        result = await search(...)
        tavily_cache_set("web", query, result, ttl=1800)
"""
from __future__ import annotations

from cache.redis_client import redis_get, redis_set

# Prefix → default TTL mapping
_TTLS = {
    "web": 1800,       # web_search: 30 min
    "social": 3600,    # search_social: 1 hour
    "extract": 14400,  # registry fetch_urls: 4 hours
}

_PREFIX = "tavily:"


def _make_key(scope: str, query: str) -> str:
    return f"{_PREFIX}{scope}:{query.lower().strip()}"


def tavily_cache_get(scope: str, query: str) -> str | None:
    """Get cached Tavily result. Returns None on miss."""
    data = redis_get(_make_key(scope, query))
    if data is None:
        return None
    return data.get("result")


def tavily_cache_set(scope: str, query: str, result: str, ttl: int | None = None) -> None:
    """Cache a Tavily result string."""
    redis_set(
        _make_key(scope, query),
        {"result": result},
        ttl=ttl or _TTLS.get(scope, 3600),
    )
