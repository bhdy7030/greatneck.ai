"""Waitlist endpoints: public signup + admin listing."""
from __future__ import annotations

import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import require_admin
from db import add_to_waitlist, list_waitlist, delete_waitlist_entry

router = APIRouter()

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class WaitlistRequest(BaseModel):
    email: str
    name: str = ""
    note: str = ""


@router.post("/waitlist", status_code=201)
async def join_waitlist(body: WaitlistRequest):
    """Public endpoint — no auth required. Add email to waitlist."""
    email = body.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Invalid email address")
    if len(email) > 254:
        raise HTTPException(status_code=400, detail="Email too long")

    result = add_to_waitlist(email, body.name, body.note)
    if result is None:
        # Duplicate — still return success (don't reveal existence)
        return {"ok": True, "message": "You're on the list!"}
    return {"ok": True, "message": "You're on the list!"}


@router.get("/admin/waitlist")
async def get_waitlist(user: dict = Depends(require_admin)):
    """Admin-only: list all waitlist entries."""
    entries = list_waitlist()
    return {"entries": entries, "count": len(entries)}


@router.delete("/admin/waitlist/{entry_id}")
async def remove_waitlist_entry(entry_id: int, user: dict = Depends(require_admin)):
    """Admin-only: remove a waitlist entry."""
    delete_waitlist_entry(entry_id)
    return {"ok": True}
