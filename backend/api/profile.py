"""Profile & handle management routes."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db import (
    check_handle_available,
    generate_handle_suggestions,
    set_user_handle,
    get_user_by_handle,
    set_user_custom_avatar,
    set_user_bio,
    search_users_by_handle,
    get_published_user_guides,
)
from api.deps import get_current_user, get_optional_user
from api.aio import run_sync

router = APIRouter()


def _resolve_avatar(user: dict) -> str:
    """Prefer custom_avatar_url when non-empty, fall back to avatar_url."""
    custom = user.get("custom_avatar_url", "")
    return custom if custom else user.get("avatar_url", "")


# ── Handle endpoints ──


@router.get("/profile/handle/suggest")
async def suggest_handles(vibe: str = "", user: dict = Depends(get_current_user)):
    """Generate 5 handle suggestions, optionally filtered by lifestyle vibe."""
    suggestions = await run_sync(generate_handle_suggestions, vibe)
    return {"suggestions": suggestions}


@router.get("/profile/handle/check")
async def check_handle(handle: str, user: dict | None = Depends(get_optional_user)):
    """Check if a handle is available. Excludes current user's handle when logged in."""
    exclude_id = user["id"] if user else None
    available = await run_sync(check_handle_available, handle, exclude_id)
    return {"available": available}


class HandleSetRequest(BaseModel):
    handle: str


@router.post("/profile/handle")
async def set_handle(body: HandleSetRequest, user: dict = Depends(get_current_user)):
    """Set the current user's handle."""
    result = await run_sync(set_user_handle, user["id"], body.handle)
    if result is None:
        raise HTTPException(status_code=409, detail="Handle is taken or invalid")
    return {"ok": True, "handle": result.get("handle")}


# ── Avatar & Bio ──


class AvatarUpdateRequest(BaseModel):
    url: str


@router.put("/profile/avatar")
async def update_avatar(body: AvatarUpdateRequest, user: dict = Depends(get_current_user)):
    """Set a custom avatar URL."""
    result = await run_sync(set_user_custom_avatar, user["id"], body.url)
    return {"ok": True, "avatar_url": _resolve_avatar(result)}


class BioUpdateRequest(BaseModel):
    bio: str


@router.put("/profile/bio")
async def update_bio(body: BioUpdateRequest, user: dict = Depends(get_current_user)):
    """Set user bio."""
    if len(body.bio) > 500:
        raise HTTPException(status_code=400, detail="Bio must be 500 characters or less")
    result = await run_sync(set_user_bio, user["id"], body.bio)
    return {"ok": True, "bio": result.get("bio", "")}


# ── Public profile ──


@router.get("/profile/@{handle}")
async def get_public_profile(handle: str, user: dict | None = Depends(get_optional_user)):
    """Get a user's public profile."""
    profile_user = await run_sync(get_user_by_handle, handle)
    if not profile_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Count published playbooks for this user
    all_published = await run_sync(get_published_user_guides)
    user_published = [g for g in all_published if g.get("user_id") == profile_user["id"]]

    return {
        "handle": profile_user.get("handle"),
        "name": profile_user.get("name", ""),
        "avatar_url": _resolve_avatar(profile_user),
        "bio": profile_user.get("bio", ""),
        "published_playbooks_count": len(user_published),
    }


# ── Search ──


@router.get("/profile/search")
async def search_profiles(q: str = "", user: dict = Depends(get_current_user)):
    """Search users by handle prefix (for @mention autocomplete)."""
    if not q or len(q) < 1:
        return []
    results = await run_sync(search_users_by_handle, q, 10)
    return [
        {
            "id": r["id"],
            "handle": r["handle"],
            "name": r["name"],
            "avatar_url": _resolve_avatar(r),
        }
        for r in results
    ]
