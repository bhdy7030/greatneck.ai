"""Web search tool (placeholder / Tavily integration)."""

import os
from tools.registry import tool


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

    blocked = check_budget()
    if blocked:
        return blocked

    return await _tavily_search(query, tavily_key)


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
