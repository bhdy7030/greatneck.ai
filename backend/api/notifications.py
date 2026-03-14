"""Notification routes."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db import (
    get_notifications, count_unread_notifications, mark_notifications_read,
    register_device_token, unregister_device_token,
)
from api.deps import get_current_user
from api.aio import run_sync

router = APIRouter()


def _resolve_avatar(row: dict, prefix: str = "actor_") -> str:
    custom = row.get(f"{prefix}custom_avatar_url", "")
    return custom if custom else row.get(f"{prefix}avatar_url", "")


def _format_notification(n: dict) -> dict:
    return {
        "id": n["id"],
        "type": n["type"],
        "actor": {
            "handle": n.get("actor_handle"),
            "name": n.get("actor_name", ""),
            "avatar_url": _resolve_avatar(n),
        } if n.get("actor_id") else None,
        "target_type": n.get("target_type"),
        "target_id": n.get("target_id"),
        "body": n.get("body", ""),
        "is_read": bool(n.get("is_read")),
        "created_at": str(n.get("created_at", "")),
    }


@router.get("/notifications")
async def list_notifications(
    after: int | None = None,
    limit: int = 30,
    user: dict = Depends(get_current_user),
):
    """Get notifications for the current user."""
    limit = min(limit, 100)
    notifs = await run_sync(get_notifications, user["id"], after, limit)
    unread = await run_sync(count_unread_notifications, user["id"])
    return {
        "notifications": [_format_notification(n) for n in notifs],
        "unread_count": unread,
    }


@router.get("/notifications/count")
async def unread_count(user: dict = Depends(get_current_user)):
    """Get unread notification count."""
    count = await run_sync(count_unread_notifications, user["id"])
    return {"unread": count}


class MarkReadRequest(BaseModel):
    ids: list[int] | None = None


@router.post("/notifications/read")
async def mark_read(body: MarkReadRequest, user: dict = Depends(get_current_user)):
    """Mark notifications as read. Empty ids = mark all."""
    marked = await run_sync(mark_notifications_read, user["id"], body.ids)
    return {"ok": True, "marked": marked}


# ── Push notification device tokens ──


class RegisterDeviceRequest(BaseModel):
    token: str
    platform: str  # "ios" or "android"


class UnregisterDeviceRequest(BaseModel):
    token: str


@router.post("/notifications/register-device")
async def register_device(body: RegisterDeviceRequest, user: dict = Depends(get_current_user)):
    """Register a device push token for the current user."""
    if body.platform not in ("ios", "android"):
        raise HTTPException(status_code=400, detail="platform must be 'ios' or 'android'")
    await run_sync(register_device_token, user["id"], body.token, body.platform)
    return {"ok": True}


@router.post("/notifications/unregister-device")
async def unregister_device(body: UnregisterDeviceRequest, user: dict = Depends(get_current_user)):
    """Remove a device push token (e.g. on logout)."""
    await run_sync(unregister_device_token, body.token)
    return {"ok": True}
