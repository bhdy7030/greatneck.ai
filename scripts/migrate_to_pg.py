#!/usr/bin/env python3
"""One-time migration: SQLite → PostgreSQL.

Usage:
    python scripts/migrate_to_pg.py [--sqlite-path PATH] [--pg-url URL]

Defaults:
    --sqlite-path  backend/data/askmura.db  (or KNOWLEDGE_DIR/askmura.db)
    --pg-url       $DATABASE_URL env var

This script:
1. Reads all rows from each SQLite table
2. Inserts them into the PostgreSQL database (batch inserts)
3. Resets SERIAL sequences to max(id)+1
4. Verifies row counts match
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values


# Columns that are INTEGER in SQLite but BOOLEAN in PostgreSQL
BOOL_COLUMNS = {
    "users": {"is_admin", "can_debug"},
    "usage_tracking": {"extended_trial"},
    "refresh_tokens": {"revoked"},
}

TABLES_WITH_SERIAL = {
    "users": "id",
    "messages": "id",
    "events": "id",
    "usage_tracking": "id",
}

# Order matters for foreign key constraints
TABLE_ORDER = [
    "users",
    "conversations",
    "messages",
    "events",
    "usage_tracking",
    "refresh_tokens",
]


def get_sqlite_conn(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def get_columns(sqlite_conn: sqlite3.Connection, table: str) -> list[str]:
    rows = sqlite_conn.execute(f"PRAGMA table_info({table})").fetchall()
    return [r["name"] for r in rows]


def migrate_table(
    sqlite_conn: sqlite3.Connection,
    pg_conn,
    table: str,
) -> int:
    """Migrate a single table. Returns row count."""
    columns = get_columns(sqlite_conn, table)
    rows = sqlite_conn.execute(f"SELECT * FROM {table}").fetchall()

    if not rows:
        print(f"  {table}: 0 rows (empty)")
        return 0

    col_list = ", ".join(columns)
    placeholders = ", ".join(["%s"] * len(columns))

    # Convert sqlite3.Row to tuple of values, casting int→bool where needed
    bool_cols = BOOL_COLUMNS.get(table, set())
    def _cast(col_name, val):
        if col_name in bool_cols:
            return bool(val) if val is not None else False
        return val
    values = [tuple(_cast(c, dict(r)[c]) for c in columns) for r in rows]

    with pg_conn.cursor() as cur:
        # Use execute_values for batch performance
        template = f"({placeholders})"
        insert_sql = f"INSERT INTO {table} ({col_list}) VALUES %s ON CONFLICT DO NOTHING"
        execute_values(cur, insert_sql, values, template=template, page_size=500)

    pg_conn.commit()
    count = len(values)
    print(f"  {table}: {count} rows migrated")
    return count


def reset_sequences(pg_conn, sqlite_conn: sqlite3.Connection):
    """Reset SERIAL sequences to max(id)+1."""
    with pg_conn.cursor() as cur:
        for table, col in TABLES_WITH_SERIAL.items():
            # Check if table has rows
            cur.execute(f"SELECT MAX({col}) FROM {table}")
            max_id = cur.fetchone()[0]
            if max_id is not None:
                seq_name = f"{table}_{col}_seq"
                cur.execute(f"SELECT setval('{seq_name}', {max_id})")
                print(f"  {seq_name} → {max_id}")
    pg_conn.commit()


def verify_counts(sqlite_conn: sqlite3.Connection, pg_conn):
    """Verify row counts match between SQLite and PostgreSQL."""
    print("\n── Verification ──")
    all_ok = True
    for table in TABLE_ORDER:
        sqlite_count = sqlite_conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        with pg_conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            pg_count = cur.fetchone()[0]
        status = "OK" if sqlite_count == pg_count else "MISMATCH"
        if status == "MISMATCH":
            all_ok = False
        print(f"  {table}: SQLite={sqlite_count} PG={pg_count} [{status}]")
    return all_ok


def main():
    parser = argparse.ArgumentParser(description="Migrate SQLite to PostgreSQL")
    parser.add_argument(
        "--sqlite-path",
        default=None,
        help="Path to SQLite database file",
    )
    parser.add_argument(
        "--pg-url",
        default=None,
        help="PostgreSQL connection URL (default: $DATABASE_URL)",
    )
    args = parser.parse_args()

    # Determine SQLite path
    sqlite_path = args.sqlite_path
    if not sqlite_path:
        knowledge_dir = os.environ.get("KNOWLEDGE_DIR")
        if knowledge_dir:
            sqlite_path = os.path.join(knowledge_dir, "askmura.db")
        else:
            sqlite_path = os.path.join(
                os.path.dirname(__file__), "..", "backend", "data", "askmura.db"
            )

    if not Path(sqlite_path).exists():
        print(f"ERROR: SQLite file not found: {sqlite_path}")
        sys.exit(1)

    # Determine PostgreSQL URL
    pg_url = args.pg_url or os.environ.get("DATABASE_URL")
    if not pg_url:
        print("ERROR: No PostgreSQL URL. Set DATABASE_URL or use --pg-url")
        sys.exit(1)

    print(f"SQLite: {sqlite_path}")
    print(f"PostgreSQL: {pg_url.split('@')[0]}@***")  # hide password
    print()

    sqlite_conn = get_sqlite_conn(sqlite_path)
    pg_conn = psycopg2.connect(pg_url)

    # Ensure PG schema exists (import and run init_db equivalent)
    print("── Creating PostgreSQL schema ──")
    # Read the PG schema from db.py
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
    from db import _PG_SCHEMA
    with pg_conn.cursor() as cur:
        cur.execute(_PG_SCHEMA)
    pg_conn.commit()
    print("  Schema created/verified")

    print("\n── Migrating tables ──")
    for table in TABLE_ORDER:
        try:
            migrate_table(sqlite_conn, pg_conn, table)
        except Exception as e:
            print(f"  ERROR migrating {table}: {e}")
            pg_conn.rollback()

    print("\n── Resetting sequences ──")
    reset_sequences(pg_conn, sqlite_conn)

    all_ok = verify_counts(sqlite_conn, pg_conn)

    sqlite_conn.close()
    pg_conn.close()

    if all_ok:
        print("\nMigration complete — all counts match!")
    else:
        print("\nWARNING: Some counts don't match. Check for conflicts or errors above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
