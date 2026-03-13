"""Guide saves/unsaves, step statuses, reminders, user guides (create/update/delete/fork/publish)."""
from __future__ import annotations

import json
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from db.connection import _exec, _exec_one, _exec_modify, _PgConnWrapper

_ET = ZoneInfo("America/New_York")


# ── Guide saves ──────────────────────────────────────────────────

def get_saved_guide_ids(user_id: int | None, session_id: str | None) -> list[str]:
    """Return list of guide_ids saved by the user/session."""
    if user_id:
        rows = _exec(
            "SELECT guide_id FROM guide_saves WHERE user_id=%s",
            (user_id,),
        )
    elif session_id:
        rows = _exec(
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
            "INSERT INTO guide_saves (user_id, guide_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (user_id, guide_id),
        )
    elif session_id:
        _exec_modify(
            "INSERT INTO guide_saves (session_id, guide_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (session_id, guide_id),
        )


def unsave_guide(user_id: int | None, session_id: str | None, guide_id: str):
    """Remove a guide from the user's wallet."""
    if user_id:
        _exec_modify(
            "DELETE FROM guide_saves WHERE user_id=%s AND guide_id=%s",
            (user_id, guide_id),
        )
    elif session_id:
        _exec_modify(
            "DELETE FROM guide_saves WHERE session_id=%s AND guide_id=%s",
            (session_id, guide_id),
        )


# ── Step statuses ────────────────────────────────────────────────

def get_step_statuses(user_id: int | None, session_id: str | None, guide_id: str) -> list[dict]:
    """Return all step status rows for a guide."""
    if user_id:
        return _exec(
            "SELECT step_id, status, remind_at, note, updated_at FROM guide_step_status WHERE user_id=%s AND guide_id=%s",
            (user_id, guide_id),
        )
    elif session_id:
        return _exec(
            "SELECT step_id, status, remind_at, note, updated_at FROM guide_step_status WHERE session_id=%s AND guide_id=%s",
            (session_id, guide_id),
        )
    return []


def get_all_step_statuses(user_id: int | None, session_id: str | None) -> list[dict]:
    """Return all step statuses across all guides."""
    if user_id:
        return _exec(
            "SELECT guide_id, step_id, status, remind_at, note, updated_at FROM guide_step_status WHERE user_id=%s",
            (user_id,),
        )
    elif session_id:
        return _exec(
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
            "SELECT guide_id, step_id, status, remind_at, note FROM guide_step_status WHERE user_id=%s AND remind_at IS NOT NULL AND remind_at<=%s",
            (user_id, now),
        )
    elif session_id:
        return _exec(
            "SELECT guide_id, step_id, status, remind_at, note FROM guide_step_status WHERE session_id=%s AND remind_at IS NOT NULL AND remind_at<=%s",
            (session_id, now),
        )
    return []


def process_due_reminders() -> int:
    """Find due reminders (remind_at <= now, not yet sent), create notifications, mark sent. Returns count."""
    from db.social import create_notification
    now = datetime.now(_ET).isoformat()
    from psycopg2.extras import RealDictCursor
    with _PgConnWrapper() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """SELECT gss.id, gss.user_id, gss.guide_id, gss.step_id
                   FROM guide_step_status gss
                   WHERE gss.remind_at IS NOT NULL
                     AND gss.remind_at <= %s
                     AND (gss.reminder_sent = FALSE OR gss.reminder_sent IS NULL)
                     AND gss.user_id IS NOT NULL""",
                (now,),
            )
            rows = [dict(r) for r in cur.fetchall()]
            if not rows:
                return 0
            for row in rows:
                step_title = row["step_id"]
                cur.execute(
                    "SELECT guide_data FROM user_guides WHERE id=%s",
                    (row["guide_id"],),
                )
                guide_row = cur.fetchone()
                if guide_row:
                    gd = guide_row["guide_data"]
                    if isinstance(gd, str):
                        gd = json.loads(gd)
                    for s in gd.get("steps", []):
                        if s.get("id") == row["step_id"]:
                            raw_st = s.get("title", row["step_id"])
                            step_title = raw_st.get("en", str(raw_st)) if isinstance(raw_st, dict) else str(raw_st)
                            break
                create_notification(
                    row["user_id"], "reminder", row["user_id"],
                    "guide", row["guide_id"],
                    f"Reminder: {step_title}",
                )
            ids = [r["id"] for r in rows]
            cur.execute(
                "UPDATE guide_step_status SET reminder_sent = TRUE WHERE id = ANY(%s)",
                (ids,),
            )
            conn.commit()
            return len(rows)


