"""Device token storage for push notifications (iOS/Android)."""
from __future__ import annotations

from db.connection import _exec_modify, _exec


def register_device_token(user_id: int, token: str, platform: str) -> None:
    """Store a device push token (upsert — ignore if duplicate)."""
    _exec_modify(
        """
        INSERT INTO device_tokens (user_id, token, platform)
        VALUES (%s, %s, %s)
        ON CONFLICT (user_id, token) DO NOTHING
        """,
        (user_id, token, platform),
    )


def unregister_device_token(token: str) -> None:
    """Remove a device push token (e.g. on logout)."""
    _exec_modify("DELETE FROM device_tokens WHERE token = %s", (token,))


def get_device_tokens_for_user(user_id: int) -> list[dict]:
    """Get all device tokens for a user."""
    rows = _exec(
        "SELECT token, platform FROM device_tokens WHERE user_id = %s",
        (user_id,),
    )
    return [{"token": r[0], "platform": r[1]} for r in rows]
