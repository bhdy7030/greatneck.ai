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

# Thread-local dedicated connection for background tasks (rollup, backfill).
# When set, all DB helpers use this instead of the pool, so background work
# never competes with user-facing requests for pool connections.
_bg_conn: threading.local = threading.local()


class _BgConnContext:
    """Context manager: opens a dedicated PG connection for background work.

    While active (on the current thread), all _PgConnWrapper calls will reuse
    this single connection instead of hitting the shared pool.
    """
    def __init__(self):
        self._conn = None

    def __enter__(self):
        if _is_pg():
            import psycopg2
            self._conn = psycopg2.connect(_DATABASE_URL)
            _bg_conn.conn = self._conn
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        _bg_conn.conn = None
        if self._conn is not None:
            try:
                if exc_type is not None:
                    self._conn.rollback()
                self._conn.close()
            except Exception:
                pass
            self._conn = None


def background_connection():
    """Get a context manager that provides a dedicated DB connection for background tasks."""
    return _BgConnContext()


class _PgConnWrapper:
    """Context manager that returns a psycopg2 connection to the pool,
    or the dedicated background connection if one is active."""
    def __init__(self):
        self.conn = None
        self._from_pool = False

    def __enter__(self):
        # Use dedicated background connection if available (rollup/backfill)
        bg = getattr(_bg_conn, 'conn', None)
        if bg is not None:
            self.conn = bg
            self._from_pool = False
            return self.conn
        # Otherwise use the shared pool
        self.conn = _get_pg_pool().getconn()
        self._from_pool = True
        return self.conn

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.conn is not None:
            if exc_type is not None:
                self.conn.rollback()
            if self._from_pool:
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
    latency_ms INTEGER DEFAULT 0,
    source TEXT DEFAULT 'user'
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

CREATE TABLE IF NOT EXISTS guide_saves (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    session_id TEXT,
    guide_id TEXT NOT NULL,
    saved_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, guide_id),
    UNIQUE(session_id, guide_id)
);

CREATE TABLE IF NOT EXISTS guide_step_status (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    session_id TEXT,
    guide_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo',
    remind_at TIMESTAMP,
    note TEXT,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, guide_id, step_id),
    UNIQUE(session_id, guide_id, step_id)
);
CREATE INDEX IF NOT EXISTS idx_gss_remind ON guide_step_status(remind_at)
    WHERE remind_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS metrics_daily (
    date DATE NOT NULL,
    metric_type TEXT NOT NULL,
    dimension TEXT NOT NULL DEFAULT '_total',
    count INTEGER NOT NULL DEFAULT 0,
    sum_value REAL NOT NULL DEFAULT 0,
    avg_value REAL NOT NULL DEFAULT 0,
    p95_value REAL NOT NULL DEFAULT 0,
    min_value REAL NOT NULL DEFAULT 0,
    max_value REAL NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (date, metric_type, dimension)
);
CREATE INDEX IF NOT EXISTS idx_metrics_daily_type_date ON metrics_daily(metric_type, date);

CREATE TABLE IF NOT EXISTS pipeline_events (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP DEFAULT NOW(),
    session_id TEXT DEFAULT '',
    conversation_id TEXT DEFAULT '',
    event_type TEXT NOT NULL,
    event_name TEXT NOT NULL,
    duration_ms INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    success BOOLEAN DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_pe_created ON pipeline_events(created_at);
CREATE INDEX IF NOT EXISTS idx_pe_type_created ON pipeline_events(event_type, created_at);

CREATE TABLE IF NOT EXISTS page_visits (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP DEFAULT NOW(),
    session_id TEXT NOT NULL,
    user_id INTEGER,
    page TEXT NOT NULL,
    referrer TEXT DEFAULT '',
    user_agent TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_pv_created ON page_visits(created_at);
CREATE INDEX IF NOT EXISTS idx_pv_session_created ON page_visits(session_id, created_at);

CREATE TABLE IF NOT EXISTS waitlist (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at);
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
    latency_ms INTEGER DEFAULT 0,
    source TEXT DEFAULT 'user'
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

CREATE TABLE IF NOT EXISTS guide_saves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    session_id TEXT,
    guide_id TEXT NOT NULL,
    saved_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, guide_id),
    UNIQUE(session_id, guide_id)
);

CREATE TABLE IF NOT EXISTS guide_step_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    session_id TEXT,
    guide_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo',
    remind_at TEXT,
    note TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, guide_id, step_id),
    UNIQUE(session_id, guide_id, step_id)
);
CREATE INDEX IF NOT EXISTS idx_gss_remind ON guide_step_status(remind_at);

CREATE TABLE IF NOT EXISTS metrics_daily (
    date TEXT NOT NULL,
    metric_type TEXT NOT NULL,
    dimension TEXT NOT NULL DEFAULT '_total',
    count INTEGER NOT NULL DEFAULT 0,
    sum_value REAL NOT NULL DEFAULT 0,
    avg_value REAL NOT NULL DEFAULT 0,
    p95_value REAL NOT NULL DEFAULT 0,
    min_value REAL NOT NULL DEFAULT 0,
    max_value REAL NOT NULL DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (date, metric_type, dimension)
);
CREATE INDEX IF NOT EXISTS idx_metrics_daily_type_date ON metrics_daily(metric_type, date);

CREATE TABLE IF NOT EXISTS pipeline_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT (datetime('now')),
    session_id TEXT DEFAULT '',
    conversation_id TEXT DEFAULT '',
    event_type TEXT NOT NULL,
    event_name TEXT NOT NULL,
    duration_ms INTEGER DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    success INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_pe_created ON pipeline_events(created_at);
CREATE INDEX IF NOT EXISTS idx_pe_type_created ON pipeline_events(event_type, created_at);

CREATE TABLE IF NOT EXISTS page_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT (datetime('now')),
    session_id TEXT NOT NULL,
    user_id INTEGER,
    page TEXT NOT NULL,
    referrer TEXT DEFAULT '',
    user_agent TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_pv_created ON page_visits(created_at);
CREATE INDEX IF NOT EXISTS idx_pv_session_created ON page_visits(session_id, created_at);

CREATE TABLE IF NOT EXISTS waitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at);
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