def get_pending_reminders(user_id: int | None, session_id: str | None) -> list[dict]:
    """Return all steps with a remind_at set (pending reminders, future or past unsent)."""
    if user_id:
        rows = _exec(
            """SELECT gss.guide_id, gss.step_id, gss.status, gss.remind_at, gss.note, gss.reminder_sent,
                      ug.guide_data
               FROM guide_step_status gss
               LEFT JOIN user_guides ug ON ug.id = gss.guide_id
               WHERE gss.user_id=%s AND gss.remind_at IS NOT NULL
               ORDER BY gss.remind_at ASC""",
            (user_id,),
        )
    elif session_id:
        rows = _exec(
            """SELECT gss.guide_id, gss.step_id, gss.status, gss.remind_at, gss.note, gss.reminder_sent,
                      ug.guide_data
               FROM guide_step_status gss
               LEFT JOIN user_guides ug ON ug.id = gss.guide_id
               WHERE gss.session_id=%s AND gss.remind_at IS NOT NULL
               ORDER BY gss.remind_at ASC""",
            (session_id,),
        )
    else:
        return []
    result = []
    for row in rows:
        gd = row.get("guide_data")
        if isinstance(gd, str):
            gd = json.loads(gd)
        raw_title = gd.get("title", row["guide_id"]) if gd else row["guide_id"]
        guide_title = raw_title.get("en", str(raw_title)) if isinstance(raw_title, dict) else str(raw_title)
        step_title = row["step_id"]
        if gd:
            for s in gd.get("steps", []):
                if s.get("id") == row["step_id"]:
                    raw_st = s.get("title", row["step_id"])
                    step_title = raw_st.get("en", str(raw_st)) if isinstance(raw_st, dict) else str(raw_st)
                    break
        result.append({
            "guide_id": row["guide_id"],
            "step_id": row["step_id"],
            "status": row["status"],
            "remind_at": row["remind_at"],
            "note": row["note"],
            "reminder_sent": bool(row.get("reminder_sent")),
            "guide_title": guide_title,
            "step_title": step_title,
        })
    return result


def clear_step_reminder(user_id: int | None, session_id: str | None, guide_id: str, step_id: str):
    """Clear remind_at and reset reminder_sent for a step."""
    if user_id:
        _exec_modify(
            "UPDATE guide_step_status SET remind_at=NULL, reminder_sent=FALSE WHERE user_id=%s AND guide_id=%s AND step_id=%s",
            (user_id, guide_id, step_id),
        )
    elif session_id:
        _exec_modify(
            "UPDATE guide_step_status SET remind_at=NULL, reminder_sent=FALSE WHERE session_id=%s AND guide_id=%s AND step_id=%s",
            (session_id, guide_id, step_id),
        )


def migrate_guide_data(session_id: str, user_id: int):
    """Move anonymous guide data to authenticated user on sign-in."""
    _exec_modify(
        """UPDATE guide_saves SET user_id=%s, session_id=NULL
           WHERE session_id=%s AND guide_id NOT IN (SELECT guide_id FROM guide_saves WHERE user_id=%s)""",
        (user_id, session_id, user_id),
    )
    _exec_modify(
        "DELETE FROM guide_saves WHERE session_id=%s",
        (session_id,),
    )
    _exec_modify(
        """UPDATE guide_step_status SET user_id=%s, session_id=NULL
           WHERE session_id=%s AND (guide_id, step_id) NOT IN
             (SELECT guide_id, step_id FROM guide_step_status WHERE user_id=%s)""",
        (user_id, session_id, user_id),
    )
    _exec_modify(
        "DELETE FROM guide_step_status WHERE session_id=%s",
        (session_id,),
    )


