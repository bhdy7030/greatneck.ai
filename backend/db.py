"""SQLite database for users, conversations, and messages."""
from __future__ import annotations

import hashlib
import secrets
import sqlite3
import threading
import json
import uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

import os as _os

# Use GCS FUSE mount for persistence in production, local path otherwise
_knowledge_dir = _os.environ.get("KNOWLEDGE_DIR")
if _knowledge_dir:
    DB_PATH = Path(_knowledge_dir) / "askmura.db"
else:
    DB_PATH = Path(__file__).parent / "data" / "askmura.db"

_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    """Thread-local SQLite connection with WAL mode and foreign keys."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        # Use DELETE journal on network filesystems (GCS FUSE), WAL locally
        if _knowledge_dir:
            conn.execute("PRAGMA journal_mode=DELETE")
        else:
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

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            event_date TEXT NOT NULL,
            event_time TEXT DEFAULT '',
            end_date TEXT,
            location TEXT DEFAULT '',
            venue TEXT DEFAULT '',
            url TEXT DEFAULT '',
            image_url TEXT DEFAULT '',
            category TEXT DEFAULT 'general',
            scope TEXT DEFAULT 'area',
            village TEXT DEFAULT '',
            source TEXT DEFAULT '',
            source_id TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(source, source_id)
        );
        CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
        CREATE INDEX IF NOT EXISTS idx_events_scope ON events(scope, village);

        CREATE TABLE IF NOT EXISTS usage_tracking (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT UNIQUE NOT NULL,
            user_id INTEGER REFERENCES users(id),
            query_count INTEGER DEFAULT 0,
            extended_trial INTEGER DEFAULT 0,
            ip_hash TEXT DEFAULT '',
            first_query_at TEXT DEFAULT (datetime('now')),
            last_query_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            token_hash TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            revoked INTEGER DEFAULT 0
        );
    """)
    # Migration: add can_debug column if missing (existing databases)
    cols = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "can_debug" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN can_debug INTEGER NOT NULL DEFAULT 0")
    # Migration: add tier columns
    if "tier" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'")
    if "promo_expires_at" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN promo_expires_at TEXT")
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
    now = datetime.now(_ET).isoformat()
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


# ── Events ──


def upsert_event(event: dict) -> dict:
    """Insert or update an event. Deduplicates by (source, source_id)."""
    conn = _get_conn()
    now = datetime.now(_ET).isoformat()
    conn.execute(
        """INSERT INTO events (title, description, event_date, event_time, end_date,
               location, venue, url, image_url, category, scope, village,
               source, source_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(source, source_id) DO UPDATE SET
             title=excluded.title, description=excluded.description,
             event_date=excluded.event_date, event_time=excluded.event_time,
             end_date=excluded.end_date, location=excluded.location,
             venue=excluded.venue, url=excluded.url, image_url=excluded.image_url,
             category=excluded.category, scope=excluded.scope, village=excluded.village,
             updated_at=?""",
        (
            event.get("title", ""),
            event.get("description", ""),
            event["event_date"],
            event.get("event_time", ""),
            event.get("end_date"),
            event.get("location", ""),
            event.get("venue", ""),
            event.get("url", ""),
            event.get("image_url", ""),
            event.get("category", "general"),
            event.get("scope", "area"),
            event.get("village", ""),
            event.get("source", ""),
            event.get("source_id", ""),
            now,
            now,
            now,
        ),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM events WHERE source=? AND source_id=?",
        (event.get("source", ""), event.get("source_id", "")),
    ).fetchone()
    return dict(row) if row else event


def get_upcoming_events(
    village: str | None = None,
    limit: int = 8,
    category: str | None = None,
) -> list[dict]:
    """Get upcoming events with waterfall fallback:
    1. Village-specific events
    2. Backfill with Great Neck area events
    3. Always include Long Island entertainment/food/festivals
    Sorted by date, max `limit` events.
    """
    conn = _get_conn()
    today = datetime.now(_ET).strftime("%Y-%m-%d")
    results: list[dict] = []
    seen_ids: set[int] = set()

    def _fetch(where_clause: str, params: tuple, max_rows: int) -> list[dict]:
        base_sql = f"""
            SELECT * FROM events
            WHERE event_date >= ? {where_clause}
            ORDER BY event_date ASC, event_time ASC
            LIMIT ?
        """
        rows = conn.execute(base_sql, (today, *params, max_rows)).fetchall()
        fetched = []
        for r in rows:
            d = dict(r)
            if d["id"] not in seen_ids:
                seen_ids.add(d["id"])
                fetched.append(d)
        return fetched

    # 1) Village-specific events
    if village:
        village_events = _fetch("AND scope='village' AND village=?", (village,), limit)
        results.extend(village_events)

    # 2) Great Neck area events
    if len(results) < limit:
        area_events = _fetch("AND scope='area'", (), limit - len(results))
        results.extend(area_events)

    # 3) Long Island entertainment/food/festivals
    if len(results) < limit:
        li_events = _fetch(
            "AND scope='longisland' AND category IN ('entertainment','food','festival')",
            (),
            limit - len(results),
        )
        results.extend(li_events)

    # If still under limit, fill with any remaining longisland events
    if len(results) < limit:
        extra = _fetch("AND scope='longisland'", (), limit - len(results))
        results.extend(extra)

    # Sort final results by date
    results.sort(key=lambda e: (e.get("event_date", ""), e.get("event_time", "")))
    return results[:limit]


def get_event_by_id(event_id: int) -> dict | None:
    """Fetch a single event by primary key."""
    conn = _get_conn()
    row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    return dict(row) if row else None


