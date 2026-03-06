"""Search upcoming local events from the scraped events database."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

from tools.registry import tool

logger = logging.getLogger(__name__)


@tool(
    name="search_events",
    description=(
        "Search upcoming local events in the Great Neck area. Returns events from "
        "Patch, Great Neck Library, schools, village meetings, Eventbrite, and more. "
        "Use this for any query about activities, things to do, events, programs, "
        "classes, meetings, or what's happening locally. Results are always future-dated "
        "(today or later), sorted by date."
    ),
)
def search_events(query: str, limit: int = 10) -> str:
    """Search upcoming events, filtering by keyword match against title/description/venue/category."""
    from db import get_upcoming_events

    # Fetch a broad set, then keyword-filter
    all_events = get_upcoming_events(village=None, limit=50)

    if not all_events:
        return "No upcoming events found in the database. Try search_social or web_search for event info."

    # Keyword filter if query has meaningful terms
    keywords = [w.lower() for w in query.split() if len(w) > 2]
    stop_words = {
        "the", "and", "for", "are", "what", "when", "where", "how",
        "this", "that", "with", "from", "have", "there", "any",
        "near", "great", "neck", "local", "upcoming", "events",
        "activities", "things", "happening", "going", "weekend",
        "today", "tomorrow", "week", "next",
    }
    keywords = [k for k in keywords if k not in stop_words]

    if keywords:
        def matches(ev: dict) -> bool:
            text = f"{ev['title']} {ev['description']} {ev['venue']} {ev['category']}".lower()
            return any(k in text for k in keywords)

        filtered = [e for e in all_events if matches(e)]
    else:
        filtered = all_events

    # Take top results
    events = filtered[:limit]

    if not events:
        # Fall back to showing general upcoming events
        events = all_events[:limit]

    today = datetime.now(_ET).strftime("%Y-%m-%d")
    parts = [f"Found {len(events)} upcoming events (as of {today}):\n"]

    for i, ev in enumerate(events, 1):
        line = f"[{i}] {ev['title']}"
        line += f"\n  Date: {ev['event_date']}"
        if ev.get("event_time"):
            line += f" at {ev['event_time']}"
        if ev.get("venue"):
            line += f"\n  Venue: {ev['venue']}"
        if ev.get("description"):
            line += f"\n  {ev['description'][:200]}"
        if ev.get("url"):
            line += f"\n  Link: {ev['url']}"
        line += f"\n  Source: {ev.get('source', 'unknown')} | Category: {ev.get('category', 'general')}"
        parts.append(line)

    return "\n\n".join(parts)