# ── User Guides (custom playbooks) ──────────────────────────────


def create_user_guide(user_id, session_id, guide_data, source_guide_id=None):
    """Create a new user guide. Returns the guide id."""
    guide_id = f"ug-{uuid.uuid4()}"
    guide_json = json.dumps(guide_data) if isinstance(guide_data, dict) else guide_data
    _exec_modify(
        "INSERT INTO user_guides (id, user_id, session_id, guide_data, source_guide_id) VALUES (%s, %s, %s, %s, %s)",
        (guide_id, user_id, session_id, guide_json, source_guide_id),
    )
    return guide_id


def get_user_guide(guide_id):
    """Get a single user guide by ID, with author_handle."""
    row = _exec_one(
        "SELECT ug.*, u.handle AS author_handle FROM user_guides ug LEFT JOIN users u ON ug.user_id = u.id WHERE ug.id=%s",
        (guide_id,),
    )
    if row and isinstance(row.get("guide_data"), str):
        row["guide_data"] = json.loads(row["guide_data"])
    return row


def get_user_snapshots(user_id):
    """Get all published snapshot copies owned by a user."""
    if not user_id:
        return []
    rows = _exec(
        "SELECT * FROM user_guides WHERE user_id=%s AND is_snapshot = TRUE ORDER BY updated_at DESC",
        (user_id,),
    )
    for r in rows:
        if isinstance(r.get("guide_data"), str):
            r["guide_data"] = json.loads(r["guide_data"])
    return rows


def get_user_guides_for_owner(user_id=None, session_id=None):
    """Get all guides owned by a user or session (excludes snapshot copies)."""
    if user_id:
        rows = _exec(
            "SELECT * FROM user_guides WHERE user_id=%s AND (is_snapshot = FALSE OR is_snapshot IS NULL) ORDER BY updated_at DESC",
            (user_id,),
        )
    elif session_id:
        rows = _exec(
            "SELECT * FROM user_guides WHERE session_id=%s AND user_id IS NULL AND (is_snapshot = FALSE OR is_snapshot IS NULL) ORDER BY updated_at DESC",
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
            "UPDATE user_guides SET guide_data=%s, updated_at=NOW(), is_draft=FALSE WHERE id=%s AND user_id=%s",
            (guide_json, guide_id, user_id),
        )
    elif session_id:
        _exec_modify(
            "UPDATE user_guides SET guide_data=%s, updated_at=NOW(), is_draft=FALSE WHERE id=%s AND session_id=%s AND user_id IS NULL",
            (guide_json, guide_id, session_id),
        )
    else:
        return False
    return True


def delete_user_guide(guide_id, user_id=None, session_id=None):
    """Delete an owned guide and cleanup related saves/step_status. Also deletes snapshot if present."""
    original = get_user_guide(guide_id)
    if original:
        snapshot_id = original.get("published_copy_id")
        if snapshot_id:
            _exec_modify(
                "DELETE FROM user_guides WHERE id=%s",
                (snapshot_id,),
            )
    if user_id:
        _exec_modify(
            "DELETE FROM user_guides WHERE id=%s AND user_id=%s",
            (guide_id, user_id),
        )
        _exec_modify(
            "DELETE FROM guide_saves WHERE guide_id=%s AND user_id=%s",
            (guide_id, user_id),
        )
        _exec_modify(
            "DELETE FROM guide_step_status WHERE guide_id=%s AND user_id=%s",
            (guide_id, user_id),
        )
    elif session_id:
        _exec_modify(
            "DELETE FROM user_guides WHERE id=%s AND session_id=%s AND user_id IS NULL",
            (guide_id, session_id),
        )
        _exec_modify(
            "DELETE FROM guide_saves WHERE guide_id=%s AND session_id=%s",
            (guide_id, session_id),
        )
        _exec_modify(
            "DELETE FROM guide_step_status WHERE guide_id=%s AND session_id=%s",
            (guide_id, session_id),
        )


