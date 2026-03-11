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


# ── Pipeline event record ──

@dataclass
class PipelineEvent:
    event_type: str        # agent_selected, tool_call, pipeline_stage, cache_hit, cache_miss, web_search
    event_name: str        # agent name, tool name, stage name
    duration_ms: int = 0
    metadata: dict = field(default_factory=dict)
    success: bool = True
    session_id: str = ""
    conversation_id: str = ""
    timestamp: float = field(default_factory=time.time)


# ── Page visit record ──

@dataclass
class PageVisit:
    session_id: str
    page: str
    user_id: int | None = None
    referrer: str = ""
    user_agent: str = ""
    timestamp: float = field(default_factory=time.time)


# ── Collector singleton ──

class MetricsCollector:
    """Thread-safe, async-friendly metrics collector."""

    def __init__(self):
        self._queue: deque[UsageRecord] = deque(maxlen=10_000)
        self._event_queue: deque[PipelineEvent] = deque(maxlen=10_000)
        self._visit_queue: deque[PageVisit] = deque(maxlen=10_000)
        self._task: asyncio.Task | None = None
        self._running = False

    def record(self, rec: UsageRecord):
        """Fire-and-forget from hot path. ~0 latency."""
        self._queue.append(rec)

    def record_event(self, event: PipelineEvent):
        """Fire-and-forget pipeline event from hot path. ~0 latency."""
        self._event_queue.append(event)

    def record_visit(self, visit: PageVisit):
        """Fire-and-forget page visit from hot path. ~0 latency."""
        self._visit_queue.append(visit)

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
        """Drain up to MAX_BATCH records from both queues and batch-insert to DB."""
        from api.aio import run_sync

        # Flush usage records
        if self._queue:
            batch: list[UsageRecord] = []
            while self._queue and len(batch) < MAX_BATCH:
                batch.append(self._queue.popleft())
            if batch:
                try:
                    from db import batch_insert_usage
                    await run_sync(batch_insert_usage, batch)
                except Exception:
                    logger.exception("Failed to flush %d usage records", len(batch))
                    for rec in reversed(batch):
                        self._queue.appendleft(rec)

        # Flush pipeline events
        if self._event_queue:
            event_batch: list[PipelineEvent] = []
            while self._event_queue and len(event_batch) < MAX_BATCH:
                event_batch.append(self._event_queue.popleft())
            if event_batch:
                try:
                    from db import batch_insert_pipeline_events
                    await run_sync(batch_insert_pipeline_events, event_batch)
                except Exception:
                    logger.exception("Failed to flush %d pipeline events", len(event_batch))
                    for evt in reversed(event_batch):
                        self._event_queue.appendleft(evt)

        # Flush page visits
        if self._visit_queue:
            visit_batch: list[PageVisit] = []
            while self._visit_queue and len(visit_batch) < MAX_BATCH:
                visit_batch.append(self._visit_queue.popleft())
            if visit_batch:
                try:
                    from db import batch_insert_page_visits
                    await run_sync(batch_insert_page_visits, visit_batch)
                except Exception:
                    logger.exception("Failed to flush %d page visits", len(visit_batch))
                    for v in reversed(visit_batch):
                        self._visit_queue.appendleft(v)


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


def record_pipeline_event(
    event_type: str,
    event_name: str,
    duration_ms: int = 0,
    metadata: dict | None = None,
    success: bool = True,
):
    """Fire-and-forget pipeline event recording. ~0 latency on hot path."""
    collector.record_event(PipelineEvent(
        event_type=event_type,
        event_name=event_name,
        duration_ms=duration_ms,
        metadata=metadata or {},
        success=success,
        session_id=get_session_id(),
        conversation_id=get_conversation_id(),
    ))
