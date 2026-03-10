"""Cache utilities — semantic (ChromaDB + Redis), event (Redis), tool (in-memory)."""
from __future__ import annotations

import hashlib
import json
import logging
import time
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)


class TTLCache:
    """Thread-safe in-memory cache with TTL and size eviction."""

    def __init__(self, ttl: float = 3600, maxsize: int = 1024, name: str = "cache"):
        self.ttl = ttl
        self.maxsize = maxsize
        self.name = name
        self._store: dict[str, tuple[float, Any]] = {}
        self._lock = Lock()
        self._hits = 0
        self._misses = 0

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                self._misses += 1
                return None
            ts, value = entry
            if time.time() - ts > self.ttl:
                del self._store[key]
                self._misses += 1
                return None
            self._hits += 1
            return value

    def set(self, key: str, value: Any):
        with self._lock:
            if len(self._store) >= self.maxsize and key not in self._store:
                self._evict()
            self._store[key] = (time.time(), value)

    def _evict(self):
        """Remove expired entries, then oldest if still over capacity."""
        now = time.time()
        expired = [k for k, (ts, _) in self._store.items() if now - ts > self.ttl]
        for k in expired:
            del self._store[k]
        if len(self._store) >= self.maxsize:
            oldest = sorted(self._store, key=lambda k: self._store[k][0])
            for k in oldest[: self.maxsize // 4]:
                del self._store[k]

    def clear(self):
        with self._lock:
            self._store.clear()
            self._hits = 0
            self._misses = 0

    @property
    def stats(self) -> dict:
        total = self._hits + self._misses
        return {
            "name": self.name,
            "size": len(self._store),
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": round(self._hits / total, 3) if total else 0,
        }


def make_key(*parts: Any) -> str:
    """Deterministic cache key from arbitrary parts."""
    raw = json.dumps(parts, sort_keys=True, default=str)
    return hashlib.md5(raw.encode()).hexdigest()


# ── Shared cache instances ──

tool_cache = TTLCache(ttl=3600, maxsize=512, name="tool")

# Tools whose results are deterministic (from knowledge base, not web)
CACHEABLE_TOOLS = frozenset({
    "search_codes", "search_permits", "get_code_section",
    "search_community", "search_social",
})


def clear_all():
    """Clear all caches."""
    from cache import semantic as _sem
    from cache import events as _evt
    tool_cache.clear()
    _sem.clear()
    _evt.clear()
    logger.info("All caches cleared")


def all_stats() -> list[dict]:
    """Return stats for all cache layers."""
    from cache import semantic as _sem
    from cache import events as _evt
    return [_sem.stats(), _evt.stats(), tool_cache.stats]
