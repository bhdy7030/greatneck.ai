"""Web search tool via Tavily API."""

import logging
import os

from tools.registry import tool

logger = logging.getLogger(__name__)

# Tavily best practice: keep queries under 400 chars
_MAX_QUERY_LEN = 400


@tool(
    name="web_search",
    description="Search the web for current information. Useful for finding up-to-date village meeting schedules, recent code amendments, or community news.",
)
async def web_search(query: str) -> str:
    """Perform a web search. Uses Tavily if configured, otherwise returns a placeholder."""
    from tools.budget import check_budget

    tavily_key = os.environ.get("TAVILY_API_KEY", "")

    if not tavily_key:
        return (
            f"Web search for '{query}' is not available. "
            "To enable web search, set the TAVILY_API_KEY environment variable. "
            "In the meantime, I can only search the local knowledge base. "
            "Try using the search_codes or search_permits tools instead."
        )

    # Check cache before consuming budget
    from tools.cache import tavily_cache_get, tavily_cache_set
    cached = tavily_cache_get("web", query)
    if cached is not None:
        logger.info(f"Web search cache hit: {query[:80]}")
        return cached

    blocked = check_budget()
    if blocked:
        return blocked

    # Truncate long queries (LLM sometimes generates verbose ones)
    search_query = query[:_MAX_QUERY_LEN] if len(query) > _MAX_QUERY_LEN else query

    result = await _tavily_search(search_query, tavily_key)
    tavily_cache_set("web", query, result)
    return result


async def _tavily_search(query: str, api_key: str) -> str:
    """Perform a search using the Tavily API."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": api_key,
                    "query": query,
                    "search_depth": "basic",  # 1 credit (vs 2 for advanced)
                    "max_results": 5,
                    "include_answer": True,
                },
            )
            response.raise_for_status()
            data = response.json()
    except Exception as e:
        return f"Web search error: {e}"

    parts = []
    if data.get("answer"):
        parts.append(f"Summary: {data['answer']}")

    for result in data.get("results", []):
        title = result.get("title", "")
        url = result.get("url", "")
        content = result.get("content", "")
        parts.append(f"- [{title}]({url})\n  {content[:300]}")

    if not parts:
        return f"No web results found for '{query}'."

    return "\n\n".join(parts)
