"""PostgreSQL connection pool, wrappers, and execution helpers."""
from __future__ import annotations

import os as _os
import threading

_DATABASE_URL = _os.environ.get("DATABASE_URL", "")

# ── PostgreSQL pool ──────────────────────────────────────────────
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
    return True


# ── Connection helpers ───────────────────────────────────────────

# Thread-local dedicated connection for background tasks (rollup, backfill).
_bg_conn: threading.local = threading.local()


class _BgConnContext:
    """Context manager: opens a dedicated PG connection for background work.

    While active (on the current thread), all _PgConnWrapper calls will reuse
    this single connection instead of hitting the shared pool.
    """
    def __init__(self):
        self._conn = None

    def __enter__(self):
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
        bg = getattr(_bg_conn, 'conn', None)
        if bg is not None:
            self.conn = bg
            self._from_pool = False
            return self.conn
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


def _get_pg_conn():
    """Return a _PgConnWrapper context manager."""
    return _PgConnWrapper()


def _dict_row(cur, row_or_none):
    """Convert a single row to dict."""
    if row_or_none is None:
        return None
    return dict(row_or_none)


# ── Execution helpers ────────────────────────────────────────────

def _exec(sql: str, params: tuple = ()) -> list[dict]:
    """Execute a query and return all rows as list of dicts."""
    from psycopg2.extras import RealDictCursor
    with _PgConnWrapper() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            if cur.description:
                return [dict(r) for r in cur.fetchall()]
            conn.commit()
            return []


def _exec_one(sql: str, params: tuple = ()) -> dict | None:
    """Execute a query and return a single row as dict or None."""
    from psycopg2.extras import RealDictCursor
    with _PgConnWrapper() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return dict(row) if row else None


def _exec_modify(sql: str, params: tuple = ()) -> None:
    """Execute an INSERT/UPDATE/DELETE."""
    with _PgConnWrapper() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            conn.commit()


def _exec_insert_returning(sql: str, params: tuple = ()) -> dict | None:
    """INSERT with RETURNING."""
    from psycopg2.extras import RealDictCursor
    with _PgConnWrapper() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            conn.commit()
            return dict(row) if row else None


def _exec_scalar(sql: str, params: tuple = ()):
    """Execute and return a single scalar value."""
    with _PgConnWrapper() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            return row[0] if row else None
