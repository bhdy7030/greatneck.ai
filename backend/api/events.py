"""Events API — public event listing + admin refresh endpoint."""
from __future__ import annotations

import logging
from dataclasses import asdict

from fastapi import APIRouter, Header, HTTPException, Query

from config import settings
from db import get_upcoming_events, upsert_event, cleanup_past_events

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/events")
async def list_events(
    village: str = Query(default="", description="Village name for scoped events"),
    limit: int = Query(default=8, ge=1, le=50),
    category: str = Query(default="", description="Filter by category"),
):
    """Get upcoming events with waterfall fallback (village → area → longisland)."""
    events = get_upcoming_events(
        village=village or None,
        limit=limit,
        category=category or None,
    )
    return events


@router.post("/admin/events/refresh")
async def refresh_events(
    x_cron_secret: str = Header(default="", alias="X-Cron-Secret"),
):
    """Trigger event scrape + upsert + cleanup. Protected by X-Cron-Secret header."""
    if not settings.cron_secret:
        raise HTTPException(status_code=503, detail="Cron secret not configured")
    if x_cron_secret != settings.cron_secret:
        raise HTTPException(status_code=403, detail="Invalid cron secret")

    from scrapers.events import scrape_all_events

    events = await scrape_all_events()

    upserted = 0
    for event in events:
        try:
            upsert_event(asdict(event))
            upserted += 1
        except Exception as e:
            logger.warning(f"[events:refresh] Failed to upsert '{event.title}': {e}")

    cleanup_past_events()

    return {"status": "ok", "scraped": len(events), "upserted": upserted}
