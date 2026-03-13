"""Common Answers Registry — in-memory lookup for known community knowledge.

Engineers maintain `common_answers.yaml`. This module loads it once at import
time, then provides a fast keyword-matching lookup. Matched entries are
formatted as high-priority context for agent system prompts.

When entries match, a semantic search against ChromaDB is automatically
performed using the user's query — pulling in any related scraped content
(park district pages, community data, etc.) at zero API cost.

If an entry has `fetch_urls`, those pages are also fetched live (via Tavily
extract with httpx fallback) for truly real-time data needs.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import date, datetime
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)

REGISTRY_FILE = Path(__file__).parent / "common_answers.yaml"

# Minimum keyword overlap to consider a match
MIN_KEYWORD_HITS = 2


def _load_entries() -> list[dict]:
    if not REGISTRY_FILE.exists():
        logger.warning("common_answers.yaml not found — registry empty")
        return []
    with open(REGISTRY_FILE) as f:
        data = yaml.safe_load(f) or {}
    return data.get("entries", [])


# Load once at module level
_entries: list[dict] = _load_entries()


def reload():
    """Hot-reload the registry (useful after editing the YAML)."""
    global _entries
    _entries = _load_entries()
    logger.info(f"Registry reloaded: {len(_entries)} entries")


def _is_stale(entry: dict) -> bool:
    """Check if an entry's last_verified date exceeds its stale_days."""
    last = entry.get("last_verified", "")
    stale_days = entry.get("stale_days", 90)
    if not last:
        return True
    try:
        verified = datetime.strptime(str(last), "%Y-%m-%d").date()
        return (date.today() - verified).days > stale_days
    except ValueError:
        return True


def _applies_to_village(entry: dict, village: str) -> bool:
    scope = entry.get("applies_to", "all")
    if scope == "all":
        return True
    if isinstance(scope, list):
        return village.lower() in [v.lower() for v in scope]
    return True


def lookup(query: str, village: str = "") -> list[dict]:
    """Find registry entries matching the query by keyword overlap.

    Returns list of matching entry dicts, each augmented with `_stale: bool`.
    """
    query_lower = query.lower()
    query_words = set(query_lower.split())
    matches = []

    for entry in _entries:
        if village and not _applies_to_village(entry, village):
            continue

        keywords = entry.get("keywords", [])
        hits = 0
        for kw in keywords:
            kw_lower = kw.lower()
            if kw_lower in query_words or kw_lower in query_lower:
                hits += 1

        if hits >= MIN_KEYWORD_HITS:
            matches.append({**entry, "_stale": _is_stale(entry), "_hits": hits})

    matches.sort(key=lambda m: m["_hits"], reverse=True)
    return matches


def _rag_search(query: str) -> str:
    """Semantic search against ChromaDB shared collection. Free, local."""
    try:
        from rag.store import KnowledgeStore
        store = KnowledgeStore()
        results = store.search(query, village=None, n_results=5)
        if not results:
            return ""
        parts = []
        for doc in results:
            text = doc["text"]
            source = doc.get("metadata", {}).get("source", "")
            entry = text[:2000]
            if source:
                entry += f"\n(source: {source})"
            parts.append(entry)
        return "\n\n---\n\n".join(parts)
    except Exception as e:
        logger.warning(f"Registry RAG search failed: {e}")
        return ""


async def _tavily_extract(urls: list[str], query: str, api_key: str) -> dict[str, str]:
    """Use Tavily extract API to fetch and parse URLs.

    Uses `query` for relevance reranking and `chunks_per_source` to limit
    content volume (Tavily best practice).
    """
    import httpx

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                "https://api.tavily.com/extract",
                json={
                    "api_key": api_key,
                    "urls": urls,
                    "query": query,            # rerank chunks by relevance
                    "chunks_per_source": 3,    # limit context size (500 chars each)
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.warning(f"Tavily extract failed: {e}")
        return {}

    result: dict[str, str] = {}
    for item in data.get("results", []):
        url = item.get("url", "")
        text = item.get("raw_content") or item.get("text", "")
        if url and text:
            result[url] = text[:8000] if len(text) > 8000 else text
    return result


async def _httpx_fallback(url: str) -> str:
    """Simple httpx + BeautifulSoup fallback for when Tavily is unavailable."""
    import httpx

    try:
        async with httpx.AsyncClient(
            timeout=10.0, follow_redirects=True,
            headers={"User-Agent": "GreatNeck.ai/0.1"},
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except Exception as e:
        return ""

    content_type = resp.headers.get("content-type", "")
    if "text/html" not in content_type:
        return resp.text[:8000]

    from bs4 import BeautifulSoup
    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "iframe"]):
        tag.decompose()
    main = soup.find("main") or soup.find("article") or soup.find("body") or soup
    text = main.get_text(separator="\n", strip=True)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    cleaned = "\n".join(lines)
    return cleaned[:8000] if len(cleaned) > 8000 else cleaned


