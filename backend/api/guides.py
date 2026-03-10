"""Guides API — catalog, wallet, and progress tracking for guided checklists."""
from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel
from typing import Literal, Optional

from api.aio import run_sync
from api.deps import get_optional_user
from db import (
    get_saved_guide_ids,
    save_guide as db_save_guide,
    unsave_guide as db_unsave_guide,
    get_all_step_statuses,
    get_step_statuses,
    update_step_status as db_update_step_status,
    get_due_reminders as db_get_due_reminders,
    get_user_guide,
    get_user_guides_for_owner,
    get_published_user_guides,
)
from knowledge.guides_registry import get_all_guides, get_guide_by_id, get_guides_for_context

logger = logging.getLogger(__name__)

router = APIRouter()


def _resolve_identity(user: dict | None, session_id: str | None):
    """Return (user_id, session_id) — prefer user_id when logged in."""
    if user:
        return user["id"], None
    return None, session_id


def _localize(obj, lang: str) -> str:
    """Extract localized string from a {en: ..., zh: ...} dict or plain string."""
    if isinstance(obj, dict):
        return obj.get(lang, obj.get("en", ""))
    return str(obj) if obj else ""


def _format_guide(guide: dict, lang: str, saved_ids: set, step_status_map: dict) -> dict:
    """Format a guide dict for API response with localized text and step statuses."""
    steps = []
    done_count = 0
    for step in guide.get("steps", []):
        sid = step["id"]
        ss = step_status_map.get(sid, {})
        status = ss.get("status", "todo")
        if status == "done":
            done_count += 1
        steps.append({
            "id": sid,
            "title": _localize(step.get("title"), lang),
            "description": _localize(step.get("description"), lang),
            "details": _localize(step.get("details"), lang),
            "links": [
                {"label": _localize(lnk.get("label"), lang), "url": lnk.get("url", "")}
                for lnk in step.get("links", [])
            ],
            "category": step.get("category", ""),
            "priority": step.get("priority", "medium"),
            "status": status,
            "remind_at": ss.get("remind_at"),
            "note": ss.get("note", ""),
            "chat_prompt": _localize(step.get("chat_prompt"), lang),
        })

    season = guide.get("season")
    season_label = _localize(season.get("label"), lang) if season else None

    return {
        "id": guide["id"],
        "type": guide.get("type", "onboarding"),
        "title": _localize(guide.get("title"), lang),
        "description": _localize(guide.get("description"), lang),
        "icon": guide.get("icon", ""),
        "color": guide.get("color", "#6B8F71"),
        "season_label": season_label,
        "steps": steps,
        "done_count": done_count,
        "total_count": len(steps),
        "saved": guide["id"] in saved_ids,
    }


@router.get("/guides")
async def list_guides(
    village: str = Query(default="", description="Village filter"),
    lang: str = Query(default="en", description="Language (en or zh)"),
    x_session_id: str = Header(default="", alias="X-Session-ID"),
    authorization: str | None = Header(default=None),
):
    """Catalog — all active guides with save status and step statuses."""
    user = None
    if authorization:
        try:
            user = await get_optional_user(authorization)
        except Exception:
            pass

    user_id, session_id = _resolve_identity(user, x_session_id or None)
    guides = get_guides_for_context(village=village) if village else get_all_guides()
    saved_ids = set(await run_sync(get_saved_guide_ids, user_id, session_id))
    all_statuses = await run_sync(get_all_step_statuses, user_id, session_id)

    # Build step status lookup: {guide_id: {step_id: row}}
    status_by_guide: dict[str, dict] = {}
    for row in all_statuses:
        gid = row["guide_id"]
        if gid not in status_by_guide:
            status_by_guide[gid] = {}
        status_by_guide[gid][row["step_id"]] = row

    result = []
    for g in guides:
        step_map = status_by_guide.get(g["id"], {})
        result.append(_format_guide(g, lang, saved_ids, step_map))

    # Include published user guides
    published = await run_sync(get_published_user_guides)
    for ug in published:
        gd = ug["guide_data"]
        gd["id"] = ug["id"]
        if "season" not in gd:
            gd["season"] = None
        step_map = status_by_guide.get(ug["id"], {})
        formatted = _format_guide(gd, lang, saved_ids, step_map)
        formatted["is_community"] = True
        result.append(formatted)

    logger.info(f"[guides] Catalog returned {len(result)} guides for village={village!r}")
    return result


