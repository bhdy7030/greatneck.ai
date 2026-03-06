"""Events API — public event listing + admin refresh endpoint."""
from __future__ import annotations

import logging
import re
from dataclasses import asdict
from datetime import datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import Response

from config import settings
from db import get_upcoming_events, get_event_by_id, upsert_event, cleanup_past_events

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


@router.get("/events/{event_id}/calendar")
async def event_calendar(event_id: int):
    """Generate an .ics calendar file for a specific event."""
    event = get_event_by_id(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Parse date — expect YYYY-MM-DD
    try:
        dt = datetime.strptime(event["event_date"], "%Y-%m-%d")
    except (ValueError, TypeError):
        raise HTTPException(status_code=500, detail="Invalid event date format")

    # Parse time if available (e.g. "7:00 PM", "14:00", "7pm")
    start_dt = dt
    if event.get("event_time"):
        time_str = event["event_time"].strip()
        for fmt in ("%I:%M %p", "%I:%M%p", "%I %p", "%I%p", "%H:%M"):
            try:
                t = datetime.strptime(time_str, fmt)
                start_dt = dt.replace(hour=t.hour, minute=t.minute)
                break
            except ValueError:
                continue

    end_dt = start_dt + timedelta(hours=1)

    # Format as iCalendar date-time (local time)
    def ical_dt(d: datetime) -> str:
        return d.strftime("%Y%m%dT%H%M%S")

    summary = (event.get("title") or "Event").replace("\\", "\\\\").replace(",", "\\,").replace("\n", "\\n")
    location = (event.get("venue") or event.get("location") or "").replace("\\", "\\\\").replace(",", "\\,").replace("\n", "\\n")
    description = (event.get("description") or "").replace("\\", "\\\\").replace(",", "\\,").replace("\n", "\\n")
    url = event.get("url") or ""

    tz = "America/New_York"
    ics = (
        "BEGIN:VCALENDAR\r\n"
        "VERSION:2.0\r\n"
        "PRODID:-//GreatNeck.ai//Events//EN\r\n"
        "BEGIN:VEVENT\r\n"
        f"DTSTART;TZID={tz}:{ical_dt(start_dt)}\r\n"
        f"DTEND;TZID={tz}:{ical_dt(end_dt)}\r\n"
        f"SUMMARY:{summary}\r\n"
        f"LOCATION:{location}\r\n"
        f"DESCRIPTION:{description}\r\n"
        f"URL:{url}\r\n"
        "END:VEVENT\r\n"
        "END:VCALENDAR\r\n"
    )

    filename = re.sub(r"[^a-zA-Z0-9_-]", "_", event.get("title", "event")[:50]) + ".ics"
    return Response(
        content=ics,
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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
