"""Cron endpoints — called by Cloud Scheduler.

Secured by CRON_SECRET header. Set the CRON_SECRET env var and configure
Cloud Scheduler to send it as X-Cron-Secret header.

In development, the in-process reminder loop still runs as a fallback.
"""

import logging
import os
from fastapi import APIRouter, Header, HTTPException
from api.aio import run_sync

logger = logging.getLogger(__name__)

router = APIRouter(tags=["cron"])

_CRON_SECRET = os.environ.get("CRON_SECRET", "")


def _verify_cron_secret(x_cron_secret: str = Header(default="")):
    """Verify the cron secret header. Skip check if CRON_SECRET is not configured."""
    if not _CRON_SECRET:
        return  # No secret configured — allow (dev mode)
    if x_cron_secret != _CRON_SECRET:
        raise HTTPException(status_code=403, detail="Invalid cron secret")


@router.post("/cron/reminders")
async def process_reminders(x_cron_secret: str = Header(default="")):
    """Process due reminders. Called by Cloud Scheduler every 5 minutes."""
    _verify_cron_secret(x_cron_secret)

    from db import process_due_reminders, background_connection

    def _run():
        with background_connection():
            return process_due_reminders()

    count = await run_sync(_run)
    logger.info("Cron: processed %d reminder(s)", count)
    return {"processed": count}
