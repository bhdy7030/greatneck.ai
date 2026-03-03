"""Knowledge store search tools for village codes."""

import re
from tools.registry import tool
from rag.store import KnowledgeStore

_store = KnowledgeStore()

# L2 distance threshold; results above this are likely irrelevant
RELEVANCE_THRESHOLD = 1.2


def _filter_relevant(results: list[dict], threshold: float = RELEVANCE_THRESHOLD) -> list[dict]:
    """Filter out search results with distance above the relevance threshold."""
    return [r for r in results if (r.get("distance") or 0) <= threshold]

# Matches a URL inside parentheses at the end of a source string
# Handles both full URLs (https://...) and bare domains (ecode360.com/...)
_URL_IN_PARENS = re.compile(r"\(((?:https?://)?[\w\-]+(?:\.[\w\-]+)+(?:/[^\)]*)?)\)\s*$")


def _parse_source_url(source_raw: str) -> tuple[str, str]:
    """Extract (clean_name, url) from a source string like 'Name (https://example.com)'."""
    m = _URL_IN_PARENS.search(source_raw)
    if not m:
        return source_raw, ""
    url = m.group(1)
    if not url.startswith("http"):
        url = "https://" + url
    name = source_raw[: m.start()].strip()
    return name, url


def _source_and_url(meta: dict) -> tuple[str, str]:
    """Get (source_name, url) from chunk metadata. Prefers dedicated 'url' field."""
    source_raw = meta.get("source", "Unknown")
    url = meta.get("url", "")
    if url:
        # URL is stored as a proper field; source name should already be clean
        return source_raw, url
    # Fallback: try to extract URL from source name (legacy data)
    return _parse_source_url(source_raw)


@tool(
    name="search_codes",
    description="Search village code documents for relevant sections. Returns formatted results with citations. Use this to find zoning rules, building codes, permit requirements, etc.",
)
async def search_codes(query: str, village: str = "") -> str:
    """Search the knowledge store for village code chunks matching the query."""
    results = _store.search(query, village=village or None, n_results=5)
    results = _filter_relevant(results)
    if not results:
        return (
            "No relevant results found in local knowledge base for this query. "
            "This village may have limited data coverage. "
            "Consider using web_search to find this information online."
        )

    formatted_parts = []
    for i, doc in enumerate(results, 1):
        meta = doc.get("metadata", {})
        source_name, url = _source_and_url(meta)
        section = meta.get("section", "")
        distance = doc.get("distance")
        header = f"[{i}] {source_name}"
        if section:
            header += f" - {section}"
        if distance is not None:
            header += f" (relevance: {1 - distance:.2f})"
        lines = [header]
        if url:
            lines.append(f"url: {url}")
        lines.append(doc["text"])
        formatted_parts.append("\n".join(lines))

    return "\n\n---\n\n".join(formatted_parts)


@tool(
    name="get_code_section",
    description="Retrieve a specific code section by its section identifier (e.g., 'Section 237-4'). Use this when you need the full text of a known section.",
)
async def get_code_section(section_id: str, village: str = "") -> str:
    """Search for a specific code section by section metadata."""
    # First try filtering by section metadata
    results = _store.search(
        section_id,
        village=village or None,
        n_results=3,
        where={"section": section_id},
    )

    # If no results with exact metadata match, fall back to text search
    if not results:
        results = _store.search(section_id, village=village or None, n_results=3)

    if not results:
        return f"Section '{section_id}' not found. It may not be in the knowledge base yet."

    # Return the best match (full text)
    best = results[0]
    meta = best.get("metadata", {})
    source_name, url = _source_and_url(meta)
    section = meta.get("section", section_id)
    lines = [f"Source: {source_name}", f"Section: {section}"]
    if url:
        lines.append(f"url: {url}")
    lines.append(f"\n{best['text']}")
    return "\n".join(lines)
