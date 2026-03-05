"""Live multi-source social/review search tool via Tavily."""
from __future__ import annotations

import logging
import os
import time

from tools.registry import tool

logger = logging.getLogger(__name__)

# Domains to search across — Tavily include_domains filters to these
COMMUNITY_DOMAINS = [
    "reddit.com",
    "xiaohongshu.com",
    "yelp.com",
    "patch.com",
    "theislandnow.com",
    "greatneckrecord.com",
]

# Map domain fragments to human-readable labels
_DOMAIN_LABELS = {
    "reddit.com": "Reddit",
    "xiaohongshu.com": "RedNote",
    "yelp.com": "Yelp",
    "google.com/maps": "Google Reviews",
    "patch.com": "Patch",
    "theislandnow.com": "Island Now",
    "greatneckrecord.com": "GN Record",
}

# In-memory TTL cache: key → (timestamp, result)
_cache: dict[str, tuple[float, str]] = {}
_CACHE_TTL = 600  # 10 minutes
_CACHE_MAX = 100


def _cache_get(key: str) -> str | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    ts, result = entry
    if time.time() - ts > _CACHE_TTL:
        del _cache[key]
        return None
    return result


def _cache_set(key: str, value: str):
    if len(_cache) >= _CACHE_MAX:
        oldest_key = min(_cache, key=lambda k: _cache[k][0])
        del _cache[oldest_key]
    _cache[key] = (time.time(), value)


def _label_for_url(url: str) -> str:
    """Get a human-readable source label from a URL."""
    for domain, label in _DOMAIN_LABELS.items():
        if domain in url:
            # Extra detail for Reddit: extract subreddit
            if domain == "reddit.com" and "reddit.com/r/" in url:
                sub = url.split("reddit.com/r/")[1].split("/")[0]
                return f"r/{sub}"
            return label
    return "Web"


async def _tavily_social_search(query: str, api_key: str, max_results: int = 8) -> str:
    """Search community sources via Tavily with include_domains."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": api_key,
                    "query": query,
                    "max_results": max_results,
                    "include_answer": True,
                    "include_domains": COMMUNITY_DOMAINS,
                },
            )
            response.raise_for_status()
            data = response.json()
    except Exception as e:
        return f"Social search error: {e}. Try web_search as an alternative."

    parts: list[str] = []

    if data.get("answer"):
        parts.append(f"Summary: {data['answer']}")

    for i, result in enumerate(data.get("results", []), 1):
        title = result.get("title", "")
        url = result.get("url", "")
        content = result.get("content", "")
        source_label = _label_for_url(url)

        header = f"[{i}] {source_label}: {title}"
        entry = f"{header}\nurl: {url}"
        if content:
            entry += f"\n{content[:400]}"
        parts.append(entry)

    if not parts:
        return (
            f"No community posts or reviews found for '{query}'. "
            "Try web_search for broader results."
        )

    return "\n\n---\n\n".join(parts)


@tool(
    name="search_social",
    description=(
        "Search Reddit, Yelp, Google Reviews, RedNote, and local news sites for community "
        "discussions, reviews, and local coverage about Great Neck and Long Island. Returns "
        "recent posts, reviews, and articles. Use for resident experiences, restaurant/business "
        "reviews, school opinions, neighborhood info, local news, etc."
    ),
)
async def search_social(query: str) -> str:
    """Search social media, review sites, and local news for the query."""
    from tools.budget import check_budget

    tavily_key = os.environ.get("TAVILY_API_KEY", "")
    if not tavily_key:
        return (
            "Social search unavailable (TAVILY_API_KEY not configured). "
            "Try web_search as an alternative."
        )

    cache_key = query.lower().strip()
    cached = _cache_get(cache_key)
    if cached is not None:
        logger.info(f"Social search cache hit: {query}")
        return cached

    # Check budget (cache hits don't count)
    blocked = check_budget()
    if blocked:
        return blocked

    result = await _tavily_social_search(query, tavily_key)
    _cache_set(cache_key, result)
    return result
