"""Unified ingestion CLI: all data sources in one script.

Replaces ingest_community.py. Covers:
  codes     — ecode360 village codes (per-village collections)
  sites     — village website pages (per-village collections)
  community — Reddit, Yelp, Google Reviews, news (shared collection)
  knowledge — local knowledge files: permits guide, inspection timing (shared collection)
  all       — everything (default)

Usage:
    python -m scripts.ingest_all [--dry-run] [--village VILLAGE_ID] [SOURCE...]

Examples:
    python -m scripts.ingest_all codes --village great_neck --dry-run
    python -m scripts.ingest_all codes sites --village great_neck
    python -m scripts.ingest_all community
    python -m scripts.ingest_all knowledge
    python -m scripts.ingest_all  # all sources
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

# Ensure backend/ is on the path so imports resolve
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from api.villages import VILLAGES, VillageInfo  # noqa: E402
from rag.ingest import ingest_document  # noqa: E402
from scrapers.ecode360 import scrape_village_codes, format_section_for_ingestion  # noqa: E402
from scrapers.social import scrape_community, format_post_for_ingestion  # noqa: E402
from scrapers.village_sites import scrape_village_site, village_subpage_urls  # noqa: E402
from scrapers.events import scrape_all_events  # noqa: E402
from db import init_db, upsert_event, cleanup_past_events  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "knowledge"
VALID_SOURCES = {"codes", "sites", "community", "knowledge", "events", "all"}
MIN_CONTENT_LENGTH = 50


# ---------------------------------------------------------------------------
# Per-source ingestion functions
# ---------------------------------------------------------------------------

async def ingest_codes(villages: list[VillageInfo], dry_run: bool) -> dict:
    """Scrape and ingest ecode360 village codes."""
    total_chunks = 0
    total_sections = 0

    for v in villages:
        logger.info(f"[codes] Scraping ecode360 for {v.name} ({v.ecode360_code})...")
        try:
            sections = await scrape_village_codes(v.ecode360_code)
        except Exception as e:
            logger.error(f"[codes] Failed to scrape {v.name}: {e}")
            continue
        if not sections:
            logger.warning(f"[codes] No sections found for {v.name}")
            continue

        total_sections += len(sections)
        for sec in sections:
            content = format_section_for_ingestion(sec, v.ecode360_code)
            if len(content) < MIN_CONTENT_LENGTH:
                continue

            if dry_run:
                chapter = sec.get("chapter", "?")
                section = sec.get("section", "?")
                print(f"  [codes] {v.name}: {chapter} > {section} ({len(content)} chars)")
                total_chunks += 1
                continue

            result = await ingest_document(
                content=content,
                source=f"ecode360:{v.ecode360_code}",
                village=v.name,
                category="codes",
            )
            if result["status"] == "ok":
                total_chunks += result["chunks"]

    return {"source": "codes", "sections": total_sections, "chunks": total_chunks}


async def ingest_sites(villages: list[VillageInfo], dry_run: bool) -> dict:
    """Scrape and ingest village website pages."""
    total_pages = 0
    total_chunks = 0

    for v in villages:
        urls = [v.website] + village_subpage_urls(v.website)
        for url in urls:
            logger.info(f"[sites] Scraping {url} for {v.name}...")
            page = await scrape_village_site(url)

            if "error" in page:
                logger.warning(f"[sites] Skipping {url}: {page['error']}")
                continue

            text = page.get("text", "")
            title = page.get("title", url)
            if len(text) < MIN_CONTENT_LENGTH:
                continue

            total_pages += 1

            if dry_run:
                print(f"  [sites] {v.name}: {title} ({len(text)} chars) — {url}")
                total_chunks += 1
                continue

            result = await ingest_document(
                content=text,
                source=title,
                village=v.name,
                category="general",
                url=url,
            )
            if result["status"] == "ok":
                total_chunks += result["chunks"]

    return {"source": "sites", "pages": total_pages, "chunks": total_chunks}


async def ingest_community_data(dry_run: bool) -> dict:
    """Scrape and ingest community/social posts (shared collection)."""
    logger.info("[community] Scraping Reddit, Yelp, Google, news, RedNote...")
    posts = await scrape_community()

    ingested = 0
    skipped = 0

    for post in posts:
        content = format_post_for_ingestion(post)
        if len(content) < MIN_CONTENT_LENGTH:
            skipped += 1
            continue

        if dry_run:
            print(f"  [community] [{post.source_type}] {post.title[:80]} ({len(content)} chars)")
            ingested += 1
            continue

        result = await ingest_document(
            content=content,
            source=post.source_type or "Community",
            village=None,
            category="community",
            url=post.url,
        )
        if result["status"] == "ok":
            ingested += 1
        else:
            skipped += 1

    return {"source": "community", "ingested": ingested, "skipped": skipped, "total_posts": len(posts)}


async def ingest_knowledge(dry_run: bool) -> dict:
    """Ingest local knowledge files (permits guide, inspection timing)."""
    files = [
        ("permits_and_inspections.txt", "Permit & Inspection Procedures — Great Neck Area Villages", "permits"),
        ("critical_inspection_timing.txt", "Critical Inspection Timing Guide", "permits"),
    ]

    total_chunks = 0

    for filename, source_name, category in files:
        filepath = KNOWLEDGE_DIR / filename
        if not filepath.exists():
            logger.warning(f"[knowledge] File not found: {filepath}")
            continue

        content = filepath.read_text(encoding="utf-8")
        if not content.strip():
            continue

        if dry_run:
            print(f"  [knowledge] {source_name} ({len(content)} chars) — {filepath.name}")
            total_chunks += 1
            continue

        result = await ingest_document(
            content=content,
            source=source_name,
            village=None,
            category=category,
        )
        if result["status"] == "ok":
            total_chunks += result["chunks"]
            logger.info(f"[knowledge] Ingested {source_name}: {result['chunks']} chunks")

    return {"source": "knowledge", "chunks": total_chunks}


async def ingest_events(dry_run: bool) -> dict:
    """Scrape and store upcoming events in SQLite events table."""
    from dataclasses import asdict

    logger.info("[events] Scraping all event sources...")
    events = await scrape_all_events()

    if not dry_run:
        init_db()

    stored = 0
    for event in events:
        if dry_run:
            print(f"  [events] [{event.source}] {event.event_date} — {event.title[:80]}")
            stored += 1
            continue

        try:
            upsert_event(asdict(event))
            stored += 1
        except Exception as e:
            logger.warning(f"[events] Failed to upsert '{event.title}': {e}")

    if not dry_run:
        cleanup_past_events()

    logger.info(f"[events] Stored {stored}/{len(events)} events")
    return {"source": "events", "scraped": len(events), "stored": stored}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _resolve_villages(village_id: str | None) -> list[VillageInfo]:
    """Return the list of villages to process."""
    if not village_id:
        return list(VILLAGES)
    matches = [v for v in VILLAGES if v.id == village_id]
    if not matches:
        valid_ids = ", ".join(v.id for v in VILLAGES)
        logger.error(f"Unknown village '{village_id}'. Valid: {valid_ids}")
        sys.exit(1)
    return matches


async def main():
    parser = argparse.ArgumentParser(
        description="Unified ingestion: scrape & ingest all data sources into the knowledge base.",
    )
    parser.add_argument(
        "sources",
        nargs="*",
        default=["all"],
        help="Sources to ingest: codes, sites, community, knowledge, all (default: all)",
    )
    parser.add_argument(
        "--village",
        type=str,
        default=None,
        help="Only process a specific village (by ID, e.g. great_neck). Applies to codes/sites.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview what would be ingested without writing to the store.",
    )
    args = parser.parse_args()

    sources = set(args.sources)
    invalid = sources - VALID_SOURCES
    if invalid:
        logger.error(f"Unknown sources: {invalid}. Valid: {VALID_SOURCES}")
        sys.exit(1)

    run_all = "all" in sources
    villages = _resolve_villages(args.village)

    if args.dry_run:
        print("\n=== DRY RUN — nothing will be ingested ===\n")

    results: list[dict] = []

    if run_all or "codes" in sources:
        results.append(await ingest_codes(villages, args.dry_run))

    if run_all or "sites" in sources:
        results.append(await ingest_sites(villages, args.dry_run))

    if run_all or "community" in sources:
        results.append(await ingest_community_data(args.dry_run))

    if run_all or "knowledge" in sources:
        results.append(await ingest_knowledge(args.dry_run))

    if run_all or "events" in sources:
        results.append(await ingest_events(args.dry_run))

    # Summary
    print(f"\n{'='*50}")
    action = "DRY RUN" if args.dry_run else "INGESTION"
    print(f"  {action} SUMMARY")
    print(f"{'='*50}")
    for r in results:
        src = r.pop("source")
        details = ", ".join(f"{k}: {v}" for k, v in r.items())
        print(f"  {src:12s} — {details}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
