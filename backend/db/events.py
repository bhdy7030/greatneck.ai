"""Event upsert, upcoming events, cleanup."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from db.connection import _exec, _exec_one, _exec_modify

_ET = ZoneInfo("America/New_York")


def upsert_event(event: dict) -> dict:
    """Insert or update an event. Deduplicates by (source, source_id)."""
    now = datetime.now(_ET).isoformat()
    params = (
        event.get("title", ""),
        event.get("description", ""),
        event["event_date"],
        event.get("event_time", ""),
        event.get("end_date"),
        event.get("location", ""),
        event.get("venue", ""),
        event.get("url", ""),
        event.get("image_url", ""),
        event.get("category", "general"),
        event.get("scope", "area"),
        event.get("village", ""),
        event.get("source", ""),
        event.get("source_id", ""),
        now,
        now,
        now,
    )
    _exec_modify(
        """INSERT INTO events (title, description, event_date, event_time, end_date,
               location, venue, url, image_url, category, scope, village,
               source, source_id, created_at, updated_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT(source, source_id) DO UPDATE SET
             title=EXCLUDED.title, description=EXCLUDED.description,
             event_date=EXCLUDED.event_date, event_time=EXCLUDED.event_time,
             end_date=EXCLUDED.end_date, location=EXCLUDED.location,
             venue=EXCLUDED.venue, url=EXCLUDED.url, image_url=EXCLUDED.image_url,
             category=EXCLUDED.category, scope=EXCLUDED.scope, village=EXCLUDED.village,
             title_zh = CASE WHEN events.title = EXCLUDED.title THEN events.title_zh ELSE NULL END,
             description_zh = CASE WHEN events.description = EXCLUDED.description THEN events.description_zh ELSE NULL END,
             venue_zh = CASE WHEN events.venue = EXCLUDED.venue THEN events.venue_zh ELSE NULL END,
             updated_at=%s""",
        params,
    )
    row = _exec_one(
        "SELECT * FROM events WHERE source=%s AND source_id=%s",
        (event.get("source", ""), event.get("source_id", "")),
    )
    return row if row else event


def get_upcoming_events(
    village: str | None = None,
    limit: int = 8,
    category: str | None = None,
) -> list[dict]:
    """Get upcoming events with waterfall fallback."""
    today = datetime.now(_ET).strftime("%Y-%m-%d")
    results: list[dict] = []
    seen_ids: set[int] = set()

    def _fetch(where_clause: str, params: tuple, max_rows: int) -> list[dict]:
        base_sql = f"""
            SELECT * FROM events
            WHERE event_date >= %s {where_clause}
            ORDER BY event_date ASC, event_time ASC
            LIMIT %s
        """
        rows = _exec(base_sql, (today, *params, max_rows))
        fetched = []
        for d in rows:
            if d["id"] not in seen_ids:
                seen_ids.add(d["id"])
                fetched.append(d)
        return fetched

    if village:
        village_events = _fetch("AND scope=%s AND village=%s", ("village", village), limit)
        results.extend(village_events)

    if len(results) < limit:
        area_events = _fetch("AND scope=%s", ("area",), limit - len(results))
        results.extend(area_events)

    if len(results) < limit:
        li_events = _fetch(
            "AND scope=%s AND category IN (%s,%s,%s)",
            ("longisland", "entertainment", "food", "festival"),
            limit - len(results),
        )
        results.extend(li_events)

    if len(results) < limit:
        extra = _fetch("AND scope=%s", ("longisland",), limit - len(results))
        results.extend(extra)

    results.sort(key=lambda e: (e.get("event_date", ""), e.get("event_time", "")))
    return results[:limit]


def get_event_by_id(event_id: int) -> dict | None:
    return _exec_one(
        "SELECT * FROM events WHERE id=%s",
        (event_id,),
    )


def cleanup_past_events(days_old: int = 7):
    _exec_modify(
        "DELETE FROM events WHERE event_date < (CURRENT_DATE - make_interval(days => %s))::TEXT",
        (days_old,),
    )
