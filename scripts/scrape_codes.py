"""Bootstrap script: scrape Great Neck village codes from ecode360 and ingest."""

import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import httpx
from bs4 import BeautifulSoup
from rag.ingest import ingest_document, ingest_html

# ecode360 village codes
VILLAGE_CODES = {
    "Great Neck": "GR0590",
    "Great Neck Estates": "GR0594",
    "Great Neck Plaza": "GR0598",
    "Kensington": "KE0266",
    "Kings Point": "KI0382",
    "Thomaston": "TH0778",
}

ECODE360_BASE = "https://ecode360.com"


async def get_chapter_list(client: httpx.AsyncClient, village_code: str) -> list[dict]:
    """Get list of chapters/sections from a village's ecode360 page."""
    url = f"{ECODE360_BASE}/{village_code}"
    print(f"  Fetching table of contents from {url}")

    resp = await client.get(url, follow_redirects=True)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    chapters = []

    # ecode360 uses links with class patterns for chapter entries
    for link in soup.select("a[href*='/laws/']"):
        href = link.get("href", "")
        title = link.get_text(strip=True)
        if title and href and len(title) > 3:
            full_url = href if href.startswith("http") else f"{ECODE360_BASE}{href}"
            chapters.append({"title": title, "url": full_url})

    return chapters


async def scrape_chapter(client: httpx.AsyncClient, chapter: dict) -> str:
    """Scrape the full text of a single chapter page."""
    print(f"    Scraping: {chapter['title'][:60]}...")

    try:
        resp = await client.get(chapter["url"], follow_redirects=True, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"    Error fetching {chapter['url']}: {e}")
        return ""

    soup = BeautifulSoup(resp.text, "html.parser")

    # Remove navigation, scripts, styles
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()

    # Try to find the main content area
    content = soup.find("div", class_="lawContent") or soup.find("main") or soup.body
    if not content:
        return ""

    return content.get_text(separator="\n", strip=True)


async def scrape_village(village_name: str, village_code: str) -> int:
    """Scrape all codes for a single village and ingest them."""
    print(f"\n{'='*60}")
    print(f"Scraping: {village_name} (code: {village_code})")
    print(f"{'='*60}")

    async with httpx.AsyncClient() as client:
        chapters = await get_chapter_list(client, village_code)
        print(f"  Found {len(chapters)} chapters/sections")

        if not chapters:
            print("  No chapters found, skipping.")
            return 0

        total_chunks = 0

        for chapter in chapters:
            text = await scrape_chapter(client, chapter)
            if not text or len(text) < 100:
                continue

            result = await ingest_document(
                content=text,
                source=f"ecode360 - {chapter['title']}",
                village=village_name,
                category="codes",
            )

            chunks = result.get("chunks", 0)
            total_chunks += chunks
            if chunks:
                print(f"    Ingested: {chunks} chunks")

            # Be respectful with rate limiting
            await asyncio.sleep(0.5)

        print(f"  Total chunks ingested for {village_name}: {total_chunks}")
        return total_chunks


async def main():
    """Scrape village codes from ecode360 and ingest into knowledge store."""
    print("GreatNeck Village Code Scraper")
    print("=" * 60)

    # Allow filtering to specific village via CLI arg
    target = sys.argv[1] if len(sys.argv) > 1 else None

    grand_total = 0
    for village_name, village_code in VILLAGE_CODES.items():
        if target and target.lower() not in village_name.lower():
            continue

        count = await scrape_village(village_name, village_code)
        grand_total += count

    print(f"\n{'='*60}")
    print(f"Done. Total chunks ingested across all villages: {grand_total}")


if __name__ == "__main__":
    asyncio.run(main())
