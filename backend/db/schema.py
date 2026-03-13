"""Database schema creation and migrations (PostgreSQL only)."""
from __future__ import annotations

from db.connection import _PgConnWrapper, _exec_modify

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


def _migrate_events_zh():
    """Add _zh translation columns to events table if missing."""
    zh_cols = ["title_zh", "description_zh", "venue_zh"]
    with _PgConnWrapper() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='events'")
            existing = {row[0] for row in cur.fetchall()}
            for col in zh_cols:
                if col not in existing:
                    cur.execute(f"ALTER TABLE events ADD COLUMN {col} TEXT")
            conn.commit()


def _migrate_apple_id():
    """Add apple_id column and make google_id nullable."""
    with _PgConnWrapper() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='users'")
            existing = {row[0] for row in cur.fetchall()}
            if "apple_id" not in existing:
                cur.execute("ALTER TABLE users ADD COLUMN apple_id TEXT UNIQUE")
            cur.execute("""
                SELECT is_nullable FROM information_schema.columns
                WHERE table_name='users' AND column_name='google_id'
            """)
            row = cur.fetchone()
            if row and row[0] == "NO":
                cur.execute("ALTER TABLE users ALTER COLUMN google_id DROP NOT NULL")
            conn.commit()


def _migrate_invites():
    """Add invites table and is_invited column to users if missing."""
    with _PgConnWrapper() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='users'")
            existing = {row[0] for row in cur.fetchall()}
            if "is_invited" not in existing:
                cur.execute("ALTER TABLE users ADD COLUMN is_invited BOOLEAN NOT NULL DEFAULT FALSE")
                cur.execute("UPDATE users SET is_invited = TRUE")
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


def _migrate_guides():
    """Add guide_saves and guide_step_status tables if missing."""
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


def _migrate_user_guides():
    """Add user_guides table if missing."""
    try:
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
    except Exception:
        import logging
        logging.getLogger(__name__).exception("_migrate_user_guides failed")


def _migrate_publish_snapshot():
    """Add is_snapshot and published_copy_id columns to user_guides."""
    try:
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='user_guides'")
                cols = {row[0] for row in cur.fetchall()}
                if "is_snapshot" not in cols:
                    cur.execute("ALTER TABLE user_guides ADD COLUMN is_snapshot BOOLEAN DEFAULT FALSE")
                if "published_copy_id" not in cols:
                    cur.execute("ALTER TABLE user_guides ADD COLUMN published_copy_id TEXT")
                conn.commit()
    except Exception:
        import logging
        logging.getLogger(__name__).exception("_migrate_publish_snapshot failed")


def _migrate_metrics_daily():
    """Add metrics_daily table if missing (for existing deployments)."""
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


def _migrate_page_visits():
    """Add page_visits table if missing (for existing deployments)."""
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


def _migrate_waitlist():
    """Add waitlist table if missing (for existing deployments)."""
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


def _migrate_llm_usage_source():
    """Add source column to llm_usage if missing (for existing deployments)."""
    with _PgConnWrapper() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                DO $$ BEGIN
                    ALTER TABLE llm_usage ADD COLUMN source TEXT DEFAULT 'user';
                EXCEPTION WHEN duplicate_column THEN NULL;
                END $$
            """)
            conn.commit()


def _migrate_user_handles():
    """Add handle, custom_avatar_url, bio columns to users table."""
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


def _migrate_comments():
    """Create guide_comments table and add comment_count to user_guides."""
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
            cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='user_guides'")
            ug_cols = {row[0] for row in cur.fetchall()}
            if "comment_count" not in ug_cols:
                cur.execute("ALTER TABLE user_guides ADD COLUMN comment_count INTEGER NOT NULL DEFAULT 0")
            conn.commit()


def _migrate_likes():
    """Create likes table and add like_count to user_guides."""
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


def _migrate_notifications():
    """Create notifications table."""
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


def _migrate_reminder_sent():
    """Add reminder_sent column to guide_step_status."""
    with _PgConnWrapper() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                DO $$ BEGIN
                    ALTER TABLE guide_step_status ADD COLUMN reminder_sent BOOLEAN DEFAULT FALSE;
                EXCEPTION WHEN duplicate_column THEN NULL;
                END $$
            """)
            conn.commit()


def init_db():
    """Create tables if they don't exist."""
    with _PgConnWrapper() as conn:
        with conn.cursor() as cur:
            cur.execute(_PG_SCHEMA)
            conn.commit()
    _migrate_events_zh()
    _migrate_apple_id()
    _migrate_invites()
    _migrate_guides()
    _migrate_user_guides()
    _migrate_publish_snapshot()
    _migrate_metrics_daily()
    _migrate_page_visits()
    _migrate_waitlist()
    _migrate_llm_usage_source()
    _migrate_user_handles()
    _migrate_comments()
    _migrate_likes()
    _migrate_notifications()
    _migrate_reminder_sent()
