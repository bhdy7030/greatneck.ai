"""Conversation + message CRUD."""
from __future__ import annotations

import json
import uuid

from db.connection import _exec, _exec_one, _exec_modify, _PgConnWrapper


def create_conversation(user_id: int, village: str, title: str = "New conversation") -> dict:
    convo_id = uuid.uuid4().hex
    _exec_modify(
        "INSERT INTO conversations (id, user_id, village, title) VALUES (%s, %s, %s, %s)",
        (convo_id, user_id, village, title),
    )
    return _exec_one(
        "SELECT * FROM conversations WHERE id=%s",
        (convo_id,),
    )


def list_conversations(user_id: int) -> list[dict]:
    return _exec(
        """SELECT c.*,
                  (SELECT COUNT(*) FROM messages WHERE conversation_id=c.id) AS message_count,
                  (SELECT content FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS preview
           FROM conversations c
           WHERE c.user_id=%s
           ORDER BY c.updated_at DESC""",
        (user_id,),
    )


def get_conversation(conversation_id: str) -> dict | None:
    return _exec_one(
        "SELECT * FROM conversations WHERE id=%s",
        (conversation_id,),
    )


def update_conversation_title(conversation_id: str, title: str):
    _exec_modify(
        "UPDATE conversations SET title=%s WHERE id=%s",
        (title, conversation_id),
    )


def touch_conversation(conversation_id: str):
    _exec_modify(
        "UPDATE conversations SET updated_at=NOW() WHERE id=%s",
        (conversation_id,),
    )


def delete_conversation(conversation_id: str):
    _exec_modify(
        "DELETE FROM conversations WHERE id=%s",
        (conversation_id,),
    )


# ── Messages ────────────────────────────────────────────────────


def add_message(
    conversation_id: str,
    role: str,
    content: str,
    image_base64: str | None = None,
    sources: list[dict] | None = None,
    agent_used: str | None = None,
) -> dict:
    sources_json = json.dumps(sources) if sources else None

    from psycopg2.extras import RealDictCursor
    with _PgConnWrapper() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """INSERT INTO messages (conversation_id, role, content, image_base64, sources_json, agent_used)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   RETURNING *""",
                (conversation_id, role, content, image_base64, sources_json, agent_used),
            )
            row = dict(cur.fetchone())
            conn.commit()
    touch_conversation(conversation_id)
    return row


def get_messages(conversation_id: str) -> list[dict]:
    rows = _exec(
        "SELECT * FROM messages WHERE conversation_id=%s ORDER BY created_at",
        (conversation_id,),
    )
    for d in rows:
        if d.get("sources_json"):
            d["sources"] = json.loads(d["sources_json"])
        else:
            d["sources"] = []
    return rows
