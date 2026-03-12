"""Comment routes for playbooks/guides."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from db import (
    create_comment,
    get_comments_for_guide,
    delete_comment,
    get_user_guide,
    get_like_status_bulk,
    extract_mentions,
    get_user_by_handle,
    create_notification,
)
from api.deps import get_current_user, get_optional_user
from api.aio import run_sync

router = APIRouter()


def _resolve_avatar(user_row: dict) -> str:
    custom = user_row.get("custom_avatar_url", "")
    return custom if custom else user_row.get("avatar_url", "")


def _format_comment(c: dict, user_upvoted: bool = False) -> dict:
    return {
        "id": c["id"],
        "body": c["body"],
        "user": {
            "handle": c.get("handle"),
            "name": c.get("name", ""),
            "avatar_url": _resolve_avatar(c),
        },
        "upvote_count": c.get("upvote_count", 0),
        "user_upvoted": user_upvoted,
        "created_at": str(c.get("created_at", "")),
    }


@router.get("/guides/{guide_id}/comments")
async def list_comments(
    guide_id: str,
    after: int | None = None,
    limit: int = 30,
    user: dict | None = Depends(get_optional_user),
):
    """List comments on a guide."""
    limit = min(limit, 100)
    comments = await run_sync(get_comments_for_guide, guide_id, after, limit)

    # Get upvote status for the current user
    upvoted_set = set()
    if user and comments:
        comment_ids = [str(c["id"]) for c in comments]
        statuses = await run_sync(get_like_status_bulk, user["id"], "comment", comment_ids)
        upvoted_set = {cid for cid, s in statuses.items() if s.get("liked")}

    formatted = [_format_comment(c, str(c["id"]) in upvoted_set) for c in comments]
    return {
        "comments": formatted,
        "has_more": len(comments) == limit,
    }


class CommentCreateRequest(BaseModel):
    body: str


@router.post("/guides/{guide_id}/comments")
async def post_comment(
    guide_id: str,
    body: CommentCreateRequest,
    user: dict = Depends(get_current_user),
):
    """Post a comment on a guide."""
    if not body.body.strip():
        raise HTTPException(status_code=400, detail="Comment body cannot be empty")
    if len(body.body) > 5000:
        raise HTTPException(status_code=400, detail="Comment too long (max 5000 chars)")

    # Check that guide exists and is published
    guide = await run_sync(get_user_guide, guide_id)
    if not guide:
        raise HTTPException(status_code=404, detail="Guide not found")
    if not guide.get("is_published"):
        raise HTTPException(status_code=403, detail="Comments are only allowed on published playbooks")

    comment = await run_sync(create_comment, guide_id, user["id"], body.body.strip())

    # Extract @mentions and create notifications
    mentions = extract_mentions(body.body)
    actor_handle = user.get("handle", user.get("name", "Someone"))

    # Resolve guide title for notifications
    guide_title = ""
    guide_data = guide.get("guide_data")
    if isinstance(guide_data, dict):
        title_obj = guide_data.get("title", "")
        guide_title = title_obj.get("en", str(title_obj)) if isinstance(title_obj, dict) else str(title_obj)

    for handle in mentions:
        mentioned_user = await run_sync(get_user_by_handle, handle)
        if mentioned_user and mentioned_user["id"] != user["id"]:
            notif_body = f"@{actor_handle} mentioned you on \"{guide_title}\""
            await run_sync(
                create_notification,
                mentioned_user["id"], "mention", user["id"],
                "guide", guide_id, notif_body,
            )

    # Notify the guide owner if the commenter is not the owner (user guides only)
    if guide and guide.get("user_id") and guide["user_id"] != user["id"]:
        notif_body = f"@{actor_handle} commented on \"{guide_title}\""
        await run_sync(
            create_notification,
            guide["user_id"], "comment", user["id"],
            "guide", guide_id, notif_body,
        )

    return _format_comment({
        **comment,
        "handle": user.get("handle"),
        "name": user.get("name", ""),
        "avatar_url": user.get("avatar_url", ""),
        "custom_avatar_url": user.get("custom_avatar_url", ""),
    })


@router.delete("/guides/{guide_id}/comments/{comment_id}")
async def remove_comment(
    guide_id: str,
    comment_id: int,
    user: dict = Depends(get_current_user),
):
    """Delete a comment (soft delete). Author only."""
    deleted = await run_sync(delete_comment, comment_id, user["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Comment not found or not authorized")
    return {"ok": True}
