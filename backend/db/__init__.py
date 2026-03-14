"""Database package — re-exports all public functions for backward compatibility.

Usage: ``from db import init_db, close_pg_pool, ...`` continues to work.
"""

# ── connection helpers ───────────────────────────────────────────
from db.connection import (
    _is_pg,
    _dict_row,
    _exec,
    _exec_insert_returning,
    _exec_modify,
    _exec_one,
    _exec_scalar,
    _BgConnContext,
    _PgConnWrapper,
    background_connection,
    close_pg_pool,
    _get_pg_conn,
)

# ── schema / migrations ─────────────────────────────────────────
from db.schema import init_db

# ── users ────────────────────────────────────────────────────────
from db.users import (
    upsert_user,
    upsert_user_apple,
    get_user_by_id,
    list_users,
    update_user_permissions,
    set_user_tier,
    set_promo_expiry,
    get_total_users,
    get_tier_breakdown,
    mark_user_invited,
    _validate_handle,
    check_handle_available,
    generate_handle_suggestions,
    set_user_handle,
    get_user_by_handle,
    set_user_custom_avatar,
    set_user_bio,
    search_users_by_handle,
    ensure_system_user,
)

# ── conversations & messages ─────────────────────────────────────
from db.conversations import (
    create_conversation,
    list_conversations,
    get_conversation,
    update_conversation_title,
    touch_conversation,
    delete_conversation,
    add_message,
    get_messages,
)

# ── guides ───────────────────────────────────────────────────────
from db.guides import (
    get_saved_guide_ids,
    save_guide,
    unsave_guide,
    get_step_statuses,
    get_all_step_statuses,
    update_step_status,
    get_due_reminders,
    process_due_reminders,
    get_pending_reminders,
    clear_step_reminder,
    migrate_guide_data,
    create_user_guide,
    get_user_guide,
    get_user_snapshots,
    get_user_guides_for_owner,
    update_user_guide,
    delete_user_guide,
    set_user_guide_published,
    update_published_copy,
    get_published_user_guides,
    upsert_user_guide,
    ingest_yaml_guides,
    migrate_user_guide_data,
)

# ── social ───────────────────────────────────────────────────────
from db.social import (
    create_comment,
    get_comments_for_guide,
    delete_comment,
    toggle_like,
    get_like_status_bulk,
    get_liked_guide_ids,
    create_notification,
    get_notifications,
    count_unread_notifications,
    mark_notifications_read,
    extract_mentions,
)

# ── metrics ──────────────────────────────────────────────────────
from db.metrics import (
    batch_insert_usage,
    batch_insert_pipeline_events,
    batch_insert_page_visits,
    get_daily_token_usage,
    get_usage_by_role,
    get_usage_by_model,
    get_dau,
    get_daily_queries,
    get_top_agents,
    get_earliest_usage_date,
    rollup_daily_metrics,
    get_metrics_timeseries,
    get_metrics_summary,
    get_metrics_breakdown,
    get_pipeline_events_summary,
    get_realtime_metrics,
)

# ── events ───────────────────────────────────────────────────────
from db.events import (
    upsert_event,
    get_upcoming_events,
    get_event_by_id,
    cleanup_past_events,
)

# ── invites ──────────────────────────────────────────────────────
from db.invites import (
    create_invite,
    get_invite_by_code,
    redeem_invite,
    count_invites_by_user,
    list_invites_by_user,
    list_all_invites,
    link_invite_to_user,
)

# ── device tokens (push notifications) ──────────────────────────
from db.device_tokens import (
    register_device_token,
    unregister_device_token,
    get_device_tokens_for_user,
)

# ── auth / tokens / waitlist ─────────────────────────────────────
from db.auth import (
    get_or_create_usage,
    increment_usage,
    claim_extended_trial,
    create_refresh_token,
    validate_refresh_token,
    revoke_user_refresh_tokens,
    add_to_waitlist,
    list_waitlist,
    delete_waitlist_entry,
)

__all__ = [
    # connection
    "_is_pg", "_dict_row", "_exec", "_exec_insert_returning", "_exec_modify",
    "_exec_one", "_exec_scalar", "_BgConnContext", "_PgConnWrapper",
    "background_connection", "close_pg_pool", "_get_pg_conn",
    # schema
    "init_db",
    # users
    "upsert_user", "upsert_user_apple", "get_user_by_id", "list_users",
    "update_user_permissions", "set_user_tier", "set_promo_expiry",
    "get_total_users", "get_tier_breakdown", "mark_user_invited",
    "_validate_handle", "check_handle_available", "generate_handle_suggestions",
    "set_user_handle", "get_user_by_handle", "set_user_custom_avatar",
    "set_user_bio", "search_users_by_handle", "ensure_system_user",
    # conversations
    "create_conversation", "list_conversations", "get_conversation",
    "update_conversation_title", "touch_conversation", "delete_conversation",
    "add_message", "get_messages",
    # guides
    "get_saved_guide_ids", "save_guide", "unsave_guide",
    "get_step_statuses", "get_all_step_statuses", "update_step_status",
    "get_due_reminders", "process_due_reminders", "get_pending_reminders",
    "clear_step_reminder", "migrate_guide_data",
    "create_user_guide", "get_user_guide", "get_user_snapshots",
    "get_user_guides_for_owner", "update_user_guide", "delete_user_guide",
    "set_user_guide_published", "update_published_copy",
    "get_published_user_guides", "upsert_user_guide",
    "ingest_yaml_guides", "migrate_user_guide_data",
    # social
    "create_comment", "get_comments_for_guide", "delete_comment",
    "toggle_like", "get_like_status_bulk", "get_liked_guide_ids",
    "create_notification", "get_notifications", "count_unread_notifications",
    "mark_notifications_read", "extract_mentions",
    # metrics
    "batch_insert_usage", "batch_insert_pipeline_events", "batch_insert_page_visits",
    "get_daily_token_usage", "get_usage_by_role", "get_usage_by_model",
    "get_dau", "get_daily_queries", "get_top_agents",
    "get_earliest_usage_date", "rollup_daily_metrics",
    "get_metrics_timeseries", "get_metrics_summary", "get_metrics_breakdown",
    "get_pipeline_events_summary", "get_realtime_metrics",
    # events
    "upsert_event", "get_upcoming_events", "get_event_by_id", "cleanup_past_events",
    # invites
    "create_invite", "get_invite_by_code", "redeem_invite",
    "count_invites_by_user", "list_invites_by_user", "list_all_invites",
    "link_invite_to_user",
    # device tokens
    "register_device_token", "unregister_device_token", "get_device_tokens_for_user",
    # auth
    "get_or_create_usage", "increment_usage", "claim_extended_trial",
    "create_refresh_token", "validate_refresh_token", "revoke_user_refresh_tokens",
    "add_to_waitlist", "list_waitlist", "delete_waitlist_entry",
]
