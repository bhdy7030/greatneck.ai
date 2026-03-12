"""Like/upvote routes."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db import toggle_like, get_like_status_bulk, create_notification, get_user_by_handle
from api.deps import get_current_user, get_optional_user
from api.aio import run_sync

router = APIRouter()


class ToggleLikeRequest(BaseModel):
    target_type: str  # 'guide' | 'comment'
    target_id: str


@router.post("/likes/toggle")
async def toggle(body: ToggleLikeRequest, user: dict = Depends(get_current_user)):
    """Toggle a like on a guide or comment."""
    if body.target_type not in ("guide", "comment"):
        raise HTTPException(status_code=400, detail="target_type must be 'guide' or 'comment'")
    result = await run_sync(toggle_like, user["id"], body.target_type, body.target_id)
    return result


@router.get("/likes/status")
async def like_status(
    type: str = "guide",
    ids: str = "",
    user: dict | None = Depends(get_optional_user),
):
    """Get like status for multiple targets."""
    if type not in ("guide", "comment"):
        raise HTTPException(status_code=400, detail="type must be 'guide' or 'comment'")
    if not ids:
        return {}
    target_ids = [tid.strip() for tid in ids.split(",") if tid.strip()]
    if len(target_ids) > 100:
        raise HTTPException(status_code=400, detail="Too many IDs (max 100)")
    user_id = user["id"] if user else None
    return await run_sync(get_like_status_bulk, user_id, type, target_ids)
