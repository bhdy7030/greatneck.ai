"""Lightweight page visit tracking endpoint.

No auth required — tracks all visitors (anonymous + authenticated).
Fire-and-forget: enqueues to the metrics collector, returns 204 immediately.
"""

from __future__ import annotations

import time
from fastapi import APIRouter, Header, Request
from fastapi.responses import Response
from pydantic import BaseModel

from api.deps import get_optional_user
from metrics.collector import collector, PageVisit

router = APIRouter()

# ── In-memory dedup: (session_id, page) -> last_seen_timestamp ──
_recent_visits: dict[tuple[str, str], float] = {}
_DEDUP_WINDOW = 30.0  # seconds
_CLEANUP_INTERVAL = 300  # clean stale entries every 5 minutes
_last_cleanup = time.time()


class VisitRequest(BaseModel):
    page: str
    referrer: str = ""


@router.post("/track/visit", status_code=204)
async def track_visit(
    body: VisitRequest,
    request: Request,
    x_session_id: str = Header(default="", alias="X-Session-ID"),
    authorization: str | None = Header(default=None),
):
    """Record a page visit. Returns 204 immediately."""
    global _last_cleanup

    session_id = x_session_id or ""
    if not session_id:
        return Response(status_code=204)

    # Dedup: skip if same session+page within DEDUP_WINDOW
    now = time.time()
    key = (session_id, body.page)
    last_seen = _recent_visits.get(key, 0)
    if now - last_seen < _DEDUP_WINDOW:
        return Response(status_code=204)
    _recent_visits[key] = now

    # Periodic cleanup of stale dedup entries
    if now - _last_cleanup > _CLEANUP_INTERVAL:
        _last_cleanup = now
        stale = [k for k, v in _recent_visits.items() if now - v > _DEDUP_WINDOW]
        for k in stale:
            _recent_visits.pop(k, None)

    # Resolve user_id if JWT present (optional, no error on failure)
    user_id = None
    if authorization:
        try:
            user = await get_optional_user(authorization)
            if user:
                user_id = user.get("id")
        except Exception:
            pass

    user_agent = request.headers.get("user-agent", "")

    collector.record_visit(PageVisit(
        session_id=session_id,
        page=body.page,
        user_id=user_id,
        referrer=body.referrer,
        user_agent=user_agent,
    ))

    return Response(status_code=204)