def set_user_tier(user_id: int, tier: str) -> dict | None:
    """Set a user's tier ('free' or 'pro')."""
    conn = _get_conn()
    conn.execute("UPDATE users SET tier=? WHERE id=?", (tier, user_id))
    conn.commit()
    return get_user_by_id(user_id)


def set_promo_expiry(user_id: int, expires_at: str) -> dict | None:
    """Set promo_expires_at for a user (ISO datetime string)."""
    conn = _get_conn()
    conn.execute("UPDATE users SET promo_expires_at=? WHERE id=?", (expires_at, user_id))
    conn.commit()
    return get_user_by_id(user_id)


# ── Usage Tracking ──


def get_or_create_usage(session_id: str, user_id: int | None = None) -> dict:
    """Get or create a usage_tracking row for a session."""
    conn = _get_conn()
    row = conn.execute("SELECT * FROM usage_tracking WHERE session_id=?", (session_id,)).fetchone()
    if row:
        return dict(row)
    conn.execute(
        "INSERT INTO usage_tracking (session_id, user_id) VALUES (?, ?)",
        (session_id, user_id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM usage_tracking WHERE session_id=?", (session_id,)).fetchone()
    return dict(row)


def increment_usage(session_id: str) -> dict:
    """Increment query_count for a session and update last_query_at."""
    conn = _get_conn()
    conn.execute(
        "UPDATE usage_tracking SET query_count=query_count+1, last_query_at=datetime('now') WHERE session_id=?",
        (session_id,),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM usage_tracking WHERE session_id=?", (session_id,)).fetchone()
    return dict(row)


def claim_extended_trial(session_id: str) -> bool:
    """Set extended_trial=1. Returns False if already claimed."""
    conn = _get_conn()
    row = conn.execute("SELECT extended_trial FROM usage_tracking WHERE session_id=?", (session_id,)).fetchone()
    if not row or row["extended_trial"]:
        return False
    conn.execute("UPDATE usage_tracking SET extended_trial=1 WHERE session_id=?", (session_id,))
    conn.commit()
    return True


# ── Refresh Tokens ──


def create_refresh_token(user_id: int) -> str:
    """Create a new refresh token for a user. Returns the raw token."""
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    token_id = uuid.uuid4().hex
    expires_at = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    conn = _get_conn()
    conn.execute(
        "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
        (token_id, user_id, token_hash, expires_at),
    )
    conn.commit()
    return token


def validate_refresh_token(token: str) -> dict | None:
    """Validate a refresh token. Returns user dict if valid, None otherwise."""
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM refresh_tokens WHERE token_hash=? AND revoked=0",
        (token_hash,),
    ).fetchone()
    if not row:
        return None
    # Check expiry
    expires = datetime.fromisoformat(row["expires_at"])
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires:
        return None
    return get_user_by_id(row["user_id"])


def revoke_user_refresh_tokens(user_id: int):
    """Revoke all refresh tokens for a user."""
    conn = _get_conn()
    conn.execute("UPDATE refresh_tokens SET revoked=1 WHERE user_id=?", (user_id,))
    conn.commit()


def cleanup_past_events(days_old: int = 7):
    """Delete events more than `days_old` days in the past."""
    conn = _get_conn()
    conn.execute(
        "DELETE FROM events WHERE event_date < date('now', ? || ' days')",
        (f"-{days_old}",),
    )
    conn.commit()


# ── Analytics Queries ──


def get_dau(days: int = 30) -> list[dict]:
    """Distinct user_ids and session_ids per day from usage_tracking."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT date(last_query_at) AS date,
                  COUNT(DISTINCT user_id) AS users,
                  COUNT(DISTINCT session_id) AS sessions
           FROM usage_tracking
           WHERE last_query_at >= datetime('now', ? || ' days')
           GROUP BY date(last_query_at)
           ORDER BY date(last_query_at)""",
        (f"-{days}",),
    ).fetchall()
    return [dict(r) for r in rows]


def get_daily_queries(days: int = 30) -> list[dict]:
    """Sum of query_count grouped by date(last_query_at)."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT date(last_query_at) AS date,
                  SUM(query_count) AS count
           FROM usage_tracking
           WHERE last_query_at >= datetime('now', ? || ' days')
           GROUP BY date(last_query_at)
           ORDER BY date(last_query_at)""",
        (f"-{days}",),
    ).fetchall()
    return [dict(r) for r in rows]


def get_tier_breakdown() -> dict:
    """Count users by effective tier (free, free_promo, pro)."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT id, tier, promo_expires_at, is_admin FROM users"
    ).fetchall()
    counts = {"free": 0, "free_promo": 0, "pro": 0}
    now = datetime.now(timezone.utc)
    for r in rows:
        if r["is_admin"] or r["tier"] == "pro":
            counts["pro"] += 1
        elif r["promo_expires_at"]:
            try:
                exp = datetime.fromisoformat(r["promo_expires_at"])
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if now < exp:
                    counts["free_promo"] += 1
                else:
                    counts["free"] += 1
            except (ValueError, TypeError):
                counts["free"] += 1
        else:
            counts["free"] += 1
    return counts


def get_total_users() -> int:
    """Total number of registered users."""
    conn = _get_conn()
    row = conn.execute("SELECT COUNT(*) AS cnt FROM users").fetchone()
    return row["cnt"] if row else 0


def get_top_agents(days: int = 7) -> list[dict]:
    """Top agents by message count from messages.agent_used."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT agent_used AS agent, COUNT(*) AS count
           FROM messages
           WHERE agent_used IS NOT NULL
             AND created_at >= datetime('now', ? || ' days')
           GROUP BY agent_used
           ORDER BY count DESC
           LIMIT 10""",
        (f"-{days}",),
    ).fetchall()
    return [dict(r) for r in rows]
