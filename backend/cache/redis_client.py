"""Standard Redis client singleton.

Uses the `redis` Python package — works with any Redis provider:
  - Upstash (rediss:// URL with token as password)
  - GCP Memorystore (redis:// private IP)
  - Local Docker Redis (redis://localhost:6379)
  - Redis Cloud, AWS ElastiCache, etc.

Set REDIS_URL env var to connect. Examples:
  REDIS_URL=rediss://default:TOKEN@your-instance.upstash.io:6379
  REDIS_URL=redis://10.0.0.5:6379
  REDIS_URL=redis://localhost:6379

Falls back to in-memory dict when REDIS_URL is not set,
so local dev works without any Redis setup.
"""
from __future__ import annotations

import json
import logging
from threading import Lock

logger = logging.getLogger(__name__)

_client = None
_prefix = ""
_init_attempted = False
_init_lock = Lock()
_fallback: dict[str, tuple[float, str]] = {}  # key → (expire_at, json_value)


def _get_client():
    """Lazy-init Redis client. Returns None if not configured."""
    global _client, _prefix, _init_attempted
    if _init_attempted:
        return _client

    with _init_lock:
        if _init_attempted:
            return _client
        _init_attempted = True

        from config import settings
        _prefix = settings.redis_prefix
        redis_url = settings.redis_url
        if not redis_url:
            logger.info("REDIS_URL not set — using in-memory fallback")
            return None

        try:
            import redis
            _client = redis.Redis.from_url(
                redis_url,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
            )
            _client.ping()
            host = redis_url.split("@")[-1] if "@" in redis_url else redis_url
            logger.info("Connected to Redis at %s (prefix=%s)", host, _prefix or "(none)")
            return _client
        except Exception:
            logger.exception("Failed to connect to Redis — using in-memory fallback")
            _client = None
            return None


def _key(key: str) -> str:
    """Prepend environment prefix to key."""
    _get_client()  # ensure _prefix is initialized
    return f"{_prefix}{key}" if _prefix else key


def redis_set(key: str, value: dict, ttl: int = 21600) -> None:
    """Store a JSON-serializable dict with TTL (default 6 hours)."""
    full_key = _key(key)
    client = _get_client()
    json_val = json.dumps(value, default=str)
    if client:
        try:
            client.set(full_key, json_val, ex=ttl)
            return
        except Exception:
            logger.exception("Redis SET error")
    # Fallback
    import time
    _fallback[full_key] = (time.time() + ttl, json_val)


def redis_get(key: str) -> dict | None:
    """Retrieve a cached dict by key. Returns None on miss/expiry."""
    full_key = _key(key)
    client = _get_client()
    if client:
        try:
            val = client.get(full_key)
            if val is None:
                return None
            return json.loads(val)
        except Exception:
            logger.exception("Redis GET error")
            return None
    # Fallback
    import time
    entry = _fallback.get(full_key)
    if entry is None:
        return None
    expire_at, json_val = entry
    if time.time() > expire_at:
        del _fallback[full_key]
        return None
    return json.loads(json_val)


def redis_delete(key: str) -> None:
    """Delete a key."""
    full_key = _key(key)
    client = _get_client()
    if client:
        try:
            client.delete(full_key)
        except Exception:
            pass
    _fallback.pop(full_key, None)


def redis_flush_prefix(prefix: str) -> int:
    """Delete all keys matching a prefix. Returns count deleted."""
    full_prefix = _key(prefix)
    client = _get_client()
    count = 0
    if client:
        try:
            cursor = 0
            while True:
                cursor, keys = client.scan(cursor, match=f"{full_prefix}*", count=100)
                if keys:
                    client.delete(*keys)
                    count += len(keys)
                if cursor == 0:
                    break
        except Exception:
            logger.exception("Redis flush error")
    # Also clear fallback
    to_del = [k for k in _fallback if k.startswith(full_prefix)]
    for k in to_del:
        del _fallback[k]
    count += len(to_del)
    return count


def redis_info() -> dict:
    """Return basic Redis connection info for stats."""
    client = _get_client()
    return {
        "connected": client is not None,
        "fallback_keys": len(_fallback) if client is None else 0,
    }
