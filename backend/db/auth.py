"""Refresh tokens, session/usage tracking."""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from db.connection import _exec, _exec_one, _exec_modify, _exec_scalar
from db.users import get_user_by_id


# ── Usage Tracking ──────────────────────────────────────────────


def get_or_create_usage(session_id: str, user_id: int | None = None) -> dict:
    row = _exec_one(
        "SELECT * FROM usage_tracking WHERE session_id=%s",
        (session_id,),
    )
    if row:
        return row
    _exec_modify(
        "INSERT INTO usage_tracking (session_id, user_id) VALUES (%s, %s)",
        (session_id, user_id),
    )
    return _exec_one(
        "SELECT * FROM usage_tracking WHERE session_id=%s",
        (session_id,),
    )


def increment_usage(session_id: str) -> dict:
    _exec_modify(
        "UPDATE usage_tracking SET query_count=query_count+1, last_query_at=NOW() WHERE session_id=%s",
        (session_id,),
    )
    return _exec_one(
        "SELECT * FROM usage_tracking WHERE session_id=%s",
        (session_id,),
    )


def claim_extended_trial(session_id: str) -> bool:
    row = _exec_one(
        "SELECT extended_trial FROM usage_tracking WHERE session_id=%s",
        (session_id,),
    )
    if not row or row["extended_trial"]:
        return False
    _exec_modify(
        "UPDATE usage_tracking SET extended_trial=TRUE WHERE session_id=%s",
        (session_id,),
    )
    return True


# ── Refresh Tokens ──────────────────────────────────────────────


def create_refresh_token(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    token_id = uuid.uuid4().hex
    expires_at = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    _exec_modify(
        "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (%s, %s, %s, %s)",
        (token_id, user_id, token_hash, expires_at),
    )
    return token


def validate_refresh_token(token: str) -> dict | None:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    row = _exec_one(
        "SELECT * FROM refresh_tokens WHERE token_hash=%s AND revoked=FALSE",
        (token_hash,),
    )
    if not row:
        return None
    expires = datetime.fromisoformat(str(row["expires_at"]))
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires:
        return None
    return get_user_by_id(row["user_id"])


def revoke_user_refresh_tokens(user_id: int):
    _exec_modify(
        "UPDATE refresh_tokens SET revoked=TRUE WHERE user_id=%s",
        (user_id,),
    )


# ── Waitlist ─────────────────────────────────────────────────────


def add_to_waitlist(email: str, name: str = "", note: str = "") -> dict | None:
    """Add an email to the waitlist. Returns the row or None if duplicate."""
    from db.connection import _exec_insert_returning
    try:
        return _exec_insert_returning(
            "INSERT INTO waitlist (email, name, note) VALUES (%s, %s, %s) RETURNING *",
            (email.lower().strip(), name.strip(), note.strip()),
        )
    except Exception:
        return None


def list_waitlist() -> list[dict]:
    """List all waitlist entries, newest first."""
    return _exec(
        "SELECT * FROM waitlist ORDER BY created_at DESC",
    )


def delete_waitlist_entry(entry_id: int) -> None:
    """Remove a waitlist entry by ID."""
    _exec_modify(
        "DELETE FROM waitlist WHERE id=%s",
        (entry_id,),
    )
