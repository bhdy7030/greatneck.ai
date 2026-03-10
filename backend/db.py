"""Dual-mode database layer: PostgreSQL (primary) or SQLite (fallback).

Set DATABASE_URL env var to use PostgreSQL, unset for SQLite.
All 27 public functions keep identical signatures and return types.
"""
from __future__ import annotations

import hashlib
import json
import os as _os
import secrets
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

# ── Mode detection ──────────────────────────────────────────────
_DATABASE_URL = _os.environ.get("DATABASE_URL", "")

# ── SQLite setup (fallback) ─────────────────────────────────────
_knowledge_dir = _os.environ.get("KNOWLEDGE_DIR")
if _knowledge_dir:
    DB_PATH = Path(_knowledge_dir) / "askmura.db"
else:
    DB_PATH = Path(__file__).parent / "data" / "askmura.db"

_local = threading.local()

# ── PostgreSQL setup ────────────────────────────────────────────
_pg_pool = None
_pg_pool_lock = threading.Lock()


def _get_pg_pool():
    global _pg_pool
    if _pg_pool is None:
        with _pg_pool_lock:
            if _pg_pool is None:
                from psycopg2.pool import ThreadedConnectionPool
                _pg_pool = ThreadedConnectionPool(5, 20, _DATABASE_URL)
    return _pg_pool


def close_pg_pool():
    """Close the PostgreSQL connection pool (call on shutdown)."""
    global _pg_pool
    if _pg_pool is not None:
        _pg_pool.closeall()
        _pg_pool = None


def _is_pg() -> bool:
    return bool(_DATABASE_URL)


# ── Connection helpers ──────────────────────────────────────────

class _PgConnWrapper:
    """Context manager that returns a psycopg2 connection to the pool."""
    def __init__(self):
        self.conn = None

    def __enter__(self):
        self.conn = _get_pg_pool().getconn()
        return self.conn

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.conn is not None:
            if exc_type is not None:
                self.conn.rollback()
            _get_pg_pool().putconn(self.conn)
            self.conn = None


def _get_sqlite_conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        if _knowledge_dir:
            conn.execute("PRAGMA journal_mode=DELETE")
        else:
            conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.row_factory = sqlite3.Row
        _local.conn = conn
    return conn


def _dict_row(cur, row_or_none):
    """Convert a single row to dict (works for both sqlite3.Row and RealDictRow)."""
    if row_or_none is None:
        return None
    return dict(row_or_none)


# ── Execution helpers ───────────────────────────────────────────

def _q(sql_sqlite: str, sql_pg: str) -> str:
    """Pick the right SQL string based on mode."""
    return sql_pg if _is_pg() else sql_sqlite


def _exec(sql_sqlite: str, sql_pg: str, params: tuple = ()) -> list[dict]:
    """Execute a query and return all rows as list of dicts."""
    if _is_pg():
        from psycopg2.extras import RealDictCursor
        with _PgConnWrapper() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql_pg, params)
                if cur.description:
                    return [dict(r) for r in cur.fetchall()]
                conn.commit()
                return []
    else:
        conn = _get_sqlite_conn()
        rows = conn.execute(sql_sqlite, params).fetchall()
        return [dict(r) for r in rows]


def _exec_one(sql_sqlite: str, sql_pg: str, params: tuple = ()) -> dict | None:
    """Execute a query and return a single row as dict or None."""
    if _is_pg():
        from psycopg2.extras import RealDictCursor
        with _PgConnWrapper() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql_pg, params)
                row = cur.fetchone()
                return dict(row) if row else None
    else:
        conn = _get_sqlite_conn()
        row = conn.execute(sql_sqlite, params).fetchone()
        return dict(row) if row else None


