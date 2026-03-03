"""Comprehensive scraper: village websites + ecode360 codes → knowledge base."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import httpx
from bs4 import BeautifulSoup
from rag.ingest import ingest_document
from rag.store import KnowledgeStore

# ─── Village Website Pages to Scrape ──────────────────────────────────────────
# Each entry: (village_name, category, label, url)
VILLAGE_PAGES = [
    # === Village of Great Neck ===
    ("Great Neck", "garbage", "Sanitation Pickup Schedule",
     "https://www.greatneckvillage.org/residents/sanitation_service_pick-up_schedule.php"),
    ("Great Neck", "garbage", "Special Garbage Pickup Request",
     "https://www.greatneckvillage.org/residents/special_garbage_pick-up_request.php"),
    ("Great Neck", "permits", "Building Department",
     "https://www.greatneckvillage.org/government/building_department.php"),
    ("Great Neck", "permits", "Building Department Forms",
     "https://www.greatneckvillage.org/permits_and_forms/building_forms.php"),
    ("Great Neck", "permits", "Permits and Forms Index",
     "https://www.greatneckvillage.org/permits_and_forms/index.php"),
    ("Great Neck", "permits", "Tag or Garage Sale Permit",
     "https://www.greatneckvillage.org/permits_and_forms/tag_or_garage_sale_permit.php"),
    ("Great Neck", "permits", "Village Parking Lot and Taxi Permits",
     "https://www.greatneckvillage.org/permits_and_forms/parking_and_taxi.php"),
    ("Great Neck", "permits", "Department of Public Works Forms",
     "https://www.greatneckvillage.org/permits_and_forms/department_of_public_works.php"),
    ("Great Neck", "general", "Residents Info",
     "https://www.greatneckvillage.org/residents/index.php"),
    ("Great Neck", "general", "Government Info",
     "https://www.greatneckvillage.org/government/index.php"),
    ("Great Neck", "general", "New Local Laws",
     "https://www.greatneckvillage.org/government/new_local_laws.php"),
    ("Great Neck", "general", "Zoning Maps",
     "https://www.greatneckvillage.org/government/zoning_maps/index.php"),
    ("Great Neck", "general", "Online Payments",
     "https://www.greatneckvillage.org/residents/online_payments.php"),
    ("Great Neck", "general", "Tax Exemption Applications",
     "https://www.greatneckvillage.org/residents/tax_exemption_applications/index.php"),

    # === Village of Great Neck Estates ===
    ("Great Neck Estates", "general", "Village Info",
     "https://www.greatneckestates.org"),

    # === Village of Great Neck Plaza ===
    ("Great Neck Plaza", "general", "Village Info",
     "https://www.greatneckplaza.net"),

    # === Village of Kings Point ===
    ("Kings Point", "general", "Village Info",
     "https://www.kingspointny.gov"),

    # === Village of Thomaston ===
    ("Thomaston", "general", "Village Info",
     "https://www.villagethomastony.com"),
]

# ─── ecode360 Village Codes ───────────────────────────────────────────────────
ECODE360_VILLAGES = {
    "Great Neck": "GR0590",
    "Great Neck Estates": "GR0594",
    "Great Neck Plaza": "GR0598",
    "Kensington": "KE0266",
    "Kings Point": "KI0382",
    "Thomaston": "TH0778",
}

ECODE360_BASE = "https://ecode360.com"


async def scrape_page(client: httpx.AsyncClient, url: str) -> str:
    """Fetch URL and extract clean text content."""
    try:
        resp = await client.get(url, follow_redirects=True, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"    ERROR fetching {url}: {e}")
        return ""

    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "iframe"]):
        tag.decompose()

    # Try main content area first
    main = soup.find("main") or soup.find("div", {"id": "content"}) or soup.find("div", {"class": "content"})
    target = main or soup.body or soup
    text = target.get_text(separator="\n", strip=True)

    # Skip very short pages (likely error pages or redirects)
    if len(text) < 50:
        return ""
    return text


async def scrape_village_websites(client: httpx.AsyncClient) -> int:
    """Scrape all village website pages and ingest."""
    print("\n" + "=" * 60)
    print("PHASE 1: Scraping Village Websites")
    print("=" * 60)

    total = 0
    for village, category, label, url in VILLAGE_PAGES:
        print(f"\n  [{village}] {label}")
        print(f"    URL: {url}")

        text = await scrape_page(client, url)
        if not text:
            print(f"    SKIP (empty or error)")
            continue

        print(f"    Content: {len(text)} chars")
        result = await ingest_document(
            content=text,
            source=f"{label} ({url})",
            village=village,
            category=category,
        )
        chunks = result.get("chunks", 0)
        total += chunks
        print(f"    Ingested: {chunks} chunks")

        await asyncio.sleep(0.5)  # Be polite

    print(f"\n  Village websites total: {total} chunks")
    return total


async def scrape_ecode360_toc(client: httpx.AsyncClient, village_code: str) -> list[dict]:
    """Get chapter links from ecode360 table of contents."""
    url = f"{ECODE360_BASE}/{village_code}"
    try:
        resp = await client.get(url, follow_redirects=True, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"    ERROR fetching TOC: {e}")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    chapters = []
    seen = set()

    # ecode360 chapter links contain numeric IDs
    for link in soup.find_all("a", href=True):
        href = link["href"]
        text = link.get_text(strip=True)
        # Match ecode360 chapter/section links (long numeric IDs)
        if "/laws/" in href or ("/print/" in href) or (href.startswith("/") and any(c.isdigit() for c in href)):
            # Normalize to full URL
            full_url = href if href.startswith("http") else f"{ECODE360_BASE}{href}"
            if full_url not in seen and text and len(text) > 5:
                seen.add(full_url)
                chapters.append({"title": text[:120], "url": full_url})

    return chapters


async def scrape_ecode360(client: httpx.AsyncClient) -> int:
    """Scrape village codes from ecode360 and ingest."""
    print("\n" + "=" * 60)
    print("PHASE 2: Scraping ecode360 Village Codes")
    print("=" * 60)

    total = 0
    for village, code in ECODE360_VILLAGES.items():
        print(f"\n  [{village}] ecode360 code: {code}")

        chapters = await scrape_ecode360_toc(client, code)
        print(f"    Found {len(chapters)} chapter links")

        if not chapters:
            continue

        # Limit to first 30 chapters to avoid very long scrapes
        for ch in chapters[:30]:
            text = await scrape_page(client, ch["url"])
            if not text or len(text) < 100:
                continue

            # Truncate very long chapters
            if len(text) > 15000:
                text = text[:15000] + "\n\n[Content truncated]"

            result = await ingest_document(
                content=text,
                source=f"ecode360 - {ch['title']}",
                village=village,
                category="codes",
            )
            chunks = result.get("chunks", 0)
            total += chunks
            if chunks:
                print(f"    {ch['title'][:50]}... → {chunks} chunks")

            await asyncio.sleep(0.5)

    print(f"\n  ecode360 total: {total} chunks")
    return total


async def scrape_community_resources(client: httpx.AsyncClient) -> int:
    """Scrape community resources (library, parks, schools)."""
    print("\n" + "=" * 60)
    print("PHASE 3: Scraping Community Resources")
    print("=" * 60)

    COMMUNITY_PAGES = [
        (None, "community", "Great Neck Library", "https://greatnecklibrary.org"),
        (None, "community", "Great Neck Library Children's Services", "https://greatnecklibrary.org/childrens-services/"),
        (None, "community", "Great Neck Park District", "https://www.gnparksny.gov"),
        (None, "community", "Great Neck School District Community Links",
         "https://www.greatneck.k12.ny.us/community/community-links"),
    ]

    total = 0
    for village, category, label, url in COMMUNITY_PAGES:
        print(f"\n  [Shared] {label}")
        text = await scrape_page(client, url)
        if not text:
            print(f"    SKIP")
            continue

        print(f"    Content: {len(text)} chars")
        result = await ingest_document(
            content=text,
            source=f"{label} ({url})",
            village=village,
            category=category,
        )
        chunks = result.get("chunks", 0)
        total += chunks
        print(f"    Ingested: {chunks} chunks")
        await asyncio.sleep(0.5)

    print(f"\n  Community resources total: {total} chunks")
    return total


async def main():
    print("GreatNeck Community Assistant — Full Data Scraper")
    print("=" * 60)

    # Clear existing data first
    store = KnowledgeStore()
    existing = store.list_collections()
    if existing:
        print(f"\nClearing {len(existing)} existing collections: {existing}")
        for coll_name in existing:
            try:
                store.client.delete_collection(coll_name)
            except Exception:
                pass

    async with httpx.AsyncClient(
        headers={"User-Agent": "GreatNeckAssistant/0.1 (community tool)"},
        timeout=30.0,
    ) as client:
        t1 = await scrape_village_websites(client)
        t2 = await scrape_ecode360(client)
        t3 = await scrape_community_resources(client)

    total = t1 + t2 + t3
    print(f"\n{'=' * 60}")
    print(f"DONE! Total chunks ingested: {total}")
    print(f"  Village websites: {t1}")
    print(f"  ecode360 codes:   {t2}")
    print(f"  Community:        {t3}")

    # Print final stats
    store2 = KnowledgeStore()
    for coll in store2.list_collections():
        stats = store2.get_stats(village=coll)
        print(f"  Collection '{coll}': {stats['document_count']} docs")


if __name__ == "__main__":
    asyncio.run(main())
