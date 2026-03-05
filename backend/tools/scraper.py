"""URL scraping tool for fetching and cleaning web content."""

import httpx
from tools.registry import tool


@tool(
    name="scrape_url",
    description="Fetch a URL and return its cleaned text content. Useful for reading village websites, code pages, or permit information online.",
)
async def scrape_url(url: str) -> str:
    """Fetch a URL, parse HTML, and return cleaned text content."""
    try:
        async with httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            headers={"User-Agent": "GreatNeck.ai/0.1"},
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
    except httpx.HTTPStatusError as e:
        return f"HTTP error fetching {url}: {e.response.status_code}"
    except httpx.RequestError as e:
        return f"Error fetching {url}: {e}"

    content_type = response.headers.get("content-type", "")
    if "text/html" in content_type:
        return _clean_html(response.text, url)
    elif "application/json" in content_type:
        return response.text[:10000]
    else:
        # Return raw text for other content types (truncated)
        return response.text[:10000]


def _clean_html(html: str, url: str) -> str:
    """Parse HTML and extract clean text content."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")

    # Remove non-content elements
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "iframe"]):
        tag.decompose()

    # Extract title
    title = soup.title.string.strip() if soup.title and soup.title.string else ""

    # Get main content (prefer <main> or <article> if present)
    main = soup.find("main") or soup.find("article") or soup.find("body") or soup
    text = main.get_text(separator="\n", strip=True)

    # Clean up excessive whitespace
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    cleaned = "\n".join(lines)

    # Truncate if very long
    if len(cleaned) > 15000:
        cleaned = cleaned[:15000] + "\n\n[Content truncated...]"

    result = f"URL: {url}\n"
    if title:
        result += f"Title: {title}\n"
    result += f"\n{cleaned}"
    return result
