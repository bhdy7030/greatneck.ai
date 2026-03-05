"""Community knowledge base search tool."""
from __future__ import annotations

from tools.registry import tool
from tools.search import _filter_relevant, _source_and_url
from rag.store import KnowledgeStore

_store = KnowledgeStore()


@tool(
    name="search_community",
    description=(
        "Search the community knowledge base for resident discussions, school reviews, "
        "neighborhood experiences, and local community info. Returns results from "
        "ingested Reddit posts and community sources. Use this BEFORE search_reddit "
        "for faster cached results."
    ),
)
async def search_community(query: str, village: str = "") -> str:
    """Search ChromaDB for community-category documents."""
    # Search village-specific collection for community content
    village_results = _store.search(
        query,
        village=village or None,
        n_results=5,
        where={"category": "community"},
    )
    # Also search shared collection (Reddit posts go here)
    shared_results = _store.search(
        query,
        village=None,
        n_results=5,
        where={"category": "community"},
    )

    results = _filter_relevant(village_results + shared_results)

    if not results:
        return (
            "No community discussions found in knowledge base for this query. "
            "Try search_reddit for live Reddit results, or web_search for broader coverage."
        )

    formatted_parts = []
    for i, doc in enumerate(results, 1):
        meta = doc.get("metadata", {})
        source_name, url = _source_and_url(meta)
        distance = doc.get("distance")
        header = f"[{i}] {source_name}"
        if distance is not None:
            header += f" (relevance: {1 - distance:.2f})"
        lines = [header]
        if url:
            lines.append(f"url: {url}")
        lines.append(doc["text"])
        formatted_parts.append("\n".join(lines))

    return "\n\n---\n\n".join(formatted_parts)