def _exec_modify(sql_sqlite: str, sql_pg: str, params: tuple = ()) -> int | None:
    """Execute an INSERT/UPDATE/DELETE. Returns lastrowid for inserts."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute(sql_pg, params)
                conn.commit()
                return None
    else:
        conn = _get_sqlite_conn()
        cur = conn.execute(sql_sqlite, params)
        conn.commit()
        return cur.lastrowid


def _exec_insert_returning(sql_sqlite: str, sql_pg: str, params: tuple = ()) -> dict | None:
    """INSERT with RETURNING (PG) or lastrowid fetch (SQLite)."""
    if _is_pg():
        from psycopg2.extras import RealDictCursor
        with _PgConnWrapper() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(sql_pg, params)
                row = cur.fetchone()
                conn.commit()
                return dict(row) if row else None
    else:
        conn = _get_sqlite_conn()
        cur = conn.execute(sql_sqlite, params)
        conn.commit()
        return cur.lastrowid  # caller must re-fetch


def _exec_scalar(sql_sqlite: str, sql_pg: str, params: tuple = ()):
    """Execute and return a single scalar value."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute(sql_pg, params)
                row = cur.fetchone()
                return row[0] if row else None
    else:
        conn = _get_sqlite_conn()
        row = conn.execute(sql_sqlite, params).fetchone()
        return row[0] if row else None


# ── Schema ──────────────────────────────────────────────────────

_PG_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    google_id TEXT UNIQUE,
    apple_id TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    can_debug BOOLEAN NOT NULL DEFAULT FALSE,
    tier TEXT NOT NULL DEFAULT 'free',
    promo_expires_at TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL DEFAULT 'New conversation',
    village TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    image_base64 TEXT,
    sources_json TEXT,
    agent_used TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
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
    title_zh TEXT,
    description_zh TEXT,
    venue_zh TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_scope ON events(scope, village);

