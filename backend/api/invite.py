"""Invite-only access system — generate, verify, and redeem invite codes."""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from config import settings
from db import (
    create_invite,
    get_invite_by_code,
    redeem_invite,
    count_invites_by_user,
    list_invites_by_user,
    list_all_invites,
    mark_user_invited,
    link_invite_to_user,
)
from api.deps import get_current_user, get_optional_user, require_admin

router = APIRouter(prefix="/invite", tags=["invite"])


def _generate_code() -> str:
    return secrets.token_urlsafe(6)[:8].upper()


# ── Models ──


class CodeRequest(BaseModel):
    code: str


class RedeemRequest(BaseModel):
    code: str
    session_id: str


class LinkRequest(BaseModel):
    session_id: str


# ── Endpoints ──


@router.get("/status")
async def invite_status(
    user: dict | None = Depends(get_optional_user),
):
    """Check whether invite is required and if the current user has one."""
    if not settings.invite_required:
        return {"required": False, "has_invite": True}
    if user:
        has = bool(user.get("is_invited")) or bool(user.get("is_admin"))
        return {"required": True, "has_invite": has}
    return {"required": True, "has_invite": False}


@router.post("/verify")
async def verify_code(body: CodeRequest):
    """Check if a code is valid (doesn't consume it)."""
    invite = get_invite_by_code(body.code.strip().upper())
    if not invite:
        raise HTTPException(status_code=404, detail="Invalid invite code")
    if invite.get("redeemed_at"):
        raise HTTPException(status_code=410, detail="Invite code already used")
    return {"valid": True}


@router.post("/redeem")
async def redeem_code(
    body: RedeemRequest,
    user: dict | None = Depends(get_optional_user),
):
    """Redeem an invite code, linking it to a session and optional user."""
    code = body.code.strip().upper()
    invite = get_invite_by_code(code)
    if not invite:
        raise HTTPException(status_code=404, detail="Invalid invite code")
    if invite.get("redeemed_at"):
        raise HTTPException(status_code=410, detail="Invite code already used")

    user_id = user["id"] if user else None
    result = redeem_invite(code, body.session_id, user_id)
    if not result:
        raise HTTPException(status_code=410, detail="Invite code already used")

    # If user is logged in, also mark them as invited
    if user:
        mark_user_invited(user["id"])

    return {"ok": True, "code": code}


@router.post("/link")
async def link_code(
    body: LinkRequest,
    user: dict = Depends(get_current_user),
):
    """Link a session's redeemed invite to the logged-in user account."""
    linked = link_invite_to_user(body.session_id, user["id"])
    if not linked:
        # No unlinked invite for this session — just mark user as invited anyway
        # (they may have signed in on a device where they already had access)
        mark_user_invited(user["id"])
    return {"ok": True}


@router.post("/generate")
async def generate_code(user: dict = Depends(get_current_user)):
    """Generate a new invite code. Non-admins limited to invite_limit_per_user."""
    if not user.get("is_admin"):
        count = count_invites_by_user(user["id"])
        if count >= settings.invite_limit_per_user:
            raise HTTPException(
                status_code=403,
                detail=f"Invite limit reached ({settings.invite_limit_per_user})",
            )
    code = _generate_code()
    invite = create_invite(code, user["id"])
    return {
        "code": invite["code"],
        "created_at": invite.get("created_at"),
    }


@router.get("/mine")
async def my_invites(user: dict = Depends(get_current_user)):
    """List the current user's invites and remaining count."""
    invites = list_invites_by_user(user["id"])
    count = len(invites)
    is_admin = bool(user.get("is_admin"))
    limit = None if is_admin else settings.invite_limit_per_user
    remaining = None if is_admin else max(0, settings.invite_limit_per_user - count)
    return {
        "invites": [
            {
                "code": inv["code"],
                "created_at": inv.get("created_at"),
                "redeemed": bool(inv.get("redeemed_at")),
                "redeemed_at": inv.get("redeemed_at"),
            }
            for inv in invites
        ],
        "count": count,
        "limit": limit,
        "remaining": remaining,
    }


@router.get("/all")
async def all_invites(user: dict = Depends(require_admin)):
    """Admin: list all invites with creator/redeemer details."""
    invites = list_all_invites()
    return [
        {
            "id": inv["id"],
            "code": inv["code"],
            "created_by": inv.get("creator_name") or inv.get("creator_email", ""),
            "redeemed_by": inv.get("redeemer_name") or inv.get("redeemer_email", ""),
            "redeemed": bool(inv.get("redeemed_at")),
            "redeemed_at": inv.get("redeemed_at"),
            "created_at": inv.get("created_at"),
        }
        for inv in invites
    ]
