"""Background task: periodically roll up raw metrics into metrics_daily.

Runs every ROLLUP_INTERVAL seconds, aggregating today (partial) and
yesterday (catch-up) into the pre-aggregated metrics_daily table.

IMPORTANT: All DB work uses a dedicated connection (via background_connection())
so it never competes with user-facing requests for the shared pool.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

ROLLUP_INTERVAL = 600  # 10 minutes

_ET = ZoneInfo("America/New_York")

_task: asyncio.Task | None = None


_backfill_done = False


def _run_rollup_with_dedicated_conn(target_date: str) -> int:
    """Run rollup for a single date using a dedicated DB connection."""
    from db import rollup_daily_metrics, background_connection
    with background_connection():
        return rollup_daily_metrics(target_date)


def _get_earliest_with_dedicated_conn() -> str | None:
    """Get earliest usage date using a dedicated DB connection."""
    from db import get_earliest_usage_date, background_connection
    with background_connection():
        return get_earliest_usage_date()


async def _backfill_historical():
    """One-time backfill: roll up every historical date from the earliest llm_usage row."""
    global _backfill_done
    if _backfill_done:
        return
    _backfill_done = True

    try:
        from api.aio import run_sync

        earliest = await run_sync(_get_earliest_with_dedicated_conn)
        if not earliest:
            logger.info("Backfill: no historical llm_usage data found")
            return

        now = datetime.now(_ET)
        day_before_yesterday = (now - timedelta(days=2)).strftime("%Y-%m-%d")

        # Only backfill dates before yesterday (yesterday/today handled by regular loop)
        if earliest > day_before_yesterday:
            logger.info("Backfill: earliest date %s is recent, no backfill needed", earliest)
            return

        from datetime import date as date_type
        start = date_type.fromisoformat(earliest)
        end = date_type.fromisoformat(day_before_yesterday)
        days_count = 0

        current = start
        while current <= end:
            date_str = current.isoformat()
            await run_sync(_run_rollup_with_dedicated_conn, date_str)
            days_count += 1
            current += timedelta(days=1)
            # Yield to event loop between days
            await asyncio.sleep(0.1)

        logger.info("Backfill complete: %d days (%s to %s)", days_count, earliest, day_before_yesterday)
    except Exception:
        logger.exception("Backfill error (non-fatal, regular rollup continues)")


async def _rollup_loop():
    """Background loop: roll up metrics every ROLLUP_INTERVAL seconds."""
    # Wait on startup to let the DB initialize
    await asyncio.sleep(60)

    # One-time historical backfill on first run
    await _backfill_historical()

    while True:
        try:
            from api.aio import run_sync

            now = datetime.now(_ET)
            today = now.strftime("%Y-%m-%d")
            yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")

            # Roll up yesterday first (catch-up / finalize)
            y_count = await run_sync(_run_rollup_with_dedicated_conn, yesterday)
            # Roll up today (partial, will be overwritten on next run)
            t_count = await run_sync(_run_rollup_with_dedicated_conn, today)

            logger.info(
                "Metrics rollup complete: yesterday=%s (%d rows), today=%s (%d rows)",
                yesterday, y_count, today, t_count,
            )
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Metrics rollup error (will retry in %ds)", ROLLUP_INTERVAL)

        try:
            await asyncio.sleep(ROLLUP_INTERVAL)
        except asyncio.CancelledError:
            break


async def start_metrics_rollup():
    """Start the background rollup task. Call from FastAPI lifespan."""
    global _task
    _task = asyncio.create_task(_rollup_loop())
    logger.info("Metrics rollup task started (every %ds)", ROLLUP_INTERVAL)


async def stop_metrics_rollup():
    """Cancel the rollup task. Call from FastAPI lifespan shutdown."""
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
        logger.info("Metrics rollup task stopped")