async def _fetch_urls(urls: list[str], query: str) -> dict[str, str]:
    """Fetch URLs via Tavily extract (preferred) or httpx fallback.

    Uses Redis cache (4-hour TTL) to avoid redundant API calls.
    """
    from tools.cache import tavily_cache_get, tavily_cache_set

    results: dict[str, str] = {}
    to_fetch: list[str] = []

    for url in urls:
        cached = tavily_cache_get("extract", url)
        if cached is not None:
            results[url] = cached
        else:
            to_fetch.append(url)

    if not to_fetch:
        return results

    # Try Tavily extract first (1 credit per 5 URLs — very cheap)
    tavily_key = os.environ.get("TAVILY_API_KEY", "")
    fetched: dict[str, str] = {}
    if tavily_key:
        fetched = await _tavily_extract(to_fetch, query, tavily_key)

    # Fallback: httpx for any URLs Tavily missed or if no key
    missing = [u for u in to_fetch if u not in fetched]
    if missing:
        fallback_results = await asyncio.gather(*[_httpx_fallback(u) for u in missing])
        for url, content in zip(missing, fallback_results):
            if content:
                fetched[url] = content

    # Update cache
    for url, content in fetched.items():
        tavily_cache_set("extract", url, content)
        results[url] = content

    return results


def format_context(
    matches: list[dict],
    rag_content: str = "",
    fetched: dict[str, str] | None = None,
) -> str:
    """Format matched entries as context for injection into agent prompts."""
    if not matches:
        return ""

    fetched = fetched or {}

    lines = [
        "## Known Answers (from internal registry — high confidence)",
        "The following information is from a curated, engineer-maintained knowledge base.",
        "Use it as your PRIMARY source. Only search if you need additional detail.",
        "IMPORTANT: Include ALL relevant links mentioned in the answer — do not drop any URLs.",
        "",
    ]

    for m in matches:
        lines.append(f"### {m['topic']}")
        lines.append(m["answer"].strip())
        if m.get("source_name"):
            source_line = f"Source: {m['source_name']}"
            if m.get("source_url"):
                source_line += f" ({m['source_url']})"
            lines.append(source_line)
        if m["_stale"]:
            lines.append(
                "⚠ This entry has not been verified recently. "
                "Use web_search to confirm the information is still current "
                "before presenting it to the user."
            )

        # Append pre-fetched URL content (for entries with fetch_urls)
        for url in m.get("fetch_urls", []):
            content = fetched.get(url)
            if content:
                lines.append(f"\n#### Live data from {url}")
                lines.append(content)

        lines.append("")

    # Append semantic search results from ChromaDB
    if rag_content:
        lines.append("### Related scraped content (from knowledge base)")
        lines.append(rag_content)
        lines.append("")

    return "\n".join(lines)


async def async_lookup_and_format(query: str, village: str = "") -> str:
    """Async: lookup + RAG search + fetch URLs + format."""
    matches = lookup(query, village)
    if not matches:
        return ""

    # 1. Semantic search ChromaDB (free, local) — runs in parallel with fetch_urls
    from api.aio import run_sync
    rag_task = run_sync(_rag_search, query)

    # 2. Collect fetch_urls (if any entries have them)
    all_urls: list[str] = []
    for m in matches:
        all_urls.extend(m.get("fetch_urls", []))
    all_urls = list(dict.fromkeys(all_urls))  # dedupe

    if all_urls:
        rag_content, fetched = await asyncio.gather(
            rag_task, _fetch_urls(all_urls, query)
        )
    else:
        rag_content = await rag_task
        fetched = {}

    return format_context(matches, rag_content=rag_content, fetched=fetched)


def lookup_and_format(query: str, village: str = "") -> str:
    """Sync fallback (no URL fetching, no RAG). Use async_lookup_and_format when possible."""
    return format_context(lookup(query, village))
