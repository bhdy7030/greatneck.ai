"""Health check endpoints."""

import os
import time
from fastapi import APIRouter

router = APIRouter(tags=["health"])

_start_time = time.time()
error_count = 0


def increment_error_count():
    global error_count
    error_count += 1


@router.get("/health")
async def health():
    from main import _knowledge_mounted

    knowledge_dir = os.environ.get("KNOWLEDGE_DIR")
    if knowledge_dir and not _knowledge_mounted:
        return {"status": "starting", "detail": "waiting for storage mount"}
    return {"status": "ok"}


@router.get("/health/detail")
async def health_detail():
    from main import _knowledge_mounted
    from db import _is_pg

    uptime_seconds = round(time.time() - _start_time, 1)
    db_mode = "PostgreSQL" if _is_pg() else "SQLite"

    return {
        "status": "ok" if _knowledge_mounted else "starting",
        "uptime_seconds": uptime_seconds,
        "db_mode": db_mode,
        "error_count": error_count,
    }