def set_user_guide_published(guide_id, user_id, is_published):
    """Publish or unpublish a guide via snapshot copy. Requires user_id."""
    if is_published:
        original = get_user_guide(guide_id)
        if not original or original.get("user_id") != user_id:
            return
        guide_json = json.dumps(original["guide_data"]) if isinstance(original["guide_data"], dict) else original["guide_data"]
        snapshot_id = f"ug-{uuid.uuid4()}"
        _exec_modify(
            "INSERT INTO user_guides (id, user_id, guide_data, source_guide_id, is_published, is_draft, is_snapshot) VALUES (%s, %s, %s, %s, TRUE, FALSE, TRUE)",
            (snapshot_id, user_id, guide_json, guide_id),
        )
        _exec_modify(
            "UPDATE user_guides SET published_copy_id=%s, is_published=FALSE, is_draft=FALSE, updated_at=NOW() WHERE id=%s AND user_id=%s",
            (snapshot_id, guide_id, user_id),
        )
    else:
        original = get_user_guide(guide_id)
        if not original or original.get("user_id") != user_id:
            return
        snapshot_id = original.get("published_copy_id")
        if snapshot_id:
            _exec_modify(
                "DELETE FROM user_guides WHERE id=%s",
                (snapshot_id,),
            )
        _exec_modify(
            "UPDATE user_guides SET published_copy_id=NULL, updated_at=NOW() WHERE id=%s AND user_id=%s",
            (guide_id, user_id),
        )


def update_published_copy(guide_id, user_id):
    """Copy current guide_data from original to its published snapshot."""
    original = get_user_guide(guide_id)
    if not original or original.get("user_id") != user_id:
        return False
    snapshot_id = original.get("published_copy_id")
    if not snapshot_id:
        return False
    guide_json = json.dumps(original["guide_data"]) if isinstance(original["guide_data"], dict) else original["guide_data"]
    _exec_modify(
        "UPDATE user_guides SET guide_data=%s, updated_at=NOW() WHERE id=%s",
        (guide_json, snapshot_id),
    )
    return True


def get_published_user_guides():
    """Get all published user guides for the catalog, with author_handle."""
    rows = _exec(
        "SELECT ug.*, u.handle AS author_handle FROM user_guides ug LEFT JOIN users u ON ug.user_id = u.id WHERE ug.is_published=TRUE",
    )
    for r in rows:
        if isinstance(r.get("guide_data"), str):
            r["guide_data"] = json.loads(r["guide_data"])
    return rows


def upsert_user_guide(guide_id, user_id, guide_data, is_published=False):
    """INSERT or UPDATE a user_guide by id. Uses guide_id as-is (no ug- prefix forced)."""
    guide_json = json.dumps(guide_data) if isinstance(guide_data, dict) else guide_data
    existing = get_user_guide(guide_id)
    if existing:
        _exec_modify(
            "UPDATE user_guides SET user_id=%s, guide_data=%s, is_published=%s, is_draft=FALSE, updated_at=NOW() WHERE id=%s",
            (user_id, guide_json, is_published, guide_id),
        )
    else:
        _exec_modify(
            "INSERT INTO user_guides (id, user_id, session_id, guide_data, is_published, is_draft) VALUES (%s, %s, NULL, %s, %s, FALSE)",
            (guide_id, user_id, guide_json, is_published),
        )


def ingest_yaml_guides():
    """Ingest all YAML catalog guides as @admin user_guides. Idempotent via upsert."""
    import logging
    logger = logging.getLogger(__name__)
    from knowledge.guides_registry import get_all_guides
    from db.users import ensure_system_user
    admin_id = ensure_system_user("tinydesk", "Tiny Desk")
    guides = get_all_guides()
    for g in guides:
        upsert_user_guide(g["id"], admin_id, g, is_published=True)
    logger.info(f"Ingested {len(guides)} YAML guides as @tinydesk user_guides")


def migrate_user_guide_data(session_id, user_id):
    """Move anonymous guides to a logged-in user on sign-in."""
    _exec_modify(
        "UPDATE user_guides SET user_id=%s, session_id=NULL WHERE session_id=%s AND user_id IS NULL",
        (user_id, session_id),
    )
