"""Events API — public event listing + admin refresh endpoint."""
from __future__ import annotations

import logging
import re
import time
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query
from fastapi.responses import Response

from config import settings
from db import get_upcoming_events, get_event_by_id, upsert_event, cleanup_past_events, _exec_one
from api.aio import run_sync
from api.deps import require_admin
from cache.redis_client import redis_set, redis_get

_CRON_KEY = "events:cron:last_run"

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/events")
async def list_events(
    village: str = Query(default="", description="Village name for scoped events"),
    limit: int = Query(default=8, ge=1, le=100),
    category: str = Query(default="", description="Filter by category"),
    lang: str = Query(default="en", description="Language code (en or zh)"),
):
    """Get upcoming events with waterfall fallback (village → area → longisland)."""
    events = await run_sync(
        get_upcoming_events,
        village=village or None,
        limit=limit,
        category=category or None,
    )
    if lang == "zh":
        for e in events:
            if e.get("title_zh"):
                e["title"] = e["title_zh"]
            if e.get("description_zh"):
                e["description"] = e["description_zh"]
            if e.get("venue_zh"):
                e["venue"] = e["venue_zh"]
    # Strip _zh fields from response
    for e in events:
        e.pop("title_zh", None)
        e.pop("description_zh", None)
        e.pop("venue_zh", None)
    return events


@router.get("/events/{event_id}/calendar")
async def event_calendar(event_id: str):
    """Generate an .ics calendar file for a specific event.

    Accepts source_id (stable hash, preferred), numeric DB id, or UUID from source URL.
    """
    event = None
    # Try source_id first (stable across DB refreshes)
    event = await run_sync(
        _exec_one,
        "SELECT * FROM events WHERE source_id=?",
        "SELECT * FROM events WHERE source_id=%s",
        (event_id,),
    )
    if not event and event_id.isdigit():
        # Fallback: legacy numeric DB id
        event = await run_sync(get_event_by_id, int(event_id))
    if not event:
        # Fallback: UUID from source URL
        event = await run_sync(
            _exec_one,
            "SELECT * FROM events WHERE url LIKE ?",
            "SELECT * FROM events WHERE url LIKE %s",
            (f"%{event_id}%",),
        )
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


async def _do_refresh():
    """Background: scrape, upsert, cleanup, translate. Records run status in Redis."""
    from scrapers.events import scrape_all_events

    started_at = datetime.now(timezone.utc)
    start_mono = time.monotonic()

    redis_set(_CRON_KEY, {
        "status": "running",
        "started_at": started_at.isoformat(),
        "finished_at": None,
        "duration_ms": None,
        "scraped": None,
        "upserted": None,
        "translated": None,
        "prompt_tokens": None,
        "completion_tokens": None,
        "cost_usd": None,
        "error": None,
    }, ttl=86400 * 7)

    try:
        events = await scrape_all_events()

        upserted = 0
        for event in events:
            try:
                await run_sync(upsert_event, asdict(event))
                upserted += 1
            except Exception as e:
                logger.warning(f"[events:refresh] Failed to upsert '{event.title}': {e}")

        await run_sync(cleanup_past_events)

        # Translate new/changed events to Chinese
        translate_started = datetime.now(timezone.utc)
        translated = 0
        try:
            from llm.translate import translate_untranslated_events
            translated = await translate_untranslated_events()
        except Exception as e:
            logger.warning(f"[events:refresh] Translation failed (non-blocking): {e}")

        # Sum token usage recorded to llm_usage during the translation window
        ts_str = translate_started.strftime("%Y-%m-%d %H:%M:%S")
        usage = await run_sync(
            _exec_one,
            "SELECT SUM(prompt_tokens) as pt, SUM(completion_tokens) as ct, SUM(cost_usd) as cost FROM llm_usage WHERE role='translation' AND created_at >= ?",
            "SELECT SUM(prompt_tokens) as pt, SUM(completion_tokens) as ct, SUM(cost_usd) as cost FROM llm_usage WHERE role='translation' AND created_at >= %s",
            (ts_str,),
        ) or {}

        finished_at = datetime.now(timezone.utc)
        duration_ms = int((time.monotonic() - start_mono) * 1000)

        redis_set(_CRON_KEY, {
            "status": "success",
            "started_at": started_at.isoformat(),
            "finished_at": finished_at.isoformat(),
            "duration_ms": duration_ms,
            "scraped": len(events),
            "upserted": upserted,
            "translated": translated,
            "prompt_tokens": int(usage.get("pt") or 0),
            "completion_tokens": int(usage.get("ct") or 0),
            "cost_usd": float(usage.get("cost") or 0.0),
            "error": None,
        }, ttl=86400 * 7)

        logger.info(f"[events:refresh] Done — scraped={len(events)} upserted={upserted} translated={translated}")
    except Exception as e:
        finished_at = datetime.now(timezone.utc)
        duration_ms = int((time.monotonic() - start_mono) * 1000)
        redis_set(_CRON_KEY, {
            "status": "error",
            "started_at": started_at.isoformat(),
            "finished_at": finished_at.isoformat(),
            "duration_ms": duration_ms,
            "scraped": None, "upserted": None, "translated": None,
            "prompt_tokens": None, "completion_tokens": None, "cost_usd": None,
            "error": str(e),
        }, ttl=86400 * 7)
        logger.error(f"[events:refresh] Background refresh failed: {e}")


@router.post("/admin/events/refresh")
async def refresh_events(
    background_tasks: BackgroundTasks,
    x_cron_secret: str = Header(default="", alias="X-Cron-Secret"),
):
    """Trigger event scrape + upsert + cleanup. Runs in background, returns immediately."""
    if not settings.cron_secret:
        raise HTTPException(status_code=503, detail="Cron secret not configured")
    if x_cron_secret != settings.cron_secret:
        raise HTTPException(status_code=403, detail="Invalid cron secret")

    background_tasks.add_task(_do_refresh)
    return {"status": "accepted", "message": "Refresh started in background"}


@router.get("/admin/events/cron-status")
async def get_cron_status(user: dict = Depends(require_admin)):
    """Return last run metadata for the events cron job."""
    data = redis_get(_CRON_KEY)
    return data or {"status": "never_run"}


@router.post("/admin/events/trigger")
async def trigger_events_refresh(
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_admin),
):
    """Trigger event refresh from admin UI (JWT auth, not cron secret)."""
    current = redis_get(_CRON_KEY)
    if current and current.get("status") == "running":
        return {"status": "already_running"}
    background_tasks.add_task(_do_refresh)
    return {"status": "accepted"}