CREATE TABLE IF NOT EXISTS usage_tracking (
    id SERIAL PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id),
    query_count INTEGER DEFAULT 0,
    extended_trial BOOLEAN DEFAULT FALSE,
    ip_hash TEXT DEFAULT '',
    first_query_at TIMESTAMP DEFAULT NOW(),
    last_query_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    revoked BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS llm_usage (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP DEFAULT NOW(),
    session_id TEXT DEFAULT '',
    conversation_id TEXT DEFAULT '',
    role TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    latency_ms INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_date ON llm_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_role ON llm_usage(role, created_at);

CREATE TABLE IF NOT EXISTS invites (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    redeemed_by INTEGER REFERENCES users(id),
    redeemed_at TIMESTAMP,
    session_id TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
CREATE INDEX IF NOT EXISTS idx_invites_created_by ON invites(created_by);
"""

_SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id TEXT UNIQUE,
    apple_id TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    is_admin INTEGER NOT NULL DEFAULT 0,
    can_debug INTEGER NOT NULL DEFAULT 0,
    tier TEXT NOT NULL DEFAULT 'free',
    promo_expires_at TEXT,
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
    title_zh TEXT,
    description_zh TEXT,
    venue_zh TEXT,
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

CREATE TABLE IF NOT EXISTS llm_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT (datetime('now')),
    session_id TEXT DEFAULT '',
    conversation_id TEXT DEFAULT '',
    role TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    latency_ms INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_date ON llm_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_role ON llm_usage(role, created_at);

CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    redeemed_by INTEGER REFERENCES users(id),
    redeemed_at TEXT,
    session_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
CREATE INDEX IF NOT EXISTS idx_invites_created_by ON invites(created_by);
"""


def _migrate_events_zh():
    """Add _zh translation columns to events table if missing."""
    zh_cols = ["title_zh", "description_zh", "venue_zh"]
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='events'")
                existing = {row[0] for row in cur.fetchall()}
                for col in zh_cols:
                    if col not in existing:
                        cur.execute(f"ALTER TABLE events ADD COLUMN {col} TEXT")
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        existing = {row[1] for row in conn.execute("PRAGMA table_info(events)").fetchall()}
        for col in zh_cols:
            if col not in existing:
                conn.execute(f"ALTER TABLE events ADD COLUMN {col} TEXT")
        conn.commit()


def _migrate_apple_id():
    """Add apple_id column and make google_id nullable."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='users'")
                existing = {row[0] for row in cur.fetchall()}
                if "apple_id" not in existing:
                    cur.execute("ALTER TABLE users ADD COLUMN apple_id TEXT UNIQUE")
                # Drop NOT NULL on google_id if still present
                cur.execute("""
                    SELECT is_nullable FROM information_schema.columns
                    WHERE table_name='users' AND column_name='google_id'
                """)
                row = cur.fetchone()
                if row and row[0] == "NO":
                    cur.execute("ALTER TABLE users ALTER COLUMN google_id DROP NOT NULL")
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        existing = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "apple_id" not in existing:
            conn.execute("ALTER TABLE users ADD COLUMN apple_id TEXT UNIQUE")
        conn.commit()


def _migrate_invites():
    """Add invites table and is_invited column to users if missing."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                # Add is_invited column
                cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='users'")
                existing = {row[0] for row in cur.fetchall()}
                if "is_invited" not in existing:
                    cur.execute("ALTER TABLE users ADD COLUMN is_invited BOOLEAN NOT NULL DEFAULT FALSE")
                    # Mark all existing users as invited (they predate the system)
                    cur.execute("UPDATE users SET is_invited = TRUE")
                # Create invites table if missing
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS invites (
                        id SERIAL PRIMARY KEY,
                        code TEXT UNIQUE NOT NULL,
                        created_by INTEGER NOT NULL REFERENCES users(id),
                        redeemed_by INTEGER REFERENCES users(id),
                        redeemed_at TIMESTAMP,
                        session_id TEXT,
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code)")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_invites_created_by ON invites(created_by)")
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        existing = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "is_invited" not in existing:
            conn.execute("ALTER TABLE users ADD COLUMN is_invited INTEGER NOT NULL DEFAULT 0")
            conn.execute("UPDATE users SET is_invited = 1")
        # Create invites table if missing
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "invites" not in tables:
            conn.execute("""
                CREATE TABLE invites (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT UNIQUE NOT NULL,
                    created_by INTEGER NOT NULL REFERENCES users(id),
                    redeemed_by INTEGER REFERENCES users(id),
                    redeemed_at TEXT,
                    session_id TEXT,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_invites_created_by ON invites(created_by)")
        conn.commit()


def init_db():
    """Create tables if they don't exist."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute(_PG_SCHEMA)
                conn.commit()
        _migrate_events_zh()
        _migrate_apple_id()
        _migrate_invites()
        return

    # SQLite path (existing logic)
    conn = _get_sqlite_conn()
    conn.executescript(_SQLITE_SCHEMA)
    # Migration: add _zh columns to events
    _migrate_events_zh()
    _migrate_apple_id()
    # Migration: add columns if missing
    cols = [row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "can_debug" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN can_debug INTEGER NOT NULL DEFAULT 0")
    if "tier" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'")
    if "promo_expires_at" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN promo_expires_at TEXT")
    # Migration: conversations.id INTEGER → TEXT (UUID)
    convo_cols = {row[1]: row[2] for row in conn.execute("PRAGMA table_info(conversations)").fetchall()}
    if convo_cols.get("id") == "INTEGER":
        conn.execute("DROP TABLE IF EXISTS messages")
        conn.execute("DROP TABLE IF EXISTS conversations")
        conn.execute("DROP TABLE IF EXISTS _conversations_old")
        conn.commit()
        init_db()
        return
    conn.commit()
    _migrate_invites()


# ── Users ───────────────────────────────────────────────────────


def upsert_user(google_id: str, email: str, name: str, avatar_url: str = "") -> dict:
    """Insert or update a user from Google OAuth. Upserts by email so accounts link automatically."""
    now = datetime.now(_ET).isoformat()
    _exec_modify(
        # SQLite
        """INSERT INTO users (google_id, email, name, avatar_url, created_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET
             google_id=excluded.google_id, name=excluded.name,
             avatar_url=excluded.avatar_url, last_login_at=?""",
        # PostgreSQL
        """INSERT INTO users (google_id, email, name, avatar_url, created_at, last_login_at)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT(email) DO UPDATE SET
             google_id=EXCLUDED.google_id, name=EXCLUDED.name,
             avatar_url=EXCLUDED.avatar_url, last_login_at=%s""",
        (google_id, email, name, avatar_url, now, now, now),
    )
    return _exec_one(
        "SELECT * FROM users WHERE email=?",
        "SELECT * FROM users WHERE email=%s",
        (email,),
    )


def upsert_user_apple(apple_id: str, email: str, name: str) -> dict:
    """Insert or update a user from Apple Sign In. Upserts by email so accounts link automatically."""
    now = datetime.now(_ET).isoformat()
    _exec_modify(
        # SQLite
        """INSERT INTO users (apple_id, email, name, created_at, last_login_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET
             apple_id=excluded.apple_id,
             name=CASE WHEN users.name='' OR users.name IS NULL THEN excluded.name ELSE users.name END,
             last_login_at=?""",
        # PostgreSQL
        """INSERT INTO users (apple_id, email, name, created_at, last_login_at)
           VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT(email) DO UPDATE SET
             apple_id=EXCLUDED.apple_id,
             name=CASE WHEN users.name='' OR users.name IS NULL THEN EXCLUDED.name ELSE users.name END,
             last_login_at=%s""",
        (apple_id, email, name, now, now, now),
    )
    return _exec_one(
        "SELECT * FROM users WHERE email=?",
        "SELECT * FROM users WHERE email=%s",
        (email,),
    )


def get_user_by_id(user_id: int) -> dict | None:
    return _exec_one(
        "SELECT * FROM users WHERE id=?",
        "SELECT * FROM users WHERE id=%s",
        (user_id,),
    )


def list_users() -> list[dict]:
    return _exec("SELECT * FROM users ORDER BY id", "SELECT * FROM users ORDER BY id")


def update_user_permissions(user_id: int, is_admin: int | None = None, can_debug: int | None = None) -> dict | None:
    parts, params = [], []
    if is_admin is not None:
        parts.append("is_admin=?" if not _is_pg() else "is_admin=%s")
        params.append(bool(is_admin) if _is_pg() else is_admin)
    if can_debug is not None:
        parts.append("can_debug=?" if not _is_pg() else "can_debug=%s")
        params.append(bool(can_debug) if _is_pg() else can_debug)
    if not parts:
        return get_user_by_id(user_id)
    params.append(user_id)
    ph = "?" if not _is_pg() else "%s"
    sql = f"UPDATE users SET {', '.join(parts)} WHERE id={ph}"
    _exec_modify(sql, sql, tuple(params))
    return get_user_by_id(user_id)


# ── Conversations ───────────────────────────────────────────────


def create_conversation(user_id: int, village: str, title: str = "New conversation") -> dict:
    convo_id = uuid.uuid4().hex
    _exec_modify(
        "INSERT INTO conversations (id, user_id, village, title) VALUES (?, ?, ?, ?)",
        "INSERT INTO conversations (id, user_id, village, title) VALUES (%s, %s, %s, %s)",
        (convo_id, user_id, village, title),
    )
    return _exec_one(
        "SELECT * FROM conversations WHERE id=?",
        "SELECT * FROM conversations WHERE id=%s",
        (convo_id,),
    )


def list_conversations(user_id: int) -> list[dict]:
    return _exec(
        """SELECT c.*,
                  (SELECT COUNT(*) FROM messages WHERE conversation_id=c.id) AS message_count,
                  (SELECT content FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS preview
           FROM conversations c
           WHERE c.user_id=?
           ORDER BY c.updated_at DESC""",
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
        "SELECT * FROM conversations WHERE id=?",
        "SELECT * FROM conversations WHERE id=%s",
        (conversation_id,),
    )


def update_conversation_title(conversation_id: str, title: str):
    _exec_modify(
        "UPDATE conversations SET title=? WHERE id=?",
        "UPDATE conversations SET title=%s WHERE id=%s",
        (title, conversation_id),
    )


def touch_conversation(conversation_id: str):
    _exec_modify(
        "UPDATE conversations SET updated_at=datetime('now') WHERE id=?",
        "UPDATE conversations SET updated_at=NOW() WHERE id=%s",
        (conversation_id,),
    )


def delete_conversation(conversation_id: str):
    _exec_modify(
        "DELETE FROM conversations WHERE id=?",
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

    if _is_pg():
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
    else:
        conn = _get_sqlite_conn()
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
    rows = _exec(
        "SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at",
        "SELECT * FROM messages WHERE conversation_id=%s ORDER BY created_at",
        (conversation_id,),
    )
    for d in rows:
        if d.get("sources_json"):
            d["sources"] = json.loads(d["sources_json"])
        else:
            d["sources"] = []
    return rows


# ── Events ──────────────────────────────────────────────────────


def upsert_event(event: dict) -> dict:
    """Insert or update an event. Deduplicates by (source, source_id)."""
    now = datetime.now(_ET).isoformat()
    params = (
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
    )
    _exec_modify(
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
             title_zh = CASE WHEN events.title = excluded.title THEN events.title_zh ELSE NULL END,
             description_zh = CASE WHEN events.description = excluded.description THEN events.description_zh ELSE NULL END,
             venue_zh = CASE WHEN events.venue = excluded.venue THEN events.venue_zh ELSE NULL END,
             updated_at=?""",
        """INSERT INTO events (title, description, event_date, event_time, end_date,
               location, venue, url, image_url, category, scope, village,
               source, source_id, created_at, updated_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT(source, source_id) DO UPDATE SET
             title=EXCLUDED.title, description=EXCLUDED.description,
             event_date=EXCLUDED.event_date, event_time=EXCLUDED.event_time,
             end_date=EXCLUDED.end_date, location=EXCLUDED.location,
             venue=EXCLUDED.venue, url=EXCLUDED.url, image_url=EXCLUDED.image_url,
             category=EXCLUDED.category, scope=EXCLUDED.scope, village=EXCLUDED.village,
             title_zh = CASE WHEN events.title = EXCLUDED.title THEN events.title_zh ELSE NULL END,
             description_zh = CASE WHEN events.description = EXCLUDED.description THEN events.description_zh ELSE NULL END,
             venue_zh = CASE WHEN events.venue = EXCLUDED.venue THEN events.venue_zh ELSE NULL END,
             updated_at=%s""",
        params,
    )
    row = _exec_one(
        "SELECT * FROM events WHERE source=? AND source_id=?",
        "SELECT * FROM events WHERE source=%s AND source_id=%s",
        (event.get("source", ""), event.get("source_id", "")),
    )
    return row if row else event


def get_upcoming_events(
    village: str | None = None,
    limit: int = 8,
    category: str | None = None,
) -> list[dict]:
    """Get upcoming events with waterfall fallback."""
    today = datetime.now(_ET).strftime("%Y-%m-%d")
    results: list[dict] = []
    seen_ids: set[int] = set()

    def _fetch(where_clause: str, params: tuple, max_rows: int) -> list[dict]:
        if _is_pg():
            base_sql = f"""
                SELECT * FROM events
                WHERE event_date >= %s {where_clause}
                ORDER BY event_date ASC, event_time ASC
                LIMIT %s
            """
            rows = _exec(base_sql, base_sql, (today, *params, max_rows))
        else:
            base_sql = f"""
                SELECT * FROM events
                WHERE event_date >= ? {where_clause}
                ORDER BY event_date ASC, event_time ASC
                LIMIT ?
            """
            rows = _exec(base_sql, base_sql, (today, *params, max_rows))
        fetched = []
        for d in rows:
            if d["id"] not in seen_ids:
                seen_ids.add(d["id"])
                fetched.append(d)
        return fetched

    ph = "%s" if _is_pg() else "?"

    if village:
        village_events = _fetch(f"AND scope={ph} AND village={ph}", ("village", village), limit)
        results.extend(village_events)

    if len(results) < limit:
        area_events = _fetch(f"AND scope={ph}", ("area",), limit - len(results))
        results.extend(area_events)

    if len(results) < limit:
        li_events = _fetch(
            f"AND scope={ph} AND category IN ({ph},{ph},{ph})",
            ("longisland", "entertainment", "food", "festival"),
            limit - len(results),
        )
        results.extend(li_events)

    if len(results) < limit:
        extra = _fetch(f"AND scope={ph}", ("longisland",), limit - len(results))
        results.extend(extra)

    results.sort(key=lambda e: (e.get("event_date", ""), e.get("event_time", "")))
    return results[:limit]


def get_event_by_id(event_id: int) -> dict | None:
    return _exec_one(
        "SELECT * FROM events WHERE id=?",
        "SELECT * FROM events WHERE id=%s",
        (event_id,),
    )


def set_user_tier(user_id: int, tier: str) -> dict | None:
    _exec_modify(
        "UPDATE users SET tier=? WHERE id=?",
        "UPDATE users SET tier=%s WHERE id=%s",
        (tier, user_id),
    )
    return get_user_by_id(user_id)


def set_promo_expiry(user_id: int, expires_at: str) -> dict | None:
    _exec_modify(
        "UPDATE users SET promo_expires_at=? WHERE id=?",
        "UPDATE users SET promo_expires_at=%s WHERE id=%s",
        (expires_at, user_id),
    )
    return get_user_by_id(user_id)


# ── Usage Tracking ──────────────────────────────────────────────


def get_or_create_usage(session_id: str, user_id: int | None = None) -> dict:
    row = _exec_one(
        "SELECT * FROM usage_tracking WHERE session_id=?",
        "SELECT * FROM usage_tracking WHERE session_id=%s",
        (session_id,),
    )
    if row:
        return row
    _exec_modify(
        "INSERT INTO usage_tracking (session_id, user_id) VALUES (?, ?)",
        "INSERT INTO usage_tracking (session_id, user_id) VALUES (%s, %s)",
        (session_id, user_id),
    )
    return _exec_one(
        "SELECT * FROM usage_tracking WHERE session_id=?",
        "SELECT * FROM usage_tracking WHERE session_id=%s",
        (session_id,),
    )


def increment_usage(session_id: str) -> dict:
    _exec_modify(
        "UPDATE usage_tracking SET query_count=query_count+1, last_query_at=datetime('now') WHERE session_id=?",
        "UPDATE usage_tracking SET query_count=query_count+1, last_query_at=NOW() WHERE session_id=%s",
        (session_id,),
    )
    return _exec_one(
        "SELECT * FROM usage_tracking WHERE session_id=?",
        "SELECT * FROM usage_tracking WHERE session_id=%s",
        (session_id,),
    )


def claim_extended_trial(session_id: str) -> bool:
    row = _exec_one(
        "SELECT extended_trial FROM usage_tracking WHERE session_id=?",
        "SELECT extended_trial FROM usage_tracking WHERE session_id=%s",
        (session_id,),
    )
    if not row or row["extended_trial"]:
        return False
    _exec_modify(
        "UPDATE usage_tracking SET extended_trial=1 WHERE session_id=?",
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
        "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
        "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (%s, %s, %s, %s)",
        (token_id, user_id, token_hash, expires_at),
    )
    return token


def validate_refresh_token(token: str) -> dict | None:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    row = _exec_one(
        "SELECT * FROM refresh_tokens WHERE token_hash=? AND revoked=0",
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
        "UPDATE refresh_tokens SET revoked=1 WHERE user_id=?",
        "UPDATE refresh_tokens SET revoked=TRUE WHERE user_id=%s",
        (user_id,),
    )


def cleanup_past_events(days_old: int = 7):
    if _is_pg():
        _exec_modify(
            "",
            "DELETE FROM events WHERE event_date < (CURRENT_DATE - make_interval(days => %s))::TEXT",
            (days_old,),
        )
    else:
        _exec_modify(
            "DELETE FROM events WHERE event_date < date('now', ? || ' days')",
            "",
            (f"-{days_old}",),
        )


# ── Analytics Queries ───────────────────────────────────────────


def get_dau(days: int = 30) -> list[dict]:
    if _is_pg():
        return _exec(
            "",
            """SELECT DATE(last_query_at)::TEXT AS date,
                      COUNT(DISTINCT user_id) AS users,
                      COUNT(DISTINCT session_id) AS sessions
               FROM usage_tracking
               WHERE last_query_at >= NOW() - make_interval(days => %s)
               GROUP BY DATE(last_query_at)
               ORDER BY DATE(last_query_at)""",
            (days,),
        )
    return _exec(
        """SELECT date(last_query_at) AS date,
                  COUNT(DISTINCT user_id) AS users,
                  COUNT(DISTINCT session_id) AS sessions
           FROM usage_tracking
           WHERE last_query_at >= datetime('now', ? || ' days')
           GROUP BY date(last_query_at)
           ORDER BY date(last_query_at)""",
        "",
        (f"-{days}",),
    )


def get_daily_queries(days: int = 30) -> list[dict]:
    if _is_pg():
        return _exec(
            "",
            """SELECT DATE(last_query_at)::TEXT AS date,
                      SUM(query_count) AS count
               FROM usage_tracking
               WHERE last_query_at >= NOW() - make_interval(days => %s)
               GROUP BY DATE(last_query_at)
               ORDER BY DATE(last_query_at)""",
            (days,),
        )
    return _exec(
        """SELECT date(last_query_at) AS date,
                  SUM(query_count) AS count
           FROM usage_tracking
           WHERE last_query_at >= datetime('now', ? || ' days')
           GROUP BY date(last_query_at)
           ORDER BY date(last_query_at)""",
        "",
        (f"-{days}",),
    )


def get_tier_breakdown() -> dict:
    rows = _exec(
        "SELECT id, tier, promo_expires_at, is_admin FROM users",
        "SELECT id, tier, promo_expires_at, is_admin FROM users",
    )
    counts = {"free": 0, "free_promo": 0, "pro": 0}
    now = datetime.now(timezone.utc)
    for r in rows:
        if r["is_admin"] or r["tier"] == "pro":
            counts["pro"] += 1
        elif r["promo_expires_at"]:
            try:
                exp = datetime.fromisoformat(str(r["promo_expires_at"]))
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
    val = _exec_scalar(
        "SELECT COUNT(*) AS cnt FROM users",
        "SELECT COUNT(*) AS cnt FROM users",
    )
    return val if val else 0


def get_top_agents(days: int = 7) -> list[dict]:
    if _is_pg():
        return _exec(
            "",
            """SELECT agent_used AS agent, COUNT(*) AS count
               FROM messages
               WHERE agent_used IS NOT NULL
                 AND created_at >= NOW() - make_interval(days => %s)
               GROUP BY agent_used
               ORDER BY count DESC
               LIMIT 10""",
            (days,),
        )
    return _exec(
        """SELECT agent_used AS agent, COUNT(*) AS count
           FROM messages
           WHERE agent_used IS NOT NULL
             AND created_at >= datetime('now', ? || ' days')
           GROUP BY agent_used
           ORDER BY count DESC
           LIMIT 10""",
        "",
        (f"-{days}",),
    )


# ── LLM Usage (batch insert + aggregation) ────────────────────


def batch_insert_usage(records: list) -> None:
    """Batch-insert UsageRecord objects into llm_usage table.

    Called by the metrics collector background task — NOT on the hot path.
    """
    if not records:
        return

    if _is_pg():
        from psycopg2.extras import execute_values
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                sql = """INSERT INTO llm_usage
                    (session_id, conversation_id, role, model,
                     prompt_tokens, completion_tokens, total_tokens,
                     cost_usd, latency_ms)
                    VALUES %s"""
                values = [
                    (r.session_id, r.conversation_id, r.role, r.model,
                     r.prompt_tokens, r.completion_tokens, r.total_tokens,
                     r.cost_usd, r.latency_ms)
                    for r in records
                ]
                execute_values(cur, sql, values)
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        conn.executemany(
            """INSERT INTO llm_usage
                (session_id, conversation_id, role, model,
                 prompt_tokens, completion_tokens, total_tokens,
                 cost_usd, latency_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [(r.session_id, r.conversation_id, r.role, r.model,
              r.prompt_tokens, r.completion_tokens, r.total_tokens,
              r.cost_usd, r.latency_ms)
             for r in records],
        )
        conn.commit()


def get_daily_token_usage(days: int = 30) -> list[dict]:
    """Daily totals: tokens, cost, call count."""
    if _is_pg():
        return _exec(
            "",
            """SELECT DATE(created_at)::TEXT AS date,
                      SUM(prompt_tokens) AS prompt_tokens,
                      SUM(completion_tokens) AS completion_tokens,
                      SUM(total_tokens) AS total_tokens,
                      SUM(cost_usd) AS cost_usd,
                      COUNT(*) AS call_count
               FROM llm_usage
               WHERE created_at >= NOW() - make_interval(days => %s)
               GROUP BY DATE(created_at)
               ORDER BY DATE(created_at)""",
            (days,),
        )
    return _exec(
        """SELECT date(created_at) AS date,
                  SUM(prompt_tokens) AS prompt_tokens,
                  SUM(completion_tokens) AS completion_tokens,
                  SUM(total_tokens) AS total_tokens,
                  SUM(cost_usd) AS cost_usd,
                  COUNT(*) AS call_count
           FROM llm_usage
           WHERE created_at >= datetime('now', ? || ' days')
           GROUP BY date(created_at)
           ORDER BY date(created_at)""",
        "",
        (f"-{days}",),
    )


def get_usage_by_role(days: int = 7) -> list[dict]:
    """Token usage broken down by agent role."""
    if _is_pg():
        return _exec(
            "",
            """SELECT role,
                      SUM(prompt_tokens) AS prompt_tokens,
                      SUM(completion_tokens) AS completion_tokens,
                      SUM(total_tokens) AS total_tokens,
                      SUM(cost_usd) AS cost_usd,
                      COUNT(*) AS call_count,
                      ROUND(AVG(latency_ms)) AS avg_latency_ms
               FROM llm_usage
               WHERE created_at >= NOW() - make_interval(days => %s)
               GROUP BY role
               ORDER BY SUM(total_tokens) DESC""",
            (days,),
        )
    return _exec(
        """SELECT role,
                  SUM(prompt_tokens) AS prompt_tokens,
                  SUM(completion_tokens) AS completion_tokens,
                  SUM(total_tokens) AS total_tokens,
                  SUM(cost_usd) AS cost_usd,
                  COUNT(*) AS call_count,
                  ROUND(AVG(latency_ms)) AS avg_latency_ms
           FROM llm_usage
           WHERE created_at >= datetime('now', ? || ' days')
           GROUP BY role
           ORDER BY SUM(total_tokens) DESC""",
        "",
        (f"-{days}",),
    )


def get_usage_by_model(days: int = 7) -> list[dict]:
    """Token usage broken down by model."""
    if _is_pg():
        return _exec(
            "",
            """SELECT model,
                      SUM(total_tokens) AS total_tokens,
                      SUM(cost_usd) AS cost_usd,
                      COUNT(*) AS call_count
               FROM llm_usage
               WHERE created_at >= NOW() - make_interval(days => %s)
               GROUP BY model
               ORDER BY SUM(cost_usd) DESC""",
            (days,),
        )
    return _exec(
        """SELECT model,
                  SUM(total_tokens) AS total_tokens,
                  SUM(cost_usd) AS cost_usd,
                  COUNT(*) AS call_count
           FROM llm_usage
           WHERE created_at >= datetime('now', ? || ' days')
           GROUP BY model
           ORDER BY SUM(cost_usd) DESC""",
        "",
        (f"-{days}",),
    )


# ── Invites ────────────────────────────────────────────────────


def create_invite(code: str, created_by: int) -> dict:
    """Insert a new invite code and return the invite row."""
    if _is_pg():
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
    else:
        conn = _get_sqlite_conn()
        cur = conn.execute(
            "INSERT INTO invites (code, created_by) VALUES (?, ?)",
            (code, created_by),
        )
        conn.commit()
        return dict(conn.execute("SELECT * FROM invites WHERE id=?", (cur.lastrowid,)).fetchone())


def get_invite_by_code(code: str) -> dict | None:
    return _exec_one(
        "SELECT * FROM invites WHERE code=?",
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
        "UPDATE invites SET redeemed_at=?, session_id=?, redeemed_by=? WHERE code=?",
        "UPDATE invites SET redeemed_at=%s, session_id=%s, redeemed_by=%s WHERE code=%s",
        (now, session_id, user_id, code),
    )
    return get_invite_by_code(code)


def count_invites_by_user(user_id: int) -> int:
    val = _exec_scalar(
        "SELECT COUNT(*) FROM invites WHERE created_by=?",
        "SELECT COUNT(*) FROM invites WHERE created_by=%s",
        (user_id,),
    )
    return val if val else 0


def list_invites_by_user(user_id: int) -> list[dict]:
    return _exec(
        "SELECT * FROM invites WHERE created_by=? ORDER BY created_at DESC",
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
        """SELECT i.*, c.name AS creator_name, c.email AS creator_email,
                  r.name AS redeemer_name, r.email AS redeemer_email
           FROM invites i
           LEFT JOIN users c ON i.created_by = c.id
           LEFT JOIN users r ON i.redeemed_by = r.id
           ORDER BY i.created_at DESC""",
    )


def mark_user_invited(user_id: int) -> dict | None:
    _exec_modify(
        "UPDATE users SET is_invited=1 WHERE id=?",
        "UPDATE users SET is_invited=TRUE WHERE id=%s",
        (user_id,),
    )
    return get_user_by_id(user_id)


def link_invite_to_user(session_id: str, user_id: int) -> bool:
    """Link a session's redeemed invite to a user account and set is_invited."""
    invite = _exec_one(
        "SELECT * FROM invites WHERE session_id=? AND redeemed_by IS NULL",
        "SELECT * FROM invites WHERE session_id=%s AND redeemed_by IS NULL",
        (session_id,),
    )
    if not invite:
        return False
    _exec_modify(
        "UPDATE invites SET redeemed_by=? WHERE id=?",
        "UPDATE invites SET redeemed_by=%s WHERE id=%s",
        (user_id, invite["id"]),
    )
    mark_user_invited(user_id)
    return True
