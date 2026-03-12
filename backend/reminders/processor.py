"""Background task: check for due step reminders and create notifications.

Runs every REMINDER_INTERVAL seconds. Uses a dedicated DB connection
so it never competes with user-facing requests for the shared pool.
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)

REMINDER_INTERVAL = 60  # seconds

_task: asyncio.Task | None = None


def _process_with_dedicated_conn() -> int:
    """Process due reminders using a dedicated DB connection."""
    from db import process_due_reminders, background_connection
    with background_connection():
        return process_due_reminders()


async def _reminder_loop():
    """Background loop: process due reminders every REMINDER_INTERVAL seconds."""
    # Wait on startup to let the DB initialize
    await asyncio.sleep(30)

    while True:
        try:
            from api.aio import run_sync

            count = await run_sync(_process_with_dedicated_conn)
            if count > 0:
                logger.info("Processed %d reminder(s)", count)
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Reminder processing error (will retry in %ds)", REMINDER_INTERVAL)

        try:
            await asyncio.sleep(REMINDER_INTERVAL)
        except asyncio.CancelledError:
            break


async def start_reminder_processor():
    """Start the background reminder task. Call from FastAPI lifespan."""
    global _task
    _task = asyncio.create_task(_reminder_loop())
    logger.info("Reminder processor started (every %ds)", REMINDER_INTERVAL)


async def stop_reminder_processor():
    """Cancel the reminder task. Call from FastAPI lifespan shutdown."""
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
        logger.info("Reminder processor stopped")
