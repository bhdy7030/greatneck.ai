"""Async metrics collector — fire-and-forget from the hot path.

Pattern: asyncio.Queue + background batch writer.
Same approach used by DataDog agent, StatsD, and OpenTelemetry batch processor.

Hot path: record() pushes to an in-memory queue (~microseconds).
Background: _drain_loop() batch-inserts to DB every FLUSH_INTERVAL seconds.
Worst case on crash: lose ~FLUSH_INTERVAL seconds of metrics (acceptable for analytics).
"""

from __future__ import annotations

import asyncio
import contextvars
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

FLUSH_INTERVAL = 5.0  # seconds
MAX_BATCH = 200       # max records per flush

# ── Per-request context (set once at chat entry, read by llm/provider.py) ──

_ctx_session_id: contextvars.ContextVar[str] = contextvars.ContextVar("metrics_session_id", default="")
_ctx_conversation_id: contextvars.ContextVar[str] = contextvars.ContextVar("metrics_conversation_id", default="")


def set_request_context(session_id: str = "", conversation_id: str = ""):
    """Call at the start of each chat request."""
    _ctx_session_id.set(session_id or "")
    _ctx_conversation_id.set(conversation_id or "")


def get_session_id() -> str:
    return _ctx_session_id.get()


def get_conversation_id() -> str:
    return _ctx_conversation_id.get()


# ── Usage record ──

@dataclass
class UsageRecord:
    role: str              # router, planner, specialist, critic, vision, simple
    model: str             # actual model ID
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    session_id: str = ""
    conversation_id: str = ""
    timestamp: float = field(default_factory=time.time)


# ── Collector singleton ──

class MetricsCollector:
    """Thread-safe, async-friendly metrics collector."""

    def __init__(self):
        self._queue: deque[UsageRecord] = deque(maxlen=10_000)
        self._task: asyncio.Task | None = None
        self._running = False

    def record(self, rec: UsageRecord):
        """Fire-and-forget from hot path. ~0 latency."""
        self._queue.append(rec)

    async def start(self):
        """Start the background drain loop (call from FastAPI lifespan)."""
        self._running = True
        self._task = asyncio.create_task(self._drain_loop())
        logger.info("Metrics collector started (flush every %.0fs)", FLUSH_INTERVAL)

    async def stop(self):
        """Flush remaining records and stop (call from FastAPI lifespan shutdown)."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        # Final flush
        await self._flush()
        logger.info("Metrics collector stopped")

    async def _drain_loop(self):
        """Background loop: flush queue to DB every FLUSH_INTERVAL."""
        while self._running:
            try:
                await asyncio.sleep(FLUSH_INTERVAL)
                await self._flush()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Metrics flush error")

    async def _flush(self):
        """Drain up to MAX_BATCH records and batch-insert to DB."""
        if not self._queue:
            return

        batch: list[UsageRecord] = []
        while self._queue and len(batch) < MAX_BATCH:
            batch.append(self._queue.popleft())

        if not batch:
            return

        try:
            from db import batch_insert_usage
            from api.aio import run_sync
            await run_sync(batch_insert_usage, batch)
        except Exception:
            logger.exception("Failed to flush %d metrics records", len(batch))
            # Put them back for retry (prepend to front)
            for rec in reversed(batch):
                self._queue.appendleft(rec)


# Module-level singleton
collector = MetricsCollector()


def record_llm_usage(
    role: str,
    model: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
    cost_usd: float = 0.0,
    latency_ms: int = 0,
):
    """Convenience function called from llm/provider.py."""
    collector.record(UsageRecord(
        role=role,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        cost_usd=cost_usd,
        latency_ms=latency_ms,
        session_id=get_session_id(),
        conversation_id=get_conversation_id(),
    ))
