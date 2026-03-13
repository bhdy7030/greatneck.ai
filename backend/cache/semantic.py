"""Semantic response cache — paraphrase-aware caching via ChromaDB + Redis.

ChromaDB handles vector similarity search (embeddings).
Redis (Upstash) stores response data (persistent across restarts).

Handles context dimensions:
  - village:      metadata filter (different villages → different answers)
  - language:     metadata filter (en vs zh → different response text)
  - fast_mode:    metadata filter (fast vs deep use different models)
                  Deep-mode cached responses CAN serve fast-mode requests (upgrade),
                  but fast-mode responses must NOT serve deep-mode requests.
  - web_search:   metadata filter (off/limited/unlimited → different sources)
                  Higher-tier cached responses CAN serve lower-tier requests.
  - time:         TTL-based eviction (6 hours)
  - history:      caller skips cache when conversation has history (contextual answers)
  - image:        caller skips cache for image queries
"""
from __future__ import annotations

import logging
import time
import uuid

logger = logging.getLogger(__name__)

COLLECTION_NAME = "response-cache"
# Cosine distance threshold: 0 = identical, 0.12 ≈ 0.88 similarity
SIMILARITY_THRESHOLD = 0.12
CACHE_TTL = 6 * 3600  # 6 hours
MAX_ENTRIES = 500
_REDIS_PREFIX = "sem:"

_hits = 0
_misses = 0


def _get_collection():
    from rag.store import _get_client
    client = _get_client()
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


_WEB_SEARCH_RANK = {"unlimited": 2, "limited": 1, "off": 0}


def get(
    query: str,
    village: str,
    language: str,
    fast_mode: bool = False,
    web_search_mode: str = "limited",
    query_embedding: list[float] | None = None,
) -> dict | None:
    """Look up a semantically similar cached response.

    Returns {response, sources, agent_used} or None.
    If query_embedding is provided, uses it directly instead of re-embedding.

    Upgrade rules:
      - A deep-mode cached response can serve a fast-mode request (better quality).
      - A higher web_search_mode cached response can serve a lower request.
      - Never the reverse.
    """
    global _hits, _misses
    try:
        collection = _get_collection()
        if collection.count() == 0:
            _misses += 1
            return None

        # Filter by village + language (exact match required)
        # fast_mode and web_search_mode are checked post-query for upgrade logic
        where = {"$and": [
            {"village": {"$eq": village or ""}},
            {"language": {"$eq": language or "en"}},
        ]}
        query_kwargs: dict = {
            "n_results": 3,  # fetch a few to find best match with compatible settings
            "where": where,
        }
        if query_embedding is not None:
            query_kwargs["query_embeddings"] = [query_embedding]
        else:
            query_kwargs["query_texts"] = [query]
        results = collection.query(**query_kwargs)

        if not results["ids"] or not results["ids"][0]:
            _misses += 1
            return None

        now = time.time()
        req_ws_rank = _WEB_SEARCH_RANK.get(web_search_mode, 1)

        # Check candidates in order of similarity
        for idx in range(len(results["ids"][0])):
            doc_id = results["ids"][0][idx]
            distance = results["distances"][0][idx] if results["distances"] else 999

            if distance > SIMILARITY_THRESHOLD:
                break  # remaining results are even less similar

            meta = results["metadatas"][0][idx] if results["metadatas"] else {}

            # TTL check
            if now - meta.get("cached_at", 0) > CACHE_TTL:
                _try_delete(collection, doc_id)
                continue

            # fast_mode upgrade rule: deep-mode cache can serve fast-mode requests
            cached_fast = meta.get("fast_mode", False)
            if cached_fast and not fast_mode:
                # Fast-mode response serving deep-mode request — skip
                continue

            # web_search upgrade rule: higher-tier cache can serve lower-tier requests
            cached_ws = meta.get("web_search_mode", "limited")
            cached_ws_rank = _WEB_SEARCH_RANK.get(cached_ws, 1)
            if cached_ws_rank < req_ws_rank:
                # Cached response used fewer web searches than requested — skip
                continue

            # Retrieve response data from Redis
            from cache.redis_client import redis_get
            data = redis_get(f"{_REDIS_PREFIX}{doc_id}")
            if data is None:
                _try_delete(collection, doc_id)
                continue

            _hits += 1
            logger.info(
                "Semantic cache HIT (dist=%.3f, village=%s, lang=%s, fast=%s, ws=%s, q=%.50s)",
                distance, village, language, fast_mode, web_search_mode, query,
            )
            return data

        _misses += 1
        return None

    except Exception:
        logger.exception("Semantic cache get error")
        _misses += 1
        return None


