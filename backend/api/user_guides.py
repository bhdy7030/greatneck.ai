"""User Guides API — CRUD, fork, publish, and AI generation for user-created playbooks."""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from api.aio import run_sync
from api.deps import get_current_user, get_optional_user
from db import (
    create_user_guide,
    get_user_guide,
    get_user_guides_for_owner,
    update_user_guide,
    delete_user_guide,
    set_user_guide_published,
    update_published_copy,
    get_published_user_guides,
    migrate_user_guide_data,
    save_guide as db_save_guide,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _resolve_identity(user: dict | None, session_id: str | None):
    """Return (user_id, session_id) — prefer user_id when logged in."""
    if user:
        return user["id"], None
    return None, session_id


# ── List owner's guides ─────────────────────────────────────────

@router.get("/guides/user")
async def list_user_guides(
    x_session_id: str = Header(default="", alias="X-Session-ID"),
    authorization: str | None = Header(default=None),
):
    """List all guides owned by the current user/session."""
    user = None
    if authorization:
        try:
            user = await get_optional_user(authorization)
        except Exception:
            pass

    user_id, session_id = _resolve_identity(user, x_session_id or None)
    guides = await run_sync(get_user_guides_for_owner, user_id, session_id)
    return guides


# ── Save / update a user guide ──────────────────────────────────

class SaveUserGuideRequest(BaseModel):
    id: Optional[str] = None
    guide_data: dict


@router.post("/guides/user")
async def save_user_guide_endpoint(
    body: SaveUserGuideRequest,
    x_session_id: str = Header(default="", alias="X-Session-ID"),
    authorization: str | None = Header(default=None),
):
    """Create or update a user guide."""
    user = None
    if authorization:
        try:
            user = await get_optional_user(authorization)
        except Exception:
            pass

    user_id, session_id = _resolve_identity(user, x_session_id or None)

    if body.id:
        # Update existing
        existing = await run_sync(get_user_guide, body.id)
        if not existing:
            raise HTTPException(status_code=404, detail="Guide not found")
        # Ownership check
        if user_id and existing.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="Not your guide")
        if not user_id and existing.get("session_id") != session_id:
            raise HTTPException(status_code=403, detail="Not your guide")
        await run_sync(update_user_guide, body.id, user_id, session_id, body.guide_data)
        return {"id": body.id}
    else:
        # Create new
        guide_id = await run_sync(create_user_guide, user_id, session_id, body.guide_data)
        return {"id": guide_id}


# ── Get single user guide ───────────────────────────────────────

@router.get("/guides/user/{guide_id}")
async def get_user_guide_endpoint(
    guide_id: str,
    x_session_id: str = Header(default="", alias="X-Session-ID"),
    authorization: str | None = Header(default=None),
):
    """Get full raw guide data for editing."""
    user = None
    if authorization:
        try:
            user = await get_optional_user(authorization)
        except Exception:
            pass

    guide = await run_sync(get_user_guide, guide_id)
    if not guide:
        raise HTTPException(status_code=404, detail="Guide not found")
    return guide


# ── Delete user guide ────────────────────────────────────────────

