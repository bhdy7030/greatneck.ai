"""SQLite database for users, conversations, and messages."""
from __future__ import annotations

import sqlite3
import threading
import json
import uuid
from pathlib import Path
from datetime import datetime, timezone

DB_PATH = Path(__file__).parent / "data" / "askmura.db"

_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    """Thread-local SQLite connection with WAL mode and foreign keys."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.row_factory = sqlite3.Row
        _local.conn = conn
    return conn


def init_db():
    """Create tables if they don't exist."""
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            google_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            avatar_url TEXT NOT NULL DEFAULT '',
            is_admin INTEGER NOT NULL DEFAULT 0,
            can_debug INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            last_login_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            title TEXT NOT NULL DEFAULT 'New conversation',
            village TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            image_base64 TEXT,
            sources_json TEXT,
            agent_used TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(conversation_id, created_at);
    """)
    # Migration: add can_debug column if missing (existing databases)
    cols = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "can_debug" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN can_debug INTEGER NOT NULL DEFAULT 0")
    # Migration: conversations.id INTEGER → TEXT (UUID)
    # If old schema exists, drop conversations+messages and let CREATE TABLE IF NOT EXISTS rebuild
    convo_cols = {row[1]: row[2] for row in conn.execute("PRAGMA table_info(conversations)").fetchall()}
    if convo_cols.get("id") == "INTEGER":
        conn.execute("DROP TABLE IF EXISTS messages")
        conn.execute("DROP TABLE IF EXISTS conversations")
        conn.execute("DROP TABLE IF EXISTS _conversations_old")
        conn.commit()
        # Re-run CREATE TABLE statements
        init_db()
        return
    conn.commit()


def upsert_user(google_id: str, email: str, name: str, avatar_url: str = "") -> dict:
    """Insert or update a user from Google OAuth. Returns user dict."""
    conn = _get_conn()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO users (google_id, email, name, avatar_url, created_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(google_id) DO UPDATE SET
             email=excluded.email, name=excluded.name,
             avatar_url=excluded.avatar_url, last_login_at=?""",
        (google_id, email, name, avatar_url, now, now, now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM users WHERE google_id=?", (google_id,)).fetchone()
    return dict(row)


def get_user_by_id(user_id: int) -> dict | None:
    """Fetch user by primary key."""
    conn = _get_conn()
    row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    return dict(row) if row else None


def list_users() -> list[dict]:
    """List all users."""
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM users ORDER BY id").fetchall()
    return [dict(r) for r in rows]


def update_user_permissions(user_id: int, is_admin: int | None = None, can_debug: int | None = None) -> dict | None:
    """Update permission flags for a user. Returns updated user or None."""
    conn = _get_conn()
    parts, params = [], []
    if is_admin is not None:
        parts.append("is_admin=?")
        params.append(is_admin)
    if can_debug is not None:
        parts.append("can_debug=?")
        params.append(can_debug)
    if not parts:
        return get_user_by_id(user_id)
    params.append(user_id)
    conn.execute(f"UPDATE users SET {', '.join(parts)} WHERE id=?", params)
    conn.commit()
    return get_user_by_id(user_id)


# ── Conversations ──


def create_conversation(user_id: int, village: str, title: str = "New conversation") -> dict:
    conn = _get_conn()
    convo_id = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO conversations (id, user_id, village, title) VALUES (?, ?, ?, ?)",
        (convo_id, user_id, village, title),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM conversations WHERE id=?", (convo_id,)).fetchone()
    return dict(row)


def list_conversations(user_id: int) -> list[dict]:
    """List user's conversations with message count and last message preview."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT c.*,
                  (SELECT COUNT(*) FROM messages WHERE conversation_id=c.id) AS message_count,
                  (SELECT content FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS preview
           FROM conversations c
           WHERE c.user_id=?
           ORDER BY c.updated_at DESC""",
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_conversation(conversation_id: str) -> dict | None:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM conversations WHERE id=?", (conversation_id,)).fetchone()
    return dict(row) if row else None


def update_conversation_title(conversation_id: str, title: str):
    conn = _get_conn()
    conn.execute("UPDATE conversations SET title=? WHERE id=?", (title, conversation_id))
    conn.commit()


def touch_conversation(conversation_id: str):
    """Update the updated_at timestamp."""
    conn = _get_conn()
    conn.execute(
        "UPDATE conversations SET updated_at=datetime('now') WHERE id=?",
        (conversation_id,),
    )
    conn.commit()


def delete_conversation(conversation_id: str):
    conn = _get_conn()
    conn.execute("DELETE FROM conversations WHERE id=?", (conversation_id,))
    conn.commit()


# ── Messages ──


def add_message(
    conversation_id: str,
    role: str,
    content: str,
    image_base64: str | None = None,
    sources: list[dict] | None = None,
    agent_used: str | None = None,
) -> dict:
    conn = _get_conn()
    sources_json = json.dumps(sources) if sources else None
    cur = conn.execute(
        """INSERT INTO messages (conversation_id, role, content, image_base64, sources_json, agent_used)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (conversation_id, role, content, image_base64, sources_json, agent_used),
    )
    conn.commit()
    touch_conversation(conversation_id)
    row = conn.execute("SELECT * FROM messages WHERE id=?", (cur.lastrowid,)).fetchone()
    return dict(row)


def get_messages(conversation_id: str) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at",
        (conversation_id,),
    ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        if d.get("sources_json"):
            d["sources"] = json.loads(d["sources_json"])
        else:
            d["sources"] = []
        result.append(d)
    return result