def put(
    query: str,
    village: str,
    language: str,
    response_data: dict,
    fast_mode: bool = False,
    web_search_mode: str = "limited",
):
    """Cache a pipeline response for future semantic matches."""
    doc_id = str(uuid.uuid4())

    # Store response data in Redis first (always succeeds if Redis is up)
    from cache.redis_client import redis_set
    redis_set(f"{_REDIS_PREFIX}{doc_id}", response_data, ttl=CACHE_TTL)

    # Store embedding in ChromaDB for semantic lookup
    try:
        collection = _get_collection()

        if collection.count() >= MAX_ENTRIES:
            _evict(collection)

        collection.add(
            documents=[query],
            metadatas=[{
                "village": village or "",
                "language": language or "en",
                "fast_mode": fast_mode,
                "web_search_mode": web_search_mode,
                "cached_at": time.time(),
            }],
            ids=[doc_id],
        )
    except Exception:
        logger.exception("Semantic cache ChromaDB error (Redis data still stored)")

    logger.info(
        "Semantic cache STORE (village=%s, lang=%s, fast=%s, ws=%s, q=%.60s)",
        village, language, fast_mode, web_search_mode, query,
    )


def _evict(collection, count: int = 50):
    """Remove expired and oldest entries."""
    try:
        all_data = collection.get(include=["metadatas"])
        if not all_data["ids"]:
            return

        now = time.time()
        to_remove = []
        timed = []

        for i, doc_id in enumerate(all_data["ids"]):
            meta = all_data["metadatas"][i] if all_data["metadatas"] else {}
            cached_at = meta.get("cached_at", 0)
            if now - cached_at > CACHE_TTL:
                to_remove.append(doc_id)
            else:
                timed.append((cached_at, doc_id))

        # If not enough expired, remove oldest
        if len(to_remove) < count:
            timed.sort()
            to_remove.extend(doc_id for _, doc_id in timed[: count - len(to_remove)])

        if to_remove:
            batch = to_remove[:count]
            collection.delete(ids=batch)
            from cache.redis_client import redis_delete
            for doc_id in batch:
                redis_delete(f"{_REDIS_PREFIX}{doc_id}")
    except Exception:
        logger.exception("Semantic cache eviction error")


def _try_delete(collection, doc_id: str):
    """Best-effort delete a single entry."""
    try:
        collection.delete(ids=[doc_id])
        from cache.redis_client import redis_delete
        redis_delete(f"{_REDIS_PREFIX}{doc_id}")
    except Exception:
        pass


def clear():
    """Wipe the semantic cache."""
    try:
        from rag.store import _get_client
        client = _get_client()
        try:
            client.delete_collection(name=COLLECTION_NAME)
        except Exception:
            pass
        from cache.redis_client import redis_flush_prefix
        redis_flush_prefix(_REDIS_PREFIX)
        logger.info("Semantic cache cleared")
    except Exception:
        logger.exception("Semantic cache clear error")


def stats() -> dict:
    total = _hits + _misses
    try:
        size = _get_collection().count()
    except Exception:
        size = 0
    from cache.redis_client import redis_info
    return {
        "name": "semantic",
        "size": size,
        "redis": redis_info(),
        "hits": _hits,
        "misses": _misses,
        "hit_rate": round(_hits / total, 3) if total else 0,
    }