@router.delete("/guides/user/{guide_id}")
async def delete_user_guide_endpoint(
    guide_id: str,
    x_session_id: str = Header(default="", alias="X-Session-ID"),
    authorization: str | None = Header(default=None),
):
    """Delete an owned guide and cleanup related saves/step_status."""
    user = None
    if authorization:
        try:
            user = await get_optional_user(authorization)
        except Exception:
            pass

    user_id, session_id = _resolve_identity(user, x_session_id or None)

    existing = await run_sync(get_user_guide, guide_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Guide not found")
    if user_id and existing.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Not your guide")
    if not user_id and existing.get("session_id") != session_id:
        raise HTTPException(status_code=403, detail="Not your guide")

    await run_sync(delete_user_guide, guide_id, user_id, session_id)
    return {"ok": True}


# ── Fork guide ───────────────────────────────────────────────────

class ForkRequest(BaseModel):
    guide_id: str


@router.post("/guides/fork")
async def fork_guide_endpoint(
    body: ForkRequest,
    x_session_id: str = Header(default="", alias="X-Session-ID"),
    authorization: str | None = Header(default=None),
):
    """Fork a guide (YAML or user guide) into a new user guide."""
    user = None
    if authorization:
        try:
            user = await get_optional_user(authorization)
        except Exception:
            pass

    user_id, session_id = _resolve_identity(user, x_session_id or None)

    # Look up source guide
    ug = await run_sync(get_user_guide, body.guide_id)
    if not ug:
        raise HTTPException(status_code=404, detail="Source guide not found")
    guide_data = ug["guide_data"]

    # Create the fork
    new_id = await run_sync(create_user_guide, user_id, session_id, guide_data, body.guide_id)

    # Auto-save the new guide to wallet
    await run_sync(db_save_guide, user_id, session_id, new_id)

    return {"id": new_id}


# ── Publish toggle ───────────────────────────────────────────────

class PublishRequest(BaseModel):
    is_published: bool


@router.patch("/guides/user/{guide_id}/publish")
async def publish_guide_endpoint(
    guide_id: str,
    body: PublishRequest,
    authorization: str = Header(...),
):
    """Toggle published status. Requires login."""
    user = await get_current_user(authorization)

    existing = await run_sync(get_user_guide, guide_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Guide not found")
    if existing.get("user_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Not your guide")

    await run_sync(set_user_guide_published, guide_id, user["id"], body.is_published)
    from api.chat import invalidate_guide_catalog_cache
    invalidate_guide_catalog_cache()
    return {"ok": True}


# ── Update published copy ────────────────────────────────────────

@router.patch("/guides/user/{guide_id}/update-published")
async def update_published_endpoint(
    guide_id: str,
    authorization: str = Header(...),
):
    """Push current guide_data to the published snapshot. Requires login."""
    user = await get_current_user(authorization)

    existing = await run_sync(get_user_guide, guide_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Guide not found")
    if existing.get("user_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Not your guide")
    if not existing.get("published_copy_id"):
        raise HTTPException(status_code=400, detail="Guide is not published")

    ok = await run_sync(update_published_copy, guide_id, user["id"])
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to update published copy")
    from api.chat import invalidate_guide_catalog_cache
    invalidate_guide_catalog_cache()
    return {"ok": True}


# ── AI Wizard: Generate ─────────────────────────────────────────

class GenerateRequest(BaseModel):
    description: str
    village: str = ""
    lang: str = "en"


@router.post("/guides/generate")
async def generate_guide_endpoint(
    body: GenerateRequest,
    authorization: str = Header(...),
):
    """AI wizard: generate a new playbook from description. Requires login."""
    user = await get_current_user(authorization)

    from agents.guide_creator import generate_guide
    guide_data, messages = await generate_guide(body.description, body.village, body.lang)

    if not guide_data:
        raise HTTPException(status_code=500, detail="Failed to generate guide")

    return {"guide": guide_data, "wizard_messages": messages}


# ── AI Wizard: Refine ────────────────────────────────────────────

class RefineRequest(BaseModel):
    instruction: str
    current_guide: dict
    messages: list[dict] = []
    village: str = ""
    lang: str = "en"


@router.post("/guides/generate/refine")
async def refine_guide_endpoint(
    body: RefineRequest,
    authorization: str = Header(...),
):
    """AI wizard: refine an existing guide. Requires login."""
    user = await get_current_user(authorization)

    from agents.guide_creator import refine_guide
    guide_data, messages = await refine_guide(
        body.instruction, body.current_guide, body.messages, body.village, body.lang
    )

    if not guide_data:
        raise HTTPException(status_code=500, detail="Failed to refine guide")

    return {"guide": guide_data, "wizard_messages": messages}
