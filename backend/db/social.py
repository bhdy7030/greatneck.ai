"""Comments, likes, notifications, mentions."""
from __future__ import annotations

import re as _re

from db.connection import _exec, _exec_one, _exec_modify, _exec_scalar, _PgConnWrapper


# ── Comment functions ────────────────────────────────────────────


def create_comment(guide_id: str, user_id: int, body: str) -> dict:
    """Create a comment on a guide. Also increments comment_count."""
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


def get_comments_for_guide(guide_id: str, after_id: int | None = None, limit: int = 30) -> list[dict]:
    """Get comments for a guide with user info. Cursor-based pagination."""
    cursor_clause = "AND gc.id > %s" if after_id else ""

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
                  {cursor_clause}
                ORDER BY gc.created_at ASC
                LIMIT %s
            """, tuple(params))
            return [dict(r) for r in cur.fetchall()]


def delete_comment(comment_id: int, user_id: int) -> bool:
    """Soft-delete a comment. Only the author can delete. Returns True if deleted."""
    comment = _exec_one(
        "SELECT * FROM guide_comments WHERE id=%s AND user_id=%s AND deleted_at IS NULL",
        (comment_id, user_id),
    )
    if not comment:
        return False

    with _PgConnWrapper() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE guide_comments SET deleted_at = NOW() WHERE id = %s", (comment_id,))
            cur.execute(
                "UPDATE user_guides SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = %s",
                (comment["guide_id"],),
            )
            conn.commit()
    return True


# ── Like functions ───────────────────────────────────────────────


def toggle_like(user_id: int, target_type: str, target_id: str) -> dict:
    """Toggle a like. Returns {liked: bool, count: int}."""
    if target_type not in ("guide", "comment"):
        return {"liked": False, "count": 0}

    with _PgConnWrapper() as conn:
        with conn.cursor() as cur:
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

            if target_type == "guide":
                cur.execute("SELECT like_count FROM user_guides WHERE id = %s", (target_id,))
            else:
                cur.execute("SELECT upvote_count FROM guide_comments WHERE id = %s", (int(target_id),))
            row = cur.fetchone()
            count = row[0] if row else 0
            conn.commit()
            return {"liked": not already_liked, "count": count}


def get_like_status_bulk(user_id: int | None, target_type: str, target_ids: list[str]) -> dict:
    """Get like status for multiple targets. Returns {target_id: {liked: bool, count: int}}."""
    if not target_ids:
        return {}

    result = {}
    if target_type == "guide":
        placeholders = ",".join(["%s"] * len(target_ids))
        rows = _exec(
            f"SELECT id, like_count FROM user_guides WHERE id IN ({placeholders})",
            tuple(target_ids),
        )
        for r in rows:
            result[r["id"]] = {"liked": False, "count": r["like_count"] or 0}
    else:
        placeholders = ",".join(["%s"] * len(target_ids))
        rows = _exec(
            f"SELECT id, upvote_count FROM guide_comments WHERE id IN ({placeholders})",
            tuple(int(tid) for tid in target_ids),
        )
        for r in rows:
            result[str(r["id"])] = {"liked": False, "count": r["upvote_count"] or 0}

    for tid in target_ids:
        if tid not in result:
            result[tid] = {"liked": False, "count": 0}

    if user_id:
        placeholders = ",".join(["%s"] * len(target_ids))
        liked_rows = _exec(
            f"SELECT target_id FROM likes WHERE user_id=%s AND target_type=%s AND target_id IN ({placeholders})",
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
        "SELECT target_id FROM likes WHERE user_id=%s AND target_type='guide'",
        (user_id,),
    )
    return [r["target_id"] for r in rows]


# ── Notification functions ───────────────────────────────────────


def create_notification(user_id: int, type: str, actor_id: int, target_type: str | None, target_id: str | None, body: str) -> dict:
    """Create a notification."""
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


def get_notifications(user_id: int, after_id: int | None = None, limit: int = 30) -> list[dict]:
    """Get notifications for a user with actor info. Cursor-based pagination."""
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


def count_unread_notifications(user_id: int) -> int:
    """Count unread notifications for a user."""
    val = _exec_scalar(
        "SELECT COUNT(*) FROM notifications WHERE user_id=%s AND is_read=FALSE",
        (user_id,),
    )
    return val or 0


def mark_notifications_read(user_id: int, ids: list[int] | None = None) -> int:
    """Mark notifications as read. If ids is None, mark all. Returns count marked."""
    if ids is None:
        with _PgConnWrapper() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE notifications SET is_read=TRUE WHERE user_id=%s AND is_read=FALSE", (user_id,))
                count = cur.rowcount
                conn.commit()
                return count
    else:
        if not ids:
            return 0
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


def extract_mentions(body: str) -> list[str]:
    """Extract @handles from comment body."""
    return list(set(_re.findall(r'@([a-z0-9][a-z0-9-]{1,18}[a-z0-9])', body)))