@router.get("/guides/wallet")
async def wallet_guides(
    village: str = Query(default="", description="Village filter"),
    lang: str = Query(default="en", description="Language (en or zh)"),
    x_session_id: str = Header(default="", alias="X-Session-ID"),
    authorization: str | None = Header(default=None),
):
    """Wallet — only saved guides with full step statuses."""
    user = None
    if authorization:
        try:
            user = await get_optional_user(authorization)
        except Exception:
            pass

    user_id, session_id = _resolve_identity(user, x_session_id or None)
    guides = get_all_guides()
    saved_ids = set(await run_sync(get_saved_guide_ids, user_id, session_id))
    all_statuses = await run_sync(get_all_step_statuses, user_id, session_id)

    status_by_guide: dict[str, dict] = {}
    for row in all_statuses:
        gid = row["guide_id"]
        if gid not in status_by_guide:
            status_by_guide[gid] = {}
        status_by_guide[gid][row["step_id"]] = row

    result = []
    for g in guides:
        if g["id"] not in saved_ids:
            continue
        step_map = status_by_guide.get(g["id"], {})
        result.append(_format_guide(g, lang, saved_ids, step_map))

    # Include user's own guides (created/forked)
    own_guides = await run_sync(get_user_guides_for_owner, user_id, session_id)
    seen_ids = {r["id"] for r in result}
    for ug in own_guides:
        if ug["id"] in seen_ids:
            continue
        gd = ug["guide_data"]
        gd["id"] = ug["id"]
        if "season" not in gd:
            gd["season"] = None
        step_map = status_by_guide.get(ug["id"], {})
        formatted = _format_guide(gd, lang, saved_ids, step_map)
        formatted["is_custom"] = True
        formatted["saved"] = True  # own guides always show as "saved"
        result.append(formatted)

    # Sort: in-progress first (has any non-todo steps), then by type
    def sort_key(g):
        has_progress = g["done_count"] > 0 and g["done_count"] < g["total_count"]
        return (0 if has_progress else 1, 0 if g["type"] == "onboarding" else 1)
    result.sort(key=sort_key)
    return result


class SaveRequest(BaseModel):
    guide_id: str


@router.post("/guides/save")
async def save_guide_endpoint(
    body: SaveRequest,
    x_session_id: str = Header(default="", alias="X-Session-ID"),
    authorization: str | None = Header(default=None),
):
    """Save a guide to the user's wallet."""
    user = None
    if authorization:
        try:
            user = await get_optional_user(authorization)
        except Exception:
            pass
    user_id, session_id = _resolve_identity(user, x_session_id or None)
    # Validate guide exists (YAML or user guide)
    if not get_guide_by_id(body.guide_id) and not (body.guide_id.startswith("ug-") and await run_sync(get_user_guide, body.guide_id)):
        raise HTTPException(status_code=404, detail=f"Guide '{body.guide_id}' not found")
    await run_sync(db_save_guide, user_id, session_id, body.guide_id)
    return {"ok": True}


@router.post("/guides/unsave")
async def unsave_guide_endpoint(
    body: SaveRequest,
    x_session_id: str = Header(default="", alias="X-Session-ID"),
    authorization: str | None = Header(default=None),
):
    """Remove a guide from the user's wallet."""
    user = None
    if authorization:
        try:
            user = await get_optional_user(authorization)
        except Exception:
            pass
    user_id, session_id = _resolve_identity(user, x_session_id or None)
    # Validate guide exists (YAML or user guide)
    if not get_guide_by_id(body.guide_id) and not (body.guide_id.startswith("ug-") and await run_sync(get_user_guide, body.guide_id)):
        raise HTTPException(status_code=404, detail=f"Guide '{body.guide_id}' not found")
    await run_sync(db_unsave_guide, user_id, session_id, body.guide_id)
    return {"ok": True}


class StepUpdateRequest(BaseModel):
    guide_id: str
    step_id: str
    status: Literal["todo", "in_progress", "done", "skipped"] = "todo"
    remind_at: Optional[str] = None
    note: Optional[str] = None


@router.post("/guides/step")
async def update_step(
    body: StepUpdateRequest,
    x_session_id: str = Header(default="", alias="X-Session-ID"),
    authorization: str | None = Header(default=None),
):
    """Update step status (todo/in_progress/done/skipped), reminder, or note."""
    user = None
    if authorization:
        try:
            user = await get_optional_user(authorization)
        except Exception:
            pass
    user_id, session_id = _resolve_identity(user, x_session_id or None)
    # Validate guide and step exist (YAML or user guide)
    guide = get_guide_by_id(body.guide_id)
    if not guide and body.guide_id.startswith("ug-"):
        ug = await run_sync(get_user_guide, body.guide_id)
        if ug:
            guide = ug["guide_data"]
    if not guide:
        raise HTTPException(status_code=404, detail=f"Guide '{body.guide_id}' not found")
    step_ids = {s["id"] for s in guide.get("steps", [])}
    if body.step_id not in step_ids:
        raise HTTPException(status_code=404, detail=f"Step '{body.step_id}' not found in guide '{body.guide_id}'")
    await run_sync(
        db_update_step_status,
        user_id, session_id,
        body.guide_id, body.step_id,
        body.status, body.remind_at, body.note,
    )
    return {"ok": True}


@router.get("/guides/reminders")
async def get_reminders(
    x_session_id: str = Header(default="", alias="X-Session-ID"),
    authorization: str | None = Header(default=None),
):
    """Return steps with due reminders (remind_at <= now)."""
    user = None
    if authorization:
        try:
            user = await get_optional_user(authorization)
        except Exception:
            pass
    user_id, session_id = _resolve_identity(user, x_session_id or None)
    reminders = await run_sync(db_get_due_reminders, user_id, session_id)
    return reminders
