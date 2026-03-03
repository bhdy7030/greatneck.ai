"""General scrapers for village websites and permit form pages."""

import logging
import re
from dataclasses import dataclass
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


@dataclass
class PageContent:
    url: str
    title: str
    text: str
    links: list[dict]


@dataclass
class FormLink:
    name: str
    url: str
    file_type: str


async def scrape_village_site(url: str) -> dict:
    """Scrape a village website page and return structured content.

    Args:
        url: The URL to scrape.

    Returns:
        Dict with {url, title, text, links}.
    """
    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
        headers={"User-Agent": "GreatNeckAssistant/0.1 (community research)"},
    ) as client:
        try:
            response = await client.get(url)
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            return {"url": url, "error": f"HTTP {e.response.status_code}"}
        except httpx.RequestError as e:
            return {"url": url, "error": str(e)}

    soup = BeautifulSoup(response.text, "html.parser")

    # Remove non-content elements
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "iframe"]):
        tag.decompose()

    title = soup.title.string.strip() if soup.title and soup.title.string else ""

    # Get main content
    main = soup.find("main") or soup.find("article") or soup.find("body") or soup
    text = main.get_text(separator="\n", strip=True)

    # Extract links
    links = []
    for a in main.find_all("a", href=True):
        link_text = a.get_text(strip=True)
        href = a["href"]
        if link_text and href and not href.startswith("#") and not href.startswith("javascript:"):
            full_url = urljoin(url, href)
            links.append({"text": link_text, "url": full_url})

    return {
        "url": url,
        "title": title,
        "text": text[:15000],
        "links": links,
    }


async def scrape_permit_forms(url: str) -> list[dict]:
    """Scrape a permit forms page and find PDF/document download links.

    Args:
        url: The URL of the permits/forms page.

    Returns:
        List of dicts with {name, url, file_type}.
    """
    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
        headers={"User-Agent": "GreatNeckAssistant/0.1 (community research)"},
    ) as client:
        try:
            response = await client.get(url)
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            return [{"error": f"HTTP {e.response.status_code}", "url": url}]
        except httpx.RequestError as e:
            return [{"error": str(e), "url": url}]

    soup = BeautifulSoup(response.text, "html.parser")

    # Find all links to downloadable documents
    form_links = []
    seen_urls = set()

    # Pattern for document file extensions
    doc_pattern = re.compile(r"\.(pdf|doc|docx|xls|xlsx)$", re.IGNORECASE)

    for a in soup.find_all("a", href=True):
        href = a["href"]
        link_text = a.get_text(strip=True)
        full_url = urljoin(url, href)

        if full_url in seen_urls:
            continue

        # Check if it is a document link
        if doc_pattern.search(href):
            ext_match = doc_pattern.search(href)
            file_type = ext_match.group(1).lower() if ext_match else "unknown"
            form_links.append({
                "name": link_text or _filename_from_url(full_url),
                "url": full_url,
                "file_type": file_type,
            })
            seen_urls.add(full_url)
        elif _is_permit_related(link_text):
            # Also include links with permit-related text even if not a document
            form_links.append({
                "name": link_text,
                "url": full_url,
                "file_type": "link",
            })
            seen_urls.add(full_url)

    return form_links


def _filename_from_url(url: str) -> str:
    """Extract a filename from a URL."""
    path = url.rsplit("/", 1)[-1]
    path = path.split("?")[0]
    return path or "unknown"


def _is_permit_related(text: str) -> bool:
    """Check if link text is likely related to permits/forms."""
    if not text:
        return False
    keywords = [
        "permit", "application", "form", "building", "zoning",
        "variance", "inspection", "certificate", "occupancy",
        "plumbing", "electrical", "demolition", "fence", "driveway",
    ]
    text_lower = text.lower()
    return any(kw in text_lower for kw in keywords)
