"""Scraper for ecode360.com village codes."""

import asyncio
import logging
import re
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BASE_URL = "https://ecode360.com"


@dataclass
class CodeSection:
    chapter: str
    section: str
    text: str


async def scrape_village_codes(village_code: str) -> list[dict]:
    """Scrape all village codes from ecode360.com for a given village code.

    For Great Neck, the code is "GR0590" at https://ecode360.com/GR0590.

    Args:
        village_code: The ecode360 village identifier (e.g., "GR0590").

    Returns:
        List of dicts with {chapter, section, text}.
    """
    toc_url = f"{BASE_URL}/{village_code}"
    logger.info(f"Fetching table of contents from {toc_url}")

    async with httpx.AsyncClient(
        timeout=30.0,
        follow_redirects=True,
        headers={"User-Agent": "GreatNeck.ai/0.1 (community research)"},
    ) as client:
        # Step 1: Get the table of contents
        chapters = await _fetch_chapter_list(client, toc_url)
        if not chapters:
            logger.warning(f"No chapters found for {village_code}")
            return []

        logger.info(f"Found {len(chapters)} chapters for {village_code}")

        # Step 2: Fetch each chapter's content (with rate limiting)
        all_sections = []
        for chapter_name, chapter_url in chapters:
            try:
                sections = await _fetch_chapter_content(client, chapter_name, chapter_url)
                all_sections.extend(sections)
                # Be polite: rate limit requests
                await asyncio.sleep(1.0)
            except Exception as e:
                logger.error(f"Error fetching chapter '{chapter_name}': {e}")
                continue

        logger.info(f"Scraped {len(all_sections)} sections total for {village_code}")
        return [{"chapter": s.chapter, "section": s.section, "text": s.text} for s in all_sections]


async def _fetch_chapter_list(client: httpx.AsyncClient, toc_url: str) -> list[tuple[str, str]]:
    """Fetch and parse the table of contents to get chapter URLs."""
    response = await client.get(toc_url)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    chapters = []

    # ecode360 typically lists chapters as links in the TOC
    for link in soup.find_all("a", href=True):
        href = link["href"]
        text = link.get_text(strip=True)

        # Match chapter links (typically numeric IDs or paths)
        if re.search(r"/\d{7,}", href) and text:
            full_url = href if href.startswith("http") else f"{BASE_URL}{href}"
            chapters.append((text, full_url))

    # Deduplicate while preserving order
    seen = set()
    unique_chapters = []
    for name, url in chapters:
        if url not in seen:
            seen.add(url)
            unique_chapters.append((name, url))

    return unique_chapters


async def _fetch_chapter_content(
    client: httpx.AsyncClient, chapter_name: str, chapter_url: str
) -> list[CodeSection]:
    """Fetch a single chapter page and extract its sections."""
    response = await client.get(chapter_url)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    sections = []

    # ecode360 wraps code content in specific div structures
    # Try to find section containers
    content_div = soup.find("div", class_="lawContent") or soup.find("div", id="lawContent") or soup

    # Look for section headers
    section_pattern = re.compile(r"^(?:Section|§)\s+[\d\-\.]+", re.IGNORECASE)
    current_section = ""
    current_text_parts: list[str] = []

    for element in content_div.find_all(["h1", "h2", "h3", "h4", "h5", "p", "div", "li"]):
        text = element.get_text(strip=True)
        if not text:
            continue

        # Check if this is a section header
        if section_pattern.match(text) or element.name in ("h1", "h2", "h3"):
            # Save previous section
            if current_section and current_text_parts:
                full_text = "\n".join(current_text_parts)
                sections.append(CodeSection(
                    chapter=chapter_name,
                    section=current_section,
                    text=full_text,
                ))
            current_section = text
            current_text_parts = [text]
        elif current_section:
            current_text_parts.append(text)

    # Don't forget the last section
    if current_section and current_text_parts:
        full_text = "\n".join(current_text_parts)
        sections.append(CodeSection(
            chapter=chapter_name,
            section=current_section,
            text=full_text,
        ))

    # If no sections were found, treat the whole page as one chunk
    if not sections:
        page_text = content_div.get_text(separator="\n", strip=True)
        if page_text.strip():
            sections.append(CodeSection(
                chapter=chapter_name,
                section=chapter_name,
                text=page_text[:10000],  # Limit very large pages
            ))

    return sections


def format_section_for_ingestion(section: dict, village_code: str) -> str:
    """Format an ecode360 section dict for consistent chunking.

    Prepends chapter and section headers to the text body so the chunker
    has full context even after splitting.
    """
    chapter = section.get("chapter", "")
    sec_header = section.get("section", "")
    text = section.get("text", "")

    parts = [f"Village Code: {village_code}"]
    if chapter:
        parts.append(f"Chapter: {chapter}")
    if sec_header and sec_header != chapter:
        parts.append(f"Section: {sec_header}")
    parts.append("")
    parts.append(text)
    return "\n".join(parts)
