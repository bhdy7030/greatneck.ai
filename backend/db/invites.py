"""Invite CRUD, redemption, usage tracking."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from db.connection import _exec, _exec_one, _exec_modify, _exec_scalar, _PgConnWrapper

_ET = ZoneInfo("America/New_York")


def create_invite(code: str, created_by: int) -> dict:
    """Insert a new invite code and return the invite row."""
    from psycopg2.extras import RealDictCursor
    with _PgConnWrapper() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "INSERT INTO invites (code, created_by) VALUES (%s, %s) RETURNING *",
                (code, created_by),
            )
            row = dict(cur.fetchone())
            conn.commit()
            return row


def get_invite_by_code(code: str) -> dict | None:
    return _exec_one(
        "SELECT * FROM invites WHERE code=%s",
        (code,),
    )


def redeem_invite(code: str, session_id: str, user_id: int | None = None) -> dict | None:
    """Mark an invite as redeemed. Returns the updated invite or None if already redeemed."""
    invite = get_invite_by_code(code)
    if not invite or invite.get("redeemed_at"):
        return None
    now = datetime.now(_ET).isoformat()
    _exec_modify(
        "UPDATE invites SET redeemed_at=%s, session_id=%s, redeemed_by=%s WHERE code=%s",
        (now, session_id, user_id, code),
    )
    return get_invite_by_code(code)


def count_invites_by_user(user_id: int) -> int:
    val = _exec_scalar(
        "SELECT COUNT(*) FROM invites WHERE created_by=%s",
        (user_id,),
    )
    return val if val else 0


def list_invites_by_user(user_id: int) -> list[dict]:
    return _exec(
        "SELECT * FROM invites WHERE created_by=%s ORDER BY created_at DESC",
        (user_id,),
    )


def list_all_invites() -> list[dict]:
    return _exec(
        """SELECT i.*, c.name AS creator_name, c.email AS creator_email,
                  r.name AS redeemer_name, r.email AS redeemer_email
           FROM invites i
           LEFT JOIN users c ON i.created_by = c.id
           LEFT JOIN users r ON i.redeemed_by = r.id
           ORDER BY i.created_at DESC""",
    )


def link_invite_to_user(session_id: str, user_id: int) -> bool:
    """Link a session's redeemed invite to a user account and set is_invited."""
    from db.users import mark_user_invited
    invite = _exec_one(
        "SELECT * FROM invites WHERE session_id=%s AND redeemed_by IS NULL",
        (session_id,),
    )
    if not invite:
        return False
    _exec_modify(
        "UPDATE invites SET redeemed_by=%s WHERE id=%s",
        (user_id, invite["id"]),
    )
    mark_user_invited(user_id)
    return True
