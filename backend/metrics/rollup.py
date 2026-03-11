"""Background task: periodically roll up raw metrics into metrics_daily.

Runs every ROLLUP_INTERVAL seconds, aggregating today (partial) and
yesterday (catch-up) into the pre-aggregated metrics_daily table.

Pattern matches the MetricsCollector in collector.py — asyncio.create_task,
errors logged but never crash the server.
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


async def _rollup_loop():
    """Background loop: roll up metrics every ROLLUP_INTERVAL seconds."""
    # Wait a bit on startup to let the DB initialize and some data accumulate
    await asyncio.sleep(30)

    while True:
        try:
            from db import rollup_daily_metrics
            from api.aio import run_sync

            now = datetime.now(_ET)
            today = now.strftime("%Y-%m-%d")
            yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")

            # Roll up yesterday first (catch-up / finalize)
            y_count = await run_sync(rollup_daily_metrics, yesterday)
            # Roll up today (partial, will be overwritten on next run)
            t_count = await run_sync(rollup_daily_metrics, today)

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