def _migrate_guides():
    """Add guide_saves and guide_step_status tables if missing."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS guide_saves (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER REFERENCES users(id),
                        session_id TEXT,
                        guide_id TEXT NOT NULL,
                        saved_at TIMESTAMP DEFAULT NOW(),
                        UNIQUE(user_id, guide_id),
                        UNIQUE(session_id, guide_id)
                    )
                """)
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS guide_step_status (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER REFERENCES users(id),
                        session_id TEXT,
                        guide_id TEXT NOT NULL,
                        step_id TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'todo',
                        remind_at TIMESTAMP,
                        note TEXT,
                        updated_at TIMESTAMP DEFAULT NOW(),
                        UNIQUE(user_id, guide_id, step_id),
                        UNIQUE(session_id, guide_id, step_id)
                    )
                """)
                cur.execute("""
                    CREATE INDEX IF NOT EXISTS idx_gss_remind ON guide_step_status(remind_at)
                    WHERE remind_at IS NOT NULL
                """)
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "guide_saves" not in tables:
            conn.execute("""
                CREATE TABLE guide_saves (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER REFERENCES users(id),
                    session_id TEXT,
                    guide_id TEXT NOT NULL,
                    saved_at TEXT DEFAULT (datetime('now')),
                    UNIQUE(user_id, guide_id),
                    UNIQUE(session_id, guide_id)
                )
            """)
        if "guide_step_status" not in tables:
            conn.execute("""
                CREATE TABLE guide_step_status (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER REFERENCES users(id),
                    session_id TEXT,
                    guide_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'todo',
                    remind_at TEXT,
                    note TEXT,
                    updated_at TEXT DEFAULT (datetime('now')),
                    UNIQUE(user_id, guide_id, step_id),
                    UNIQUE(session_id, guide_id, step_id)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_gss_remind ON guide_step_status(remind_at)")
        conn.commit()


def _migrate_user_guides():
    """Add user_guides table if missing."""
    try:
        if _is_pg():
            with _PgConnWrapper() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS user_guides (
                            id TEXT PRIMARY KEY,
                            user_id INTEGER REFERENCES users(id),
                            session_id TEXT,
                            guide_data JSONB NOT NULL,
                            source_guide_id TEXT,
                            is_published BOOLEAN NOT NULL DEFAULT FALSE,
                            is_draft BOOLEAN NOT NULL DEFAULT TRUE,
                            created_at TIMESTAMP DEFAULT NOW(),
                            updated_at TIMESTAMP DEFAULT NOW()
                        )
                    """)
                    conn.commit()
        else:
            conn = _get_sqlite_conn()
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
            if "user_guides" not in tables:
                conn.execute("""
                    CREATE TABLE user_guides (
                        id TEXT PRIMARY KEY,
                        user_id INTEGER,
                        session_id TEXT,
                        guide_data TEXT NOT NULL,
                        source_guide_id TEXT,
                        is_published INTEGER NOT NULL DEFAULT 0,
                        is_draft INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT DEFAULT (datetime('now')),
                        updated_at TEXT DEFAULT (datetime('now'))
                    )
                """)
            conn.commit()
    except Exception:
        import logging
        logging.getLogger(__name__).exception("_migrate_user_guides failed")


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
        _migrate_guides()
        _migrate_user_guides()
        _migrate_metrics_daily()
        _migrate_page_visits()
        _migrate_waitlist()
        _migrate_llm_usage_source()
        _migrate_user_handles()
        _migrate_comments()
        _migrate_likes()
        _migrate_notifications()
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
    _migrate_guides()
    _migrate_user_guides()
    _migrate_metrics_daily()
    _migrate_page_visits()
    _migrate_waitlist()
    _migrate_llm_usage_source()
    _migrate_user_handles()
    _migrate_comments()
    _migrate_likes()
    _migrate_notifications()


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
                     cost_usd, latency_ms, source)
                    VALUES %s"""
                values = [
                    (r.session_id, r.conversation_id, r.role, r.model,
                     r.prompt_tokens, r.completion_tokens, r.total_tokens,
                     r.cost_usd, r.latency_ms, getattr(r, 'source', 'user') or 'user')
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
                 cost_usd, latency_ms, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [(r.session_id, r.conversation_id, r.role, r.model,
              r.prompt_tokens, r.completion_tokens, r.total_tokens,
              r.cost_usd, r.latency_ms, getattr(r, 'source', 'user') or 'user')
             for r in records],
        )
        conn.commit()


def batch_insert_pipeline_events(events: list) -> None:
    """Batch-insert PipelineEvent objects into pipeline_events table.

    Called by the metrics collector background task — NOT on the hot path.
    """
    if not events:
        return

    if _is_pg():
        from psycopg2.extras import execute_values
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                sql = """INSERT INTO pipeline_events
                    (session_id, conversation_id, event_type, event_name,
                     duration_ms, metadata, success)
                    VALUES %s"""
                values = [
                    (e.session_id, e.conversation_id, e.event_type, e.event_name,
                     e.duration_ms, json.dumps(e.metadata) if e.metadata else '{}',
                     e.success)
                    for e in events
                ]
                execute_values(cur, sql, values)
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        conn.executemany(
            """INSERT INTO pipeline_events
                (session_id, conversation_id, event_type, event_name,
                 duration_ms, metadata, success)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [(e.session_id, e.conversation_id, e.event_type, e.event_name,
              e.duration_ms, json.dumps(e.metadata) if e.metadata else '{}',
              1 if e.success else 0)
             for e in events],
        )
        conn.commit()


def batch_insert_page_visits(visits: list) -> None:
    """Batch-insert PageVisit objects into page_visits table.

    Called by the metrics collector background task — NOT on the hot path.
    """
    if not visits:
        return

    if _is_pg():
        from psycopg2.extras import execute_values
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                sql = """INSERT INTO page_visits
                    (session_id, user_id, page, referrer, user_agent)
                    VALUES %s"""
                values = [
                    (v.session_id, v.user_id or None, v.page,
                     v.referrer, v.user_agent)
                    for v in visits
                ]
                execute_values(cur, sql, values)
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        conn.executemany(
            """INSERT INTO page_visits
                (session_id, user_id, page, referrer, user_agent)
                VALUES (?, ?, ?, ?, ?)""",
            [(v.session_id, v.user_id or None, v.page,
              v.referrer, v.user_agent)
             for v in visits],
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


# ── Guides ─────────────────────────────────────────────────────


def get_saved_guide_ids(user_id: int | None, session_id: str | None) -> list[str]:
    """Return list of guide_ids saved by the user/session."""
    if user_id:
        rows = _exec(
            "SELECT guide_id FROM guide_saves WHERE user_id=?",
            "SELECT guide_id FROM guide_saves WHERE user_id=%s",
            (user_id,),
        )
    elif session_id:
        rows = _exec(
            "SELECT guide_id FROM guide_saves WHERE session_id=?",
            "SELECT guide_id FROM guide_saves WHERE session_id=%s",
            (session_id,),
        )
    else:
        return []
    return [r["guide_id"] for r in rows]


def save_guide(user_id: int | None, session_id: str | None, guide_id: str):
    """Save a guide to the user's wallet."""
    if user_id:
        _exec_modify(
            "INSERT OR IGNORE INTO guide_saves (user_id, guide_id) VALUES (?, ?)",
            "INSERT INTO guide_saves (user_id, guide_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (user_id, guide_id),
        )
    elif session_id:
        _exec_modify(
            "INSERT OR IGNORE INTO guide_saves (session_id, guide_id) VALUES (?, ?)",
            "INSERT INTO guide_saves (session_id, guide_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (session_id, guide_id),
        )


def unsave_guide(user_id: int | None, session_id: str | None, guide_id: str):
    """Remove a guide from the user's wallet."""
    if user_id:
        _exec_modify(
            "DELETE FROM guide_saves WHERE user_id=? AND guide_id=?",
            "DELETE FROM guide_saves WHERE user_id=%s AND guide_id=%s",
            (user_id, guide_id),
        )
    elif session_id:
        _exec_modify(
            "DELETE FROM guide_saves WHERE session_id=? AND guide_id=?",
            "DELETE FROM guide_saves WHERE session_id=%s AND guide_id=%s",
            (session_id, guide_id),
        )


def get_step_statuses(user_id: int | None, session_id: str | None, guide_id: str) -> list[dict]:
    """Return all step status rows for a guide."""
    if user_id:
        return _exec(
            "SELECT step_id, status, remind_at, note, updated_at FROM guide_step_status WHERE user_id=? AND guide_id=?",
            "SELECT step_id, status, remind_at, note, updated_at FROM guide_step_status WHERE user_id=%s AND guide_id=%s",
            (user_id, guide_id),
        )
    elif session_id:
        return _exec(
            "SELECT step_id, status, remind_at, note, updated_at FROM guide_step_status WHERE session_id=? AND guide_id=?",
            "SELECT step_id, status, remind_at, note, updated_at FROM guide_step_status WHERE session_id=%s AND guide_id=%s",
            (session_id, guide_id),
        )
    return []


def get_all_step_statuses(user_id: int | None, session_id: str | None) -> list[dict]:
    """Return all step statuses across all guides."""
    if user_id:
        return _exec(
            "SELECT guide_id, step_id, status, remind_at, note, updated_at FROM guide_step_status WHERE user_id=?",
            "SELECT guide_id, step_id, status, remind_at, note, updated_at FROM guide_step_status WHERE user_id=%s",
            (user_id,),
        )
    elif session_id:
        return _exec(
            "SELECT guide_id, step_id, status, remind_at, note, updated_at FROM guide_step_status WHERE session_id=?",
            "SELECT guide_id, step_id, status, remind_at, note, updated_at FROM guide_step_status WHERE session_id=%s",
            (session_id,),
        )
    return []


def update_step_status(
    user_id: int | None,
    session_id: str | None,
    guide_id: str,
    step_id: str,
    status: str = "todo",
    remind_at: str | None = None,
    note: str | None = None,
):
    """Upsert step status for a guide step."""
    now = datetime.now(_ET).isoformat()
    if user_id:
        _exec_modify(
            """INSERT INTO guide_step_status (user_id, guide_id, step_id, status, remind_at, note, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(user_id, guide_id, step_id) DO UPDATE SET
                 status=excluded.status, remind_at=excluded.remind_at,
                 note=COALESCE(excluded.note, guide_step_status.note),
                 updated_at=excluded.updated_at""",
            """INSERT INTO guide_step_status (user_id, guide_id, step_id, status, remind_at, note, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT(user_id, guide_id, step_id) DO UPDATE SET
                 status=EXCLUDED.status, remind_at=EXCLUDED.remind_at,
                 note=COALESCE(EXCLUDED.note, guide_step_status.note),
                 updated_at=EXCLUDED.updated_at""",
            (user_id, guide_id, step_id, status, remind_at, note, now),
        )
    elif session_id:
        _exec_modify(
            """INSERT INTO guide_step_status (session_id, guide_id, step_id, status, remind_at, note, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(session_id, guide_id, step_id) DO UPDATE SET
                 status=excluded.status, remind_at=excluded.remind_at,
                 note=COALESCE(excluded.note, guide_step_status.note),
                 updated_at=excluded.updated_at""",
            """INSERT INTO guide_step_status (session_id, guide_id, step_id, status, remind_at, note, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT(session_id, guide_id, step_id) DO UPDATE SET
                 status=EXCLUDED.status, remind_at=EXCLUDED.remind_at,
                 note=COALESCE(EXCLUDED.note, guide_step_status.note),
                 updated_at=EXCLUDED.updated_at""",
            (session_id, guide_id, step_id, status, remind_at, note, now),
        )


def get_due_reminders(user_id: int | None, session_id: str | None) -> list[dict]:
    """Return steps where remind_at is in the past (due reminders)."""
    now = datetime.now(_ET).isoformat()
    if user_id:
        return _exec(
            "SELECT guide_id, step_id, status, remind_at, note FROM guide_step_status WHERE user_id=? AND remind_at IS NOT NULL AND remind_at<=?",
            "SELECT guide_id, step_id, status, remind_at, note FROM guide_step_status WHERE user_id=%s AND remind_at IS NOT NULL AND remind_at<=%s",
            (user_id, now),
        )
    elif session_id:
        return _exec(
            "SELECT guide_id, step_id, status, remind_at, note FROM guide_step_status WHERE session_id=? AND remind_at IS NOT NULL AND remind_at<=?",
            "SELECT guide_id, step_id, status, remind_at, note FROM guide_step_status WHERE session_id=%s AND remind_at IS NOT NULL AND remind_at<=%s",
            (session_id, now),
        )
    return []


def migrate_guide_data(session_id: str, user_id: int):
    """Move anonymous guide data to authenticated user on sign-in."""
    # Move saves
    _exec_modify(
        """UPDATE guide_saves SET user_id=?, session_id=NULL
           WHERE session_id=? AND guide_id NOT IN (SELECT guide_id FROM guide_saves WHERE user_id=?)""",
        """UPDATE guide_saves SET user_id=%s, session_id=NULL
           WHERE session_id=%s AND guide_id NOT IN (SELECT guide_id FROM guide_saves WHERE user_id=%s)""",
        (user_id, session_id, user_id),
    )
    # Clean up duplicate session saves
    _exec_modify(
        "DELETE FROM guide_saves WHERE session_id=?",
        "DELETE FROM guide_saves WHERE session_id=%s",
        (session_id,),
    )
    # Move step statuses
    _exec_modify(
        """UPDATE guide_step_status SET user_id=?, session_id=NULL
           WHERE session_id=? AND (guide_id, step_id) NOT IN
             (SELECT guide_id, step_id FROM guide_step_status WHERE user_id=?)""",
        """UPDATE guide_step_status SET user_id=%s, session_id=NULL
           WHERE session_id=%s AND (guide_id, step_id) NOT IN
             (SELECT guide_id, step_id FROM guide_step_status WHERE user_id=%s)""",
        (user_id, session_id, user_id),
    )
    _exec_modify(
        "DELETE FROM guide_step_status WHERE session_id=?",
        "DELETE FROM guide_step_status WHERE session_id=%s",
        (session_id,),
    )


# ── User Guides (custom playbooks) ──────────────────────────────


def create_user_guide(user_id, session_id, guide_data, source_guide_id=None):
    """Create a new user guide. Returns the guide id."""
    guide_id = f"ug-{uuid.uuid4()}"
    guide_json = json.dumps(guide_data) if isinstance(guide_data, dict) else guide_data
    _exec_modify(
        "INSERT INTO user_guides (id, user_id, session_id, guide_data, source_guide_id) VALUES (?, ?, ?, ?, ?)",
        "INSERT INTO user_guides (id, user_id, session_id, guide_data, source_guide_id) VALUES (%s, %s, %s, %s, %s)",
        (guide_id, user_id, session_id, guide_json, source_guide_id),
    )
    return guide_id


def get_user_guide(guide_id):
    """Get a single user guide by ID, with author_handle."""
    row = _exec_one(
        "SELECT ug.*, u.handle AS author_handle FROM user_guides ug LEFT JOIN users u ON ug.user_id = u.id WHERE ug.id=?",
        "SELECT ug.*, u.handle AS author_handle FROM user_guides ug LEFT JOIN users u ON ug.user_id = u.id WHERE ug.id=%s",
        (guide_id,),
    )
    if row and isinstance(row.get("guide_data"), str):
        row["guide_data"] = json.loads(row["guide_data"])
    return row


def get_user_guides_for_owner(user_id=None, session_id=None):
    """Get all guides owned by a user or session."""
    if user_id:
        rows = _exec(
            "SELECT * FROM user_guides WHERE user_id=? ORDER BY updated_at DESC",
            "SELECT * FROM user_guides WHERE user_id=%s ORDER BY updated_at DESC",
            (user_id,),
        )
    elif session_id:
        rows = _exec(
            "SELECT * FROM user_guides WHERE session_id=? AND user_id IS NULL ORDER BY updated_at DESC",
            "SELECT * FROM user_guides WHERE session_id=%s AND user_id IS NULL ORDER BY updated_at DESC",
            (session_id,),
        )
    else:
        return []
    for r in rows:
        if isinstance(r.get("guide_data"), str):
            r["guide_data"] = json.loads(r["guide_data"])
    return rows


def update_user_guide(guide_id, user_id, session_id, guide_data):
    """Update guide_data for an owned guide. Returns True if updated."""
    guide_json = json.dumps(guide_data) if isinstance(guide_data, dict) else guide_data
    if user_id:
        _exec_modify(
            "UPDATE user_guides SET guide_data=?, updated_at=datetime('now'), is_draft=0 WHERE id=? AND user_id=?",
            "UPDATE user_guides SET guide_data=%s, updated_at=NOW(), is_draft=FALSE WHERE id=%s AND user_id=%s",
            (guide_json, guide_id, user_id),
        )
    elif session_id:
        _exec_modify(
            "UPDATE user_guides SET guide_data=?, updated_at=datetime('now'), is_draft=0 WHERE id=? AND session_id=? AND user_id IS NULL",
            "UPDATE user_guides SET guide_data=%s, updated_at=NOW(), is_draft=FALSE WHERE id=%s AND session_id=%s AND user_id IS NULL",
            (guide_json, guide_id, session_id),
        )
    else:
        return False
    return True


def delete_user_guide(guide_id, user_id=None, session_id=None):
    """Delete an owned guide and cleanup related saves/step_status."""
    if user_id:
        _exec_modify(
            "DELETE FROM user_guides WHERE id=? AND user_id=?",
            "DELETE FROM user_guides WHERE id=%s AND user_id=%s",
            (guide_id, user_id),
        )
        _exec_modify(
            "DELETE FROM guide_saves WHERE guide_id=? AND user_id=?",
            "DELETE FROM guide_saves WHERE guide_id=%s AND user_id=%s",
            (guide_id, user_id),
        )
        _exec_modify(
            "DELETE FROM guide_step_status WHERE guide_id=? AND user_id=?",
            "DELETE FROM guide_step_status WHERE guide_id=%s AND user_id=%s",
            (guide_id, user_id),
        )
    elif session_id:
        _exec_modify(
            "DELETE FROM user_guides WHERE id=? AND session_id=? AND user_id IS NULL",
            "DELETE FROM user_guides WHERE id=%s AND session_id=%s AND user_id IS NULL",
            (guide_id, session_id),
        )
        _exec_modify(
            "DELETE FROM guide_saves WHERE guide_id=? AND session_id=?",
            "DELETE FROM guide_saves WHERE guide_id=%s AND session_id=%s",
            (guide_id, session_id),
        )
        _exec_modify(
            "DELETE FROM guide_step_status WHERE guide_id=? AND session_id=?",
            "DELETE FROM guide_step_status WHERE guide_id=%s AND session_id=%s",
            (guide_id, session_id),
        )


def set_user_guide_published(guide_id, user_id, is_published):
    """Toggle published status. Requires user_id (login required)."""
    _exec_modify(
        "UPDATE user_guides SET is_published=?, is_draft=0, updated_at=datetime('now') WHERE id=? AND user_id=?",
        "UPDATE user_guides SET is_published=%s, is_draft=FALSE, updated_at=NOW() WHERE id=%s AND user_id=%s",
        (int(is_published) if not _is_pg() else is_published, guide_id, user_id),
    )


def get_published_user_guides():
    """Get all published user guides for the catalog, with author_handle."""
    rows = _exec(
        "SELECT ug.*, u.handle AS author_handle FROM user_guides ug LEFT JOIN users u ON ug.user_id = u.id WHERE ug.is_published=1",
        "SELECT ug.*, u.handle AS author_handle FROM user_guides ug LEFT JOIN users u ON ug.user_id = u.id WHERE ug.is_published=TRUE",
        (),
    )
    for r in rows:
        if isinstance(r.get("guide_data"), str):
            r["guide_data"] = json.loads(r["guide_data"])
    return rows


def ensure_system_user(handle, name):
    """Create or find a system user by handle. Returns user id."""
    existing = get_user_by_handle(handle)
    if existing:
        return existing["id"]
    # Create a system user with a placeholder email
    email = f"{handle}@system.local"
    row = _exec_insert_returning(
        f"INSERT INTO users (email, name, handle) VALUES (?, ?, ?)",
        f"INSERT INTO users (email, name, handle) VALUES (%s, %s, %s) RETURNING id",
        (email, name, handle),
    )
    if _is_pg():
        return row["id"]
    return row


def upsert_user_guide(guide_id, user_id, guide_data, is_published=False):
    """INSERT or UPDATE a user_guide by id. Uses guide_id as-is (no ug- prefix forced)."""
    guide_json = json.dumps(guide_data) if isinstance(guide_data, dict) else guide_data
    existing = get_user_guide(guide_id)
    if existing:
        _exec_modify(
            "UPDATE user_guides SET user_id=?, guide_data=?, is_published=?, is_draft=0, updated_at=datetime('now') WHERE id=?",
            "UPDATE user_guides SET user_id=%s, guide_data=%s, is_published=%s, is_draft=FALSE, updated_at=NOW() WHERE id=%s",
            (user_id, guide_json, int(is_published) if not _is_pg() else is_published, guide_id),
        )
    else:
        _exec_modify(
            "INSERT INTO user_guides (id, user_id, session_id, guide_data, is_published, is_draft) VALUES (?, ?, NULL, ?, ?, 0)",
            "INSERT INTO user_guides (id, user_id, session_id, guide_data, is_published, is_draft) VALUES (%s, %s, NULL, %s, %s, FALSE)",
            (guide_id, user_id, guide_json, int(is_published) if not _is_pg() else is_published),
        )


def ingest_yaml_guides():
    """Ingest all YAML catalog guides as @admin user_guides. Idempotent via upsert."""
    import logging
    logger = logging.getLogger(__name__)
    from knowledge.guides_registry import get_all_guides
    admin_id = ensure_system_user("tinydesk", "Tiny Desk")
    guides = get_all_guides()
    for g in guides:
        upsert_user_guide(g["id"], admin_id, g, is_published=True)
    logger.info(f"Ingested {len(guides)} YAML guides as @tinydesk user_guides")


def migrate_user_guide_data(session_id, user_id):
    """Move anonymous guides to a logged-in user on sign-in."""
    _exec_modify(
        "UPDATE user_guides SET user_id=?, session_id=NULL WHERE session_id=? AND user_id IS NULL",
        "UPDATE user_guides SET user_id=%s, session_id=NULL WHERE session_id=%s AND user_id IS NULL",
        (user_id, session_id),
    )


# ── Metrics daily rollup ──────────────────────────────────────────


def _migrate_metrics_daily():
    """Add metrics_daily table if missing (for existing deployments)."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS metrics_daily (
                        date DATE NOT NULL,
                        metric_type TEXT NOT NULL,
                        dimension TEXT NOT NULL DEFAULT '_total',
                        count INTEGER NOT NULL DEFAULT 0,
                        sum_value REAL NOT NULL DEFAULT 0,
                        avg_value REAL NOT NULL DEFAULT 0,
                        p95_value REAL NOT NULL DEFAULT 0,
                        min_value REAL NOT NULL DEFAULT 0,
                        max_value REAL NOT NULL DEFAULT 0,
                        metadata JSONB DEFAULT '{}',
                        updated_at TIMESTAMP DEFAULT NOW(),
                        PRIMARY KEY (date, metric_type, dimension)
                    )
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_metrics_daily_type_date ON metrics_daily(metric_type, date)")
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "metrics_daily" not in tables:
            conn.execute("""
                CREATE TABLE metrics_daily (
                    date TEXT NOT NULL,
                    metric_type TEXT NOT NULL,
                    dimension TEXT NOT NULL DEFAULT '_total',
                    count INTEGER NOT NULL DEFAULT 0,
                    sum_value REAL NOT NULL DEFAULT 0,
                    avg_value REAL NOT NULL DEFAULT 0,
                    p95_value REAL NOT NULL DEFAULT 0,
                    min_value REAL NOT NULL DEFAULT 0,
                    max_value REAL NOT NULL DEFAULT 0,
                    metadata TEXT DEFAULT '{}',
                    updated_at TEXT DEFAULT (datetime('now')),
                    PRIMARY KEY (date, metric_type, dimension)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_metrics_daily_type_date ON metrics_daily(metric_type, date)")
        conn.commit()


def _migrate_page_visits():
    """Add page_visits table if missing (for existing deployments)."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS page_visits (
                        id SERIAL PRIMARY KEY,
                        created_at TIMESTAMP DEFAULT NOW(),
                        session_id TEXT NOT NULL,
                        user_id INTEGER,
                        page TEXT NOT NULL,
                        referrer TEXT DEFAULT '',
                        user_agent TEXT DEFAULT ''
                    )
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_pv_created ON page_visits(created_at)")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_pv_session_created ON page_visits(session_id, created_at)")
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "page_visits" not in tables:
            conn.execute("""
                CREATE TABLE page_visits (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at TEXT DEFAULT (datetime('now')),
                    session_id TEXT NOT NULL,
                    user_id INTEGER,
                    page TEXT NOT NULL,
                    referrer TEXT DEFAULT '',
                    user_agent TEXT DEFAULT ''
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_pv_created ON page_visits(created_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_pv_session_created ON page_visits(session_id, created_at)")
        conn.commit()


def _migrate_waitlist():
    """Add waitlist table if missing (for existing deployments)."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS waitlist (
                        id SERIAL PRIMARY KEY,
                        email TEXT UNIQUE NOT NULL,
                        name TEXT DEFAULT '',
                        note TEXT DEFAULT '',
                        created_at TIMESTAMP DEFAULT NOW()
                    )
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at)")
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "waitlist" not in tables:
            conn.execute("""
                CREATE TABLE waitlist (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    email TEXT UNIQUE NOT NULL,
                    name TEXT DEFAULT '',
                    note TEXT DEFAULT '',
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at)")
        conn.commit()


# ── Waitlist ─────────────────────────────────────────────────────


def add_to_waitlist(email: str, name: str = "", note: str = "") -> dict | None:
    """Add an email to the waitlist. Returns the row or None if duplicate."""
    try:
        return _exec_insert_returning(
            "INSERT INTO waitlist (email, name, note) VALUES (?, ?, ?)",
            "INSERT INTO waitlist (email, name, note) VALUES (%s, %s, %s) RETURNING *",
            (email.lower().strip(), name.strip(), note.strip()),
        )
    except Exception:
        # Duplicate email — ignore
        return None


def list_waitlist() -> list[dict]:
    """List all waitlist entries, newest first."""
    return _exec(
        "SELECT * FROM waitlist ORDER BY created_at DESC",
        "SELECT * FROM waitlist ORDER BY created_at DESC",
    )


def delete_waitlist_entry(entry_id: int) -> None:
    """Remove a waitlist entry by ID."""
    _exec_modify(
        "DELETE FROM waitlist WHERE id=?",
        "DELETE FROM waitlist WHERE id=%s",
        (entry_id,),
    )


def _migrate_llm_usage_source():
    """Add source column to llm_usage if missing (for existing deployments)."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    DO $$ BEGIN
                        ALTER TABLE llm_usage ADD COLUMN source TEXT DEFAULT 'user';
                    EXCEPTION WHEN duplicate_column THEN NULL;
                    END $$
                """)
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        cols = [row[1] for row in conn.execute("PRAGMA table_info(llm_usage)").fetchall()]
        if "source" not in cols:
            conn.execute("ALTER TABLE llm_usage ADD COLUMN source TEXT DEFAULT 'user'")
            conn.commit()


def get_earliest_usage_date() -> str | None:
    """Return the earliest date in llm_usage, or None if table is empty."""
    return _exec_scalar(
        "SELECT MIN(date(created_at)) FROM llm_usage",
        "SELECT MIN(created_at::date)::TEXT FROM llm_usage",
    )


def _upsert_metric(date: str, metric_type: str, dimension: str,
                    count_val: int = 0, sum_val: float = 0,
                    avg_val: float = 0, p95_val: float = 0,
                    min_val: float = 0, max_val: float = 0):
    """Upsert a single row into metrics_daily."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO metrics_daily
                        (date, metric_type, dimension, count, sum_value,
                         avg_value, p95_value, min_value, max_value, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (date, metric_type, dimension)
                    DO UPDATE SET
                        count = EXCLUDED.count,
                        sum_value = EXCLUDED.sum_value,
                        avg_value = EXCLUDED.avg_value,
                        p95_value = EXCLUDED.p95_value,
                        min_value = EXCLUDED.min_value,
                        max_value = EXCLUDED.max_value,
                        updated_at = NOW()
                """, (date, metric_type, dimension, count_val, sum_val,
                      avg_val, p95_val, min_val, max_val))
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        conn.execute("""
            INSERT OR REPLACE INTO metrics_daily
                (date, metric_type, dimension, count, sum_value,
                 avg_value, p95_value, min_value, max_value, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (date, metric_type, dimension, count_val, sum_val,
              avg_val, p95_val, min_val, max_val))
        conn.commit()


def rollup_daily_metrics(target_date: str) -> int:
    """Aggregate raw llm_usage + usage_tracking into metrics_daily for a given date.

    target_date: 'YYYY-MM-DD' string.
    Returns total number of rows upserted.
    """
    count = 0

    # ── 1. Token/cost aggregation by role ──
    if _is_pg():
        rows = _exec(
            "",
            """SELECT role,
                      COUNT(*) AS cnt,
                      SUM(total_tokens) AS sum_tokens,
                      AVG(total_tokens) AS avg_tokens,
                      MIN(total_tokens) AS min_tokens,
                      MAX(total_tokens) AS max_tokens,
                      SUM(cost_usd) AS sum_cost
               FROM llm_usage
               WHERE created_at::date = %s
               GROUP BY role""",
            (target_date,),
        )
    else:
        rows = _exec(
            """SELECT role,
                      COUNT(*) AS cnt,
                      SUM(total_tokens) AS sum_tokens,
                      AVG(total_tokens) AS avg_tokens,
                      MIN(total_tokens) AS min_tokens,
                      MAX(total_tokens) AS max_tokens,
                      SUM(cost_usd) AS sum_cost
               FROM llm_usage
               WHERE date(created_at) = ?
               GROUP BY role""",
            "",
            (target_date,),
        )
    for r in rows:
        _upsert_metric(target_date, 'tokens', r['role'],
                        count_val=r['cnt'], sum_val=r['sum_tokens'] or 0,
                        avg_val=r['avg_tokens'] or 0,
                        min_val=r['min_tokens'] or 0, max_val=r['max_tokens'] or 0)
        _upsert_metric(target_date, 'cost', r['role'],
                        count_val=r['cnt'], sum_val=r['sum_cost'] or 0)
        count += 2

    # ── 2. Token/cost total (all roles combined) ──
    if _is_pg():
        total = _exec_one(
            "",
            """SELECT COUNT(*) AS cnt,
                      SUM(total_tokens) AS sum_tokens,
                      AVG(total_tokens) AS avg_tokens,
                      MIN(total_tokens) AS min_tokens,
                      MAX(total_tokens) AS max_tokens,
                      SUM(cost_usd) AS sum_cost
               FROM llm_usage
               WHERE created_at::date = %s""",
            (target_date,),
        )
    else:
        total = _exec_one(
            """SELECT COUNT(*) AS cnt,
                      SUM(total_tokens) AS sum_tokens,
                      AVG(total_tokens) AS avg_tokens,
                      MIN(total_tokens) AS min_tokens,
                      MAX(total_tokens) AS max_tokens,
                      SUM(cost_usd) AS sum_cost
               FROM llm_usage
               WHERE date(created_at) = ?""",
            "",
            (target_date,),
        )
    if total and total['cnt']:
        _upsert_metric(target_date, 'tokens', '_total',
                        count_val=total['cnt'], sum_val=total['sum_tokens'] or 0,
                        avg_val=total['avg_tokens'] or 0,
                        min_val=total['min_tokens'] or 0, max_val=total['max_tokens'] or 0)
        _upsert_metric(target_date, 'cost', '_total',
                        count_val=total['cnt'], sum_val=total['sum_cost'] or 0)
        count += 2

    # ── 3. Latency aggregation by role ──
    if _is_pg():
        lat_rows = _exec(
            "",
            """SELECT role,
                      COUNT(*) AS cnt,
                      AVG(latency_ms) AS avg_lat,
                      MIN(latency_ms) AS min_lat,
                      MAX(latency_ms) AS max_lat,
                      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_lat
               FROM llm_usage
               WHERE created_at::date = %s AND latency_ms > 0
               GROUP BY role""",
            (target_date,),
        )
    else:
        # SQLite has no PERCENTILE_CONT; use max as p95 approximation
        lat_rows = _exec(
            """SELECT role,
                      COUNT(*) AS cnt,
                      AVG(latency_ms) AS avg_lat,
                      MIN(latency_ms) AS min_lat,
                      MAX(latency_ms) AS max_lat,
                      MAX(latency_ms) AS p95_lat
               FROM llm_usage
               WHERE date(created_at) = ? AND latency_ms > 0
               GROUP BY role""",
            "",
            (target_date,),
        )
    for r in lat_rows:
        _upsert_metric(target_date, 'latency', r['role'],
                        count_val=r['cnt'],
                        avg_val=r['avg_lat'] or 0,
                        p95_val=r['p95_lat'] or 0,
                        min_val=r['min_lat'] or 0, max_val=r['max_lat'] or 0)
        count += 1

    # ── 4. Token aggregation by model ──
    if _is_pg():
        model_rows = _exec(
            "",
            """SELECT model,
                      COUNT(*) AS cnt,
                      SUM(total_tokens) AS sum_tokens,
                      SUM(cost_usd) AS sum_cost
               FROM llm_usage
               WHERE created_at::date = %s
               GROUP BY model""",
            (target_date,),
        )
    else:
        model_rows = _exec(
            """SELECT model,
                      COUNT(*) AS cnt,
                      SUM(total_tokens) AS sum_tokens,
                      SUM(cost_usd) AS sum_cost
               FROM llm_usage
               WHERE date(created_at) = ?
               GROUP BY model""",
            "",
            (target_date,),
        )
    for r in model_rows:
        dim = f"model:{r['model']}"
        _upsert_metric(target_date, 'tokens', dim,
                        count_val=r['cnt'], sum_val=r['sum_tokens'] or 0)
        _upsert_metric(target_date, 'cost', dim,
                        count_val=r['cnt'], sum_val=r['sum_cost'] or 0)
        count += 2

    # ── 4b. Token/cost aggregation by source (user vs background) ──
    try:
        if _is_pg():
            src_rows = _exec(
                "",
                """SELECT COALESCE(source, 'user') AS src,
                          COUNT(*) AS cnt,
                          SUM(total_tokens) AS sum_tokens,
                          SUM(cost_usd) AS sum_cost
                   FROM llm_usage
                   WHERE created_at::date = %s
                   GROUP BY COALESCE(source, 'user')""",
                (target_date,),
            )
        else:
            src_rows = _exec(
                """SELECT COALESCE(source, 'user') AS src,
                          COUNT(*) AS cnt,
                          SUM(total_tokens) AS sum_tokens,
                          SUM(cost_usd) AS sum_cost
                   FROM llm_usage
                   WHERE date(created_at) = ?
                   GROUP BY COALESCE(source, 'user')""",
                "",
                (target_date,),
            )
        for r in src_rows:
            dim = f"source:{r['src']}"
            _upsert_metric(target_date, 'tokens', dim,
                            count_val=r['cnt'], sum_val=r['sum_tokens'] or 0)
            _upsert_metric(target_date, 'cost', dim,
                            count_val=r['cnt'], sum_val=r['sum_cost'] or 0)
            count += 2
    except Exception:
        pass  # source column may not exist yet on older data

    # ── 5. Query count (total queries from llm_usage) ──
    if total and total['cnt']:
        _upsert_metric(target_date, 'queries', '_total', count_val=total['cnt'])
        count += 1

    # ── 6. DAU from usage_tracking ──
    if _is_pg():
        dau = _exec_scalar(
            "",
            """SELECT COUNT(DISTINCT session_id)
               FROM usage_tracking
               WHERE last_query_at::date = %s""",
            (target_date,),
        )
    else:
        dau = _exec_scalar(
            """SELECT COUNT(DISTINCT session_id)
               FROM usage_tracking
               WHERE date(last_query_at) = ?""",
            "",
            (target_date,),
        )
    if dau:
        _upsert_metric(target_date, 'dau', '_total', count_val=dau)
        count += 1

    # ── 7. Pipeline events aggregation (if table exists) ──
    try:
        if _is_pg():
            pe_rows = _exec(
                "",
                """SELECT event_type,
                          COUNT(*) AS cnt
                   FROM pipeline_events
                   WHERE created_at::date = %s
                   GROUP BY event_type""",
                (target_date,),
            )
        else:
            pe_rows = _exec(
                """SELECT event_type,
                          COUNT(*) AS cnt
                   FROM pipeline_events
                   WHERE date(created_at) = ?
                   GROUP BY event_type""",
                "",
                (target_date,),
            )
        for r in pe_rows:
            _upsert_metric(target_date, 'pipeline', r['event_type'],
                            count_val=r['cnt'])
            count += 1
    except Exception:
        # pipeline_events table may not exist yet
        pass

    # ── 8. Page visits by page ──
    try:
        if _is_pg():
            pv_rows = _exec(
                "",
                """SELECT page,
                          COUNT(*) AS cnt
                   FROM page_visits
                   WHERE created_at::date = %s
                   GROUP BY page""",
                (target_date,),
            )
        else:
            pv_rows = _exec(
                """SELECT page,
                          COUNT(*) AS cnt
                   FROM page_visits
                   WHERE date(created_at) = ?
                   GROUP BY page""",
                "",
                (target_date,),
            )
        for r in pv_rows:
            _upsert_metric(target_date, 'visits', r['page'], count_val=r['cnt'])
            count += 1

        # Total page views
        total_views = sum(r['cnt'] for r in pv_rows)
        if total_views:
            _upsert_metric(target_date, 'visits', '_total', count_val=total_views)
            count += 1

        # ── 9. Unique visitors (unique session_ids) ──
        if _is_pg():
            uv = _exec_scalar(
                "",
                """SELECT COUNT(DISTINCT session_id)
                   FROM page_visits
                   WHERE created_at::date = %s""",
                (target_date,),
            )
        else:
            uv = _exec_scalar(
                """SELECT COUNT(DISTINCT session_id)
                   FROM page_visits
                   WHERE date(created_at) = ?""",
                "",
                (target_date,),
            )
        if uv:
            _upsert_metric(target_date, 'unique_visitors', '_total', count_val=uv)
            count += 1

        # ── 10. Authenticated visitors (unique user_ids, non-null) ──
        if _is_pg():
            av = _exec_scalar(
                "",
                """SELECT COUNT(DISTINCT user_id)
                   FROM page_visits
                   WHERE created_at::date = %s AND user_id IS NOT NULL""",
                (target_date,),
            )
        else:
            av = _exec_scalar(
                """SELECT COUNT(DISTINCT user_id)
                   FROM page_visits
                   WHERE date(created_at) = ? AND user_id IS NOT NULL""",
                "",
                (target_date,),
            )
        if av:
            _upsert_metric(target_date, 'authenticated_visitors', '_total', count_val=av)
            count += 1
    except Exception:
        # page_visits table may not exist yet
        pass

    return count


# ── Metrics API query functions ────────────────────────────────────


def get_metrics_timeseries(metric_type: str, start_date: str, end_date: str,
                           dimension: str = "_total") -> list[dict]:
    """Return daily timeseries from metrics_daily for charting."""
    if _is_pg():
        return _exec(
            "",
            """SELECT date::TEXT, count, sum_value, avg_value, p95_value, min_value, max_value
               FROM metrics_daily
               WHERE metric_type = %s AND dimension = %s
                 AND date >= %s AND date <= %s
               ORDER BY date""",
            (metric_type, dimension, start_date, end_date),
        )
    return _exec(
        """SELECT date, count, sum_value, avg_value, p95_value, min_value, max_value
           FROM metrics_daily
           WHERE metric_type = ? AND dimension = ?
             AND date >= ? AND date <= ?
           ORDER BY date""",
        "",
        (metric_type, dimension, start_date, end_date),
    )


def get_metrics_summary(start_date: str, end_date: str) -> dict:
    """Return aggregated KPIs across a date range from metrics_daily."""
    if _is_pg():
        row = _exec_one(
            "",
            """SELECT
                  COALESCE(SUM(CASE WHEN metric_type='cost' AND dimension='_total' THEN sum_value END), 0) AS total_cost,
                  COALESCE(SUM(CASE WHEN metric_type='tokens' AND dimension='_total' THEN sum_value END), 0) AS total_tokens,
                  COALESCE(SUM(CASE WHEN metric_type='tokens' AND dimension='_total' THEN count END), 0) AS total_llm_calls,
                  COALESCE(SUM(CASE WHEN metric_type='queries' AND dimension='_total' THEN count END), 0) AS total_queries,
                  COALESCE(AVG(CASE WHEN metric_type='dau' AND dimension='_total' THEN count END), 0) AS avg_dau,
                  COALESCE(AVG(CASE WHEN metric_type='latency' AND dimension='_total' THEN avg_value END), 0) AS avg_latency
               FROM metrics_daily
               WHERE date >= %s AND date <= %s""",
            (start_date, end_date),
        )
    else:
        row = _exec_one(
            """SELECT
                  COALESCE(SUM(CASE WHEN metric_type='cost' AND dimension='_total' THEN sum_value END), 0) AS total_cost,
                  COALESCE(SUM(CASE WHEN metric_type='tokens' AND dimension='_total' THEN sum_value END), 0) AS total_tokens,
                  COALESCE(SUM(CASE WHEN metric_type='tokens' AND dimension='_total' THEN count END), 0) AS total_llm_calls,
                  COALESCE(SUM(CASE WHEN metric_type='queries' AND dimension='_total' THEN count END), 0) AS total_queries,
                  COALESCE(AVG(CASE WHEN metric_type='dau' AND dimension='_total' THEN count END), 0) AS avg_dau,
                  COALESCE(AVG(CASE WHEN metric_type='latency' AND dimension='_total' THEN avg_value END), 0) AS avg_latency
               FROM metrics_daily
               WHERE date >= ? AND date <= ?""",
            "",
            (start_date, end_date),
        )
    return row or {
        "total_cost": 0, "total_tokens": 0, "total_llm_calls": 0,
        "total_queries": 0, "avg_dau": 0, "avg_latency": 0,
    }


def get_metrics_breakdown(metric_type: str, start_date: str, end_date: str,
                          dimension_prefix: str = "") -> list[dict]:
    """Return dimension-level breakdown for a metric_type (for pie/bar charts).

    If dimension_prefix is given (e.g. 'model'), only dimensions starting with
    'model:' are returned. Otherwise, non-prefixed role dimensions are returned
    (excluding '_total' and any 'prefix:' dimensions).
    """
    if dimension_prefix:
        like_pattern = f"{dimension_prefix}:%"
        if _is_pg():
            return _exec(
                "",
                """SELECT dimension,
                          SUM(count) AS total_count,
                          SUM(sum_value) AS total_value,
                          AVG(avg_value) AS avg_value
                   FROM metrics_daily
                   WHERE metric_type = %s AND date >= %s AND date <= %s
                     AND dimension LIKE %s
                   GROUP BY dimension
                   ORDER BY total_value DESC""",
                (metric_type, start_date, end_date, like_pattern),
            )
        return _exec(
            """SELECT dimension,
                      SUM(count) AS total_count,
                      SUM(sum_value) AS total_value,
                      AVG(avg_value) AS avg_value
               FROM metrics_daily
               WHERE metric_type = ? AND date >= ? AND date <= ?
                 AND dimension LIKE ?
               GROUP BY dimension
               ORDER BY total_value DESC""",
            "",
            (metric_type, start_date, end_date, like_pattern),
        )

    # Default: role-level breakdown (exclude _total and prefixed dimensions)
    if _is_pg():
        return _exec(
            "",
            """SELECT dimension,
                      SUM(count) AS total_count,
                      SUM(sum_value) AS total_value,
                      AVG(avg_value) AS avg_value
               FROM metrics_daily
               WHERE metric_type = %s AND date >= %s AND date <= %s
                 AND dimension != '_total'
                 AND dimension NOT LIKE '%%:%%'
               GROUP BY dimension
               ORDER BY total_count DESC""",
            (metric_type, start_date, end_date),
        )
    return _exec(
        """SELECT dimension,
                  SUM(count) AS total_count,
                  SUM(sum_value) AS total_value,
                  AVG(avg_value) AS avg_value
           FROM metrics_daily
           WHERE metric_type = ? AND date >= ? AND date <= ?
             AND dimension != '_total'
             AND dimension NOT LIKE '%:%'
           GROUP BY dimension
           ORDER BY total_count DESC""",
        "",
        (metric_type, start_date, end_date),
    )


def get_pipeline_events_summary(start_date: str, end_date: str) -> dict:
    """Return pipeline event stats from pipeline_events table."""
    result = {"agent_calls": [], "tool_calls": [], "stage_durations": [], "cache_stats": []}
    try:
        if _is_pg():
            result["agent_calls"] = _exec(
                "",
                """SELECT event_name, COUNT(*) AS count
                   FROM pipeline_events
                   WHERE event_type = 'agent_selected'
                     AND created_at::date >= %s AND created_at::date <= %s
                   GROUP BY event_name ORDER BY count DESC""",
                (start_date, end_date),
            )
            result["tool_calls"] = _exec(
                "",
                """SELECT event_name,
                          COUNT(*) AS count,
                          AVG(duration_ms) AS avg_duration_ms,
                          SUM(CASE WHEN success THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0) AS success_rate
                   FROM pipeline_events
                   WHERE event_type = 'tool_call'
                     AND created_at::date >= %s AND created_at::date <= %s
                   GROUP BY event_name ORDER BY count DESC""",
                (start_date, end_date),
            )
            result["stage_durations"] = _exec(
                "",
                """SELECT event_name,
                          COUNT(*) AS count,
                          AVG(duration_ms) AS avg_duration_ms,
                          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_duration_ms,
                          MAX(duration_ms) AS max_duration_ms
                   FROM pipeline_events
                   WHERE event_type = 'pipeline_stage'
                     AND created_at::date >= %s AND created_at::date <= %s
                   GROUP BY event_name ORDER BY event_name""",
                (start_date, end_date),
            )
            result["cache_stats"] = _exec(
                "",
                """SELECT event_type, event_name, COUNT(*) AS count
                   FROM pipeline_events
                   WHERE event_type IN ('cache_hit', 'cache_miss')
                     AND created_at::date >= %s AND created_at::date <= %s
                   GROUP BY event_type, event_name ORDER BY count DESC""",
                (start_date, end_date),
            )
        else:
            result["agent_calls"] = _exec(
                """SELECT event_name, COUNT(*) AS count
                   FROM pipeline_events
                   WHERE event_type = 'agent_selected'
                     AND date(created_at) >= ? AND date(created_at) <= ?
                   GROUP BY event_name ORDER BY count DESC""",
                "",
                (start_date, end_date),
            )
            result["tool_calls"] = _exec(
                """SELECT event_name,
                          COUNT(*) AS count,
                          AVG(duration_ms) AS avg_duration_ms,
                          CAST(SUM(CASE WHEN success THEN 1 ELSE 0 END) AS FLOAT) / MAX(COUNT(*), 1) AS success_rate
                   FROM pipeline_events
                   WHERE event_type = 'tool_call'
                     AND date(created_at) >= ? AND date(created_at) <= ?
                   GROUP BY event_name ORDER BY count DESC""",
                "",
                (start_date, end_date),
            )
            result["stage_durations"] = _exec(
                """SELECT event_name,
                          COUNT(*) AS count,
                          AVG(duration_ms) AS avg_duration_ms,
                          MAX(duration_ms) AS p95_duration_ms,
                          MAX(duration_ms) AS max_duration_ms
                   FROM pipeline_events
                   WHERE event_type = 'pipeline_stage'
                     AND date(created_at) >= ? AND date(created_at) <= ?
                   GROUP BY event_name ORDER BY event_name""",
                "",
                (start_date, end_date),
            )
            result["cache_stats"] = _exec(
                """SELECT event_type, event_name, COUNT(*) AS count
                   FROM pipeline_events
                   WHERE event_type IN ('cache_hit', 'cache_miss')
                     AND date(created_at) >= ? AND date(created_at) <= ?
                   GROUP BY event_type, event_name ORDER BY count DESC""",
                "",
                (start_date, end_date),
            )
    except Exception:
        pass  # pipeline_events table may not exist yet
    return result


# ── Social Features ──────────────────────────────────────────────


def _migrate_user_handles():
    """Add handle, custom_avatar_url, bio columns to users table."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='users'")
                existing = {row[0] for row in cur.fetchall()}
                if "handle" not in existing:
                    cur.execute("ALTER TABLE users ADD COLUMN handle TEXT UNIQUE")
                if "custom_avatar_url" not in existing:
                    cur.execute("ALTER TABLE users ADD COLUMN custom_avatar_url TEXT DEFAULT ''")
                if "bio" not in existing:
                    cur.execute("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''")
                cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle ON users(handle) WHERE handle IS NOT NULL")
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        existing = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "handle" not in existing:
            conn.execute("ALTER TABLE users ADD COLUMN handle TEXT UNIQUE")
        if "custom_avatar_url" not in existing:
            conn.execute("ALTER TABLE users ADD COLUMN custom_avatar_url TEXT DEFAULT ''")
        if "bio" not in existing:
            conn.execute("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''")
        conn.commit()


def _migrate_comments():
    """Create guide_comments table and add comment_count to user_guides."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS guide_comments (
                        id SERIAL PRIMARY KEY,
                        guide_id TEXT NOT NULL,
                        user_id INTEGER NOT NULL REFERENCES users(id),
                        body TEXT NOT NULL,
                        upvote_count INTEGER NOT NULL DEFAULT 0,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        updated_at TIMESTAMPTZ DEFAULT NOW(),
                        deleted_at TIMESTAMPTZ
                    )
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_gc_guide ON guide_comments(guide_id, created_at) WHERE deleted_at IS NULL")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_gc_user ON guide_comments(user_id)")
                # Add comment_count to user_guides
                cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='user_guides'")
                ug_cols = {row[0] for row in cur.fetchall()}
                if "comment_count" not in ug_cols:
                    cur.execute("ALTER TABLE user_guides ADD COLUMN comment_count INTEGER NOT NULL DEFAULT 0")
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "guide_comments" not in tables:
            conn.execute("""
                CREATE TABLE guide_comments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guide_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    body TEXT NOT NULL,
                    upvote_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now')),
                    deleted_at TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_gc_guide ON guide_comments(guide_id, created_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_gc_user ON guide_comments(user_id)")
        ug_cols = {row[1] for row in conn.execute("PRAGMA table_info(user_guides)").fetchall()}
        if "comment_count" not in ug_cols:
            conn.execute("ALTER TABLE user_guides ADD COLUMN comment_count INTEGER NOT NULL DEFAULT 0")
        conn.commit()


def _migrate_likes():
    """Create likes table and add like_count to user_guides."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS likes (
                        user_id INTEGER NOT NULL REFERENCES users(id),
                        target_type TEXT NOT NULL,
                        target_id TEXT NOT NULL,
                        created_at TIMESTAMPTZ DEFAULT NOW(),
                        PRIMARY KEY (user_id, target_type, target_id)
                    )
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id)")
                cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='user_guides'")
                ug_cols = {row[0] for row in cur.fetchall()}
                if "like_count" not in ug_cols:
                    cur.execute("ALTER TABLE user_guides ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0")
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "likes" not in tables:
            conn.execute("""
                CREATE TABLE likes (
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    target_type TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now')),
                    PRIMARY KEY (user_id, target_type, target_id)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id)")
        ug_cols = {row[1] for row in conn.execute("PRAGMA table_info(user_guides)").fetchall()}
        if "like_count" not in ug_cols:
            conn.execute("ALTER TABLE user_guides ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0")
        conn.commit()


def _migrate_notifications():
    """Create notifications table."""
    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS notifications (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id),
                        type TEXT NOT NULL,
                        actor_id INTEGER REFERENCES users(id),
                        target_type TEXT,
                        target_id TEXT,
                        body TEXT DEFAULT '',
                        is_read BOOLEAN DEFAULT FALSE,
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    )
                """)
                cur.execute("CREATE INDEX IF NOT EXISTS idx_notif_user_unread ON notifications(user_id, is_read, created_at DESC)")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at)")
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "notifications" not in tables:
            conn.execute("""
                CREATE TABLE notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    type TEXT NOT NULL,
                    actor_id INTEGER REFERENCES users(id),
                    target_type TEXT,
                    target_id TEXT,
                    body TEXT DEFAULT '',
                    is_read INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_notif_user_unread ON notifications(user_id, is_read, created_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at)")
        conn.commit()


# ── Profile / Handle functions ───────────────────────────────────

import re as _re

_HANDLE_RE = _re.compile(r'^[a-z0-9]([a-z0-9-]{1,18}[a-z0-9])?$')

_RESERVED_HANDLES = {
    "admin", "administrator", "system", "sysadmin", "systemadmin",
    "greatneck", "great-neck", "great-neck-ai",
    "tinydesk", "tiny-desk",
    "moderator", "mod", "support", "help", "info",
    "root", "superuser", "staff", "official",
}

_GREAT_NECK_ADJECTIVES = [
    "harbor", "bayside", "parkside", "meadow", "northshore", "sunny",
    "coastal", "village", "lakeside", "creek", "maple", "cedar",
    "willow", "garden", "hilltop", "breezy", "golden", "shore",
]


def _validate_handle(handle: str) -> bool:
    """Check handle format: 3-20 chars, lowercase alphanumeric + hyphens, no leading/trailing/consecutive hyphens."""
    if not handle or len(handle) < 3 or len(handle) > 20:
        return False
    if '--' in handle:
        return False
    return bool(_HANDLE_RE.match(handle))


def check_handle_available(handle: str, exclude_user_id: int | None = None) -> bool:
    """Check if a handle is available. Optionally exclude a user (for handle changes)."""
    if not _validate_handle(handle):
        return False
    if handle.lower() in _RESERVED_HANDLES:
        # Allow if the user already owns this handle (e.g. handle change check)
        if exclude_user_id is not None:
            current = _exec_one(
                "SELECT handle FROM users WHERE id=?",
                "SELECT handle FROM users WHERE id=%s",
                (exclude_user_id,),
            )
            if current and current.get("handle") == handle.lower():
                return True
        return False
    if exclude_user_id is not None:
        row = _exec_scalar(
            "SELECT COUNT(*) FROM users WHERE handle=? AND id!=?",
            "SELECT COUNT(*) FROM users WHERE handle=%s AND id!=%s",
            (handle, exclude_user_id),
        )
    else:
        row = _exec_scalar(
            "SELECT COUNT(*) FROM users WHERE handle=?",
            "SELECT COUNT(*) FROM users WHERE handle=%s",
            (handle,),
        )
    return row == 0


def generate_handle_suggestions(name: str) -> list[str]:
    """Generate 5 unused handle suggestions based on the user's name."""
    import random
    # Clean the first name
    first = name.split()[0].lower() if name else "user"
    first = _re.sub(r'[^a-z0-9]', '', first) or "user"
    if len(first) > 12:
        first = first[:12]

    suggestions = []
    tried = set()

    # Try adjective-firstname combos
    shuffled = random.sample(_GREAT_NECK_ADJECTIVES, min(len(_GREAT_NECK_ADJECTIVES), 15))
    for adj in shuffled:
        candidate = f"{adj}-{first}"
        if len(candidate) > 20:
            continue
        if candidate in tried:
            continue
        tried.add(candidate)
        if _validate_handle(candidate) and check_handle_available(candidate):
            suggestions.append(candidate)
            if len(suggestions) >= 5:
                return suggestions

    # Fallback: name-random3digits
    for _ in range(20):
        suffix = str(random.randint(100, 999))
        candidate = f"{first}-{suffix}"
        if candidate in tried:
            continue
        tried.add(candidate)
        if _validate_handle(candidate) and check_handle_available(candidate):
            suggestions.append(candidate)
            if len(suggestions) >= 5:
                return suggestions

    return suggestions


def set_user_handle(user_id: int, handle: str) -> dict | None:
    """Set a user's handle. Returns updated user dict, or None if handle is taken."""
    if not _validate_handle(handle):
        return None
    try:
        _exec_modify(
            "UPDATE users SET handle=? WHERE id=?",
            "UPDATE users SET handle=%s WHERE id=%s",
            (handle, user_id),
        )
        return get_user_by_id(user_id)
    except Exception:
        # Unique constraint violation
        return None


def get_user_by_handle(handle: str) -> dict | None:
    """Get a user by their handle."""
    return _exec_one(
        "SELECT * FROM users WHERE handle=?",
        "SELECT * FROM users WHERE handle=%s",
        (handle,),
    )


def set_user_custom_avatar(user_id: int, url: str) -> dict | None:
    """Set a user's custom avatar URL."""
    _exec_modify(
        "UPDATE users SET custom_avatar_url=? WHERE id=?",
        "UPDATE users SET custom_avatar_url=%s WHERE id=%s",
        (url, user_id),
    )
    return get_user_by_id(user_id)


def set_user_bio(user_id: int, bio: str) -> dict | None:
    """Set a user's bio."""
    _exec_modify(
        "UPDATE users SET bio=? WHERE id=?",
        "UPDATE users SET bio=%s WHERE id=%s",
        (bio, user_id),
    )
    return get_user_by_id(user_id)


def search_users_by_handle(prefix: str, limit: int = 10) -> list[dict]:
    """Search users by handle prefix (for @mention autocomplete)."""
    prefix_like = prefix.lower() + "%"
    return _exec(
        "SELECT id, handle, name, avatar_url, custom_avatar_url FROM users WHERE handle LIKE ? AND handle IS NOT NULL ORDER BY handle LIMIT ?",
        "SELECT id, handle, name, avatar_url, custom_avatar_url FROM users WHERE handle LIKE %s AND handle IS NOT NULL ORDER BY handle LIMIT %s",
        (prefix_like, limit),
    )


# ── Comment functions ────────────────────────────────────────────


def create_comment(guide_id: str, user_id: int, body: str) -> dict:
    """Create a comment on a guide. Also increments comment_count."""
    if _is_pg():
        from psycopg2.extras import RealDictCursor
        with _PgConnWrapper() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """INSERT INTO guide_comments (guide_id, user_id, body)
                       VALUES (%s, %s, %s) RETURNING *""",
                    (guide_id, user_id, body),
                )
                comment = dict(cur.fetchone())
                cur.execute(
                    "UPDATE user_guides SET comment_count = comment_count + 1 WHERE id = %s",
                    (guide_id,),
                )
                conn.commit()
                return comment
    else:
        conn = _get_sqlite_conn()
        cur = conn.execute(
            "INSERT INTO guide_comments (guide_id, user_id, body) VALUES (?, ?, ?)",
            (guide_id, user_id, body),
        )
        comment_id = cur.lastrowid
        conn.execute(
            "UPDATE user_guides SET comment_count = comment_count + 1 WHERE id = ?",
            (guide_id,),
        )
        conn.commit()
        return dict(conn.execute("SELECT * FROM guide_comments WHERE id=?", (comment_id,)).fetchone())


def get_comments_for_guide(guide_id: str, after_id: int | None = None, limit: int = 30) -> list[dict]:
    """Get comments for a guide with user info. Cursor-based pagination."""
    cursor_clause_sq = f"AND gc.id > {int(after_id)}" if after_id else ""
    cursor_clause_pg = "AND gc.id > %s" if after_id else ""

    if _is_pg():
        from psycopg2.extras import RealDictCursor
        params = [guide_id]
        if after_id:
            params.append(int(after_id))
        params.append(limit)
        with _PgConnWrapper() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(f"""
                    SELECT gc.id, gc.guide_id, gc.user_id, gc.body, gc.upvote_count,
                           gc.created_at, gc.updated_at,
                           u.handle, u.name, u.avatar_url, u.custom_avatar_url
                    FROM guide_comments gc
                    JOIN users u ON gc.user_id = u.id
                    WHERE gc.guide_id = %s AND gc.deleted_at IS NULL
                      {cursor_clause_pg}
                    ORDER BY gc.created_at ASC
                    LIMIT %s
                """, tuple(params))
                return [dict(r) for r in cur.fetchall()]
    else:
        conn = _get_sqlite_conn()
        params = [guide_id]
        if after_id:
            params.append(int(after_id))
        params.append(limit)
        rows = conn.execute(f"""
            SELECT gc.id, gc.guide_id, gc.user_id, gc.body, gc.upvote_count,
                   gc.created_at, gc.updated_at,
                   u.handle, u.name, u.avatar_url, u.custom_avatar_url
            FROM guide_comments gc
            JOIN users u ON gc.user_id = u.id
            WHERE gc.guide_id = ? AND gc.deleted_at IS NULL
              {cursor_clause_sq}
            ORDER BY gc.created_at ASC
            LIMIT ?
        """, tuple(params)).fetchall()
        return [dict(r) for r in rows]


def delete_comment(comment_id: int, user_id: int) -> bool:
    """Soft-delete a comment. Only the author can delete. Returns True if deleted."""
    # Check ownership
    comment = _exec_one(
        "SELECT * FROM guide_comments WHERE id=? AND user_id=? AND deleted_at IS NULL",
        "SELECT * FROM guide_comments WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (comment_id, user_id),
    )
    if not comment:
        return False

    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE guide_comments SET deleted_at = NOW() WHERE id = %s", (comment_id,))
                cur.execute(
                    "UPDATE user_guides SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = %s",
                    (comment["guide_id"],),
                )
                conn.commit()
    else:
        conn = _get_sqlite_conn()
        conn.execute("UPDATE guide_comments SET deleted_at = datetime('now') WHERE id = ?", (comment_id,))
        conn.execute(
            "UPDATE user_guides SET comment_count = MAX(comment_count - 1, 0) WHERE id = ?",
            (comment["guide_id"],),
        )
        conn.commit()
    return True


# ── Like functions ───────────────────────────────────────────────


def toggle_like(user_id: int, target_type: str, target_id: str) -> dict:
    """Toggle a like. Returns {liked: bool, count: int}."""
    if target_type not in ("guide", "comment"):
        return {"liked": False, "count": 0}

    if _is_pg():
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                # Check if already liked
                cur.execute(
                    "SELECT 1 FROM likes WHERE user_id=%s AND target_type=%s AND target_id=%s",
                    (user_id, target_type, target_id),
                )
                already_liked = cur.fetchone() is not None

                if already_liked:
                    cur.execute(
                        "DELETE FROM likes WHERE user_id=%s AND target_type=%s AND target_id=%s",
                        (user_id, target_type, target_id),
                    )
                    if target_type == "guide":
                        cur.execute("UPDATE user_guides SET like_count = GREATEST(like_count - 1, 0) WHERE id = %s", (target_id,))
                    else:
                        cur.execute("UPDATE guide_comments SET upvote_count = GREATEST(upvote_count - 1, 0) WHERE id = %s", (int(target_id),))
                else:
                    cur.execute(
                        "INSERT INTO likes (user_id, target_type, target_id) VALUES (%s, %s, %s)",
                        (user_id, target_type, target_id),
                    )
                    if target_type == "guide":
                        cur.execute("UPDATE user_guides SET like_count = like_count + 1 WHERE id = %s", (target_id,))
                    else:
                        cur.execute("UPDATE guide_comments SET upvote_count = upvote_count + 1 WHERE id = %s", (int(target_id),))

                # Get updated count
                if target_type == "guide":
                    cur.execute("SELECT like_count FROM user_guides WHERE id = %s", (target_id,))
                else:
                    cur.execute("SELECT upvote_count FROM guide_comments WHERE id = %s", (int(target_id),))
                row = cur.fetchone()
                count = row[0] if row else 0
                conn.commit()
                return {"liked": not already_liked, "count": count}
    else:
        conn = _get_sqlite_conn()
        row = conn.execute(
            "SELECT 1 FROM likes WHERE user_id=? AND target_type=? AND target_id=?",
            (user_id, target_type, target_id),
        ).fetchone()
        already_liked = row is not None

        if already_liked:
            conn.execute(
                "DELETE FROM likes WHERE user_id=? AND target_type=? AND target_id=?",
                (user_id, target_type, target_id),
            )
            if target_type == "guide":
                conn.execute("UPDATE user_guides SET like_count = MAX(like_count - 1, 0) WHERE id = ?", (target_id,))
            else:
                conn.execute("UPDATE guide_comments SET upvote_count = MAX(upvote_count - 1, 0) WHERE id = ?", (int(target_id),))
        else:
            conn.execute(
                "INSERT INTO likes (user_id, target_type, target_id) VALUES (?, ?, ?)",
                (user_id, target_type, target_id),
            )
            if target_type == "guide":
                conn.execute("UPDATE user_guides SET like_count = like_count + 1 WHERE id = ?", (target_id,))
            else:
                conn.execute("UPDATE guide_comments SET upvote_count = upvote_count + 1 WHERE id = ?", (int(target_id),))

        if target_type == "guide":
            row = conn.execute("SELECT like_count FROM user_guides WHERE id = ?", (target_id,)).fetchone()
        else:
            row = conn.execute("SELECT upvote_count FROM guide_comments WHERE id = ?", (int(target_id),)).fetchone()
        count = row[0] if row else 0
        conn.commit()
        return {"liked": not already_liked, "count": count}


def get_like_status_bulk(user_id: int | None, target_type: str, target_ids: list[str]) -> dict:
    """Get like status for multiple targets. Returns {target_id: {liked: bool, count: int}}."""
    if not target_ids:
        return {}

    result = {}
    if target_type == "guide":
        # Get counts from user_guides
        if _is_pg():
            placeholders = ",".join(["%s"] * len(target_ids))
            rows = _exec(
                "",
                f"SELECT id, like_count FROM user_guides WHERE id IN ({placeholders})",
                tuple(target_ids),
            )
        else:
            placeholders = ",".join(["?"] * len(target_ids))
            rows = _exec(
                f"SELECT id, like_count FROM user_guides WHERE id IN ({placeholders})",
                "",
                tuple(target_ids),
            )
        for r in rows:
            result[r["id"]] = {"liked": False, "count": r["like_count"] or 0}
    else:
        if _is_pg():
            placeholders = ",".join(["%s"] * len(target_ids))
            rows = _exec(
                "",
                f"SELECT id, upvote_count FROM guide_comments WHERE id IN ({placeholders})",
                tuple(int(tid) for tid in target_ids),
            )
        else:
            placeholders = ",".join(["?"] * len(target_ids))
            rows = _exec(
                f"SELECT id, upvote_count FROM guide_comments WHERE id IN ({placeholders})",
                "",
                tuple(int(tid) for tid in target_ids),
            )
        for r in rows:
            result[str(r["id"])] = {"liked": False, "count": r["upvote_count"] or 0}

    # Fill in missing targets
    for tid in target_ids:
        if tid not in result:
            result[tid] = {"liked": False, "count": 0}

    # Get user's likes if authenticated
    if user_id:
        if _is_pg():
            placeholders = ",".join(["%s"] * len(target_ids))
            liked_rows = _exec(
                "",
                f"SELECT target_id FROM likes WHERE user_id=%s AND target_type=%s AND target_id IN ({placeholders})",
                (user_id, target_type, *target_ids),
            )
        else:
            placeholders = ",".join(["?"] * len(target_ids))
            liked_rows = _exec(
                f"SELECT target_id FROM likes WHERE user_id=? AND target_type=? AND target_id IN ({placeholders})",
                "",
                (user_id, target_type, *target_ids),
            )
        for r in liked_rows:
            tid = str(r["target_id"])
            if tid in result:
                result[tid]["liked"] = True

    return result


def get_liked_guide_ids(user_id):
    """Return list of guide IDs the user has liked."""
    rows = _exec(
        "SELECT target_id FROM likes WHERE user_id=? AND target_type='guide'",
        "SELECT target_id FROM likes WHERE user_id=%s AND target_type='guide'",
        (user_id,),
    )
    return [r["target_id"] for r in rows]


# ── Notification functions ───────────────────────────────────────


def create_notification(user_id: int, type: str, actor_id: int, target_type: str | None, target_id: str | None, body: str) -> dict:
    """Create a notification."""
    if _is_pg():
        from psycopg2.extras import RealDictCursor
        with _PgConnWrapper() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """INSERT INTO notifications (user_id, type, actor_id, target_type, target_id, body)
                       VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
                    (user_id, type, actor_id, target_type, target_id, body),
                )
                notif = dict(cur.fetchone())
                conn.commit()
                return notif
    else:
        conn = _get_sqlite_conn()
        cur = conn.execute(
            "INSERT INTO notifications (user_id, type, actor_id, target_type, target_id, body) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, type, actor_id, target_type, target_id, body),
        )
        conn.commit()
        return dict(conn.execute("SELECT * FROM notifications WHERE id=?", (cur.lastrowid,)).fetchone())


def get_notifications(user_id: int, after_id: int | None = None, limit: int = 30) -> list[dict]:
    """Get notifications for a user with actor info. Cursor-based pagination."""
    if _is_pg():
        from psycopg2.extras import RealDictCursor
        params = [user_id]
        cursor_clause = ""
        if after_id:
            cursor_clause = "AND n.id < %s"
            params.append(int(after_id))
        params.append(limit)
        with _PgConnWrapper() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(f"""
                    SELECT n.id, n.user_id, n.type, n.actor_id, n.target_type, n.target_id,
                           n.body, n.is_read, n.created_at,
                           u.handle AS actor_handle, u.name AS actor_name,
                           u.avatar_url AS actor_avatar_url, u.custom_avatar_url AS actor_custom_avatar_url
                    FROM notifications n
                    LEFT JOIN users u ON n.actor_id = u.id
                    WHERE n.user_id = %s {cursor_clause}
                    ORDER BY n.created_at DESC
                    LIMIT %s
                """, tuple(params))
                return [dict(r) for r in cur.fetchall()]
    else:
        conn = _get_sqlite_conn()
        params = [user_id]
        cursor_clause = ""
        if after_id:
            cursor_clause = "AND n.id < ?"
            params.append(int(after_id))
        params.append(limit)
        rows = conn.execute(f"""
            SELECT n.id, n.user_id, n.type, n.actor_id, n.target_type, n.target_id,
                   n.body, n.is_read, n.created_at,
                   u.handle AS actor_handle, u.name AS actor_name,
                   u.avatar_url AS actor_avatar_url, u.custom_avatar_url AS actor_custom_avatar_url
            FROM notifications n
            LEFT JOIN users u ON n.actor_id = u.id
            WHERE n.user_id = ? {cursor_clause}
            ORDER BY n.created_at DESC
            LIMIT ?
        """, tuple(params)).fetchall()
        return [dict(r) for r in rows]


def count_unread_notifications(user_id: int) -> int:
    """Count unread notifications for a user."""
    val = _exec_scalar(
        "SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0",
        "SELECT COUNT(*) FROM notifications WHERE user_id=%s AND is_read=FALSE",
        (user_id,),
    )
    return val or 0


def mark_notifications_read(user_id: int, ids: list[int] | None = None) -> int:
    """Mark notifications as read. If ids is None, mark all. Returns count marked."""
    if ids is None:
        if _is_pg():
            with _PgConnWrapper() as conn:
                with conn.cursor() as cur:
                    cur.execute("UPDATE notifications SET is_read=TRUE WHERE user_id=%s AND is_read=FALSE", (user_id,))
                    count = cur.rowcount
                    conn.commit()
                    return count
        else:
            conn = _get_sqlite_conn()
            cur = conn.execute("UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0", (user_id,))
            conn.commit()
            return cur.rowcount
    else:
        if not ids:
            return 0
        if _is_pg():
            placeholders = ",".join(["%s"] * len(ids))
            with _PgConnWrapper() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        f"UPDATE notifications SET is_read=TRUE WHERE user_id=%s AND id IN ({placeholders})",
                        (user_id, *ids),
                    )
                    count = cur.rowcount
                    conn.commit()
                    return count
        else:
            placeholders = ",".join(["?"] * len(ids))
            conn = _get_sqlite_conn()
            cur = conn.execute(
                f"UPDATE notifications SET is_read=1 WHERE user_id=? AND id IN ({placeholders})",
                (user_id, *ids),
            )
            conn.commit()
            return cur.rowcount


def extract_mentions(body: str) -> list[str]:
    """Extract @handles from comment body."""
    return list(set(_re.findall(r'@([a-z0-9][a-z0-9-]{1,18}[a-z0-9])', body)))


def get_realtime_metrics() -> dict:
    """Return today's partial metrics from raw tables (before rollup runs)."""
    if _is_pg():
        row = _exec_one(
            "",
            """SELECT COUNT(*) AS llm_calls,
                      COALESCE(SUM(total_tokens), 0) AS tokens,
                      COALESCE(SUM(cost_usd), 0) AS cost_usd,
                      COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
               FROM llm_usage
               WHERE created_at::date = CURRENT_DATE""",
            (),
        )
        dau = _exec_scalar(
            "",
            """SELECT COUNT(DISTINCT session_id)
               FROM usage_tracking
               WHERE last_query_at::date = CURRENT_DATE""",
            (),
        )
    else:
        row = _exec_one(
            """SELECT COUNT(*) AS llm_calls,
                      COALESCE(SUM(total_tokens), 0) AS tokens,
                      COALESCE(SUM(cost_usd), 0) AS cost_usd,
                      COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
               FROM llm_usage
               WHERE date(created_at) = date('now')""",
            "",
            (),
        )
        dau = _exec_scalar(
            """SELECT COUNT(DISTINCT session_id)
               FROM usage_tracking
               WHERE date(last_query_at) = date('now')""",
            "",
            (),
        )
    return {
        "llm_calls": row["llm_calls"] if row else 0,
        "tokens": row["tokens"] if row else 0,
        "cost_usd": round(row["cost_usd"], 4) if row else 0,
        "avg_latency_ms": round(row["avg_latency_ms"], 1) if row else 0,
        "dau": dau or 0,
    }
