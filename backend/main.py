"""GreatNeck.ai — FastAPI backend."""

import logging
import os
import secrets as _secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from db import init_db, close_pg_pool, _is_pg

logger = logging.getLogger(__name__)

# Track whether KNOWLEDGE_DIR is properly mounted
_knowledge_mounted = False


def _wait_for_knowledge_dir(timeout: int = 90) -> bool:
    """Wait for KNOWLEDGE_DIR to be a real mount (not an empty container dir).

    On ECS/Fargate, the EFS volume may take 30-60s to mount after container
    start. If we call init_db() before the mount is ready, we create a local
    SQLite file on ephemeral storage — and lose all data on next deploy.

    We detect a real mount by checking if any file exists in the directory,
    OR if the device ID differs from the root filesystem (true mount).
    """
    knowledge_dir = os.environ.get("KNOWLEDGE_DIR")
    if not knowledge_dir:
        return True  # Dev mode — no mount expected

    kd = Path(knowledge_dir)
    start = time.time()
    while time.time() - start < timeout:
        # Check 1: directory exists
        if not kd.exists():
            logger.info("KNOWLEDGE_DIR %s not found yet, waiting...", knowledge_dir)
            time.sleep(2)
            continue

        # Check 2: is it a real mount? (different device from root)
        try:
            root_dev = os.stat("/").st_dev
            kd_dev = os.stat(knowledge_dir).st_dev
            if kd_dev != root_dev:
                logger.info("KNOWLEDGE_DIR mounted (device %s != root %s)", kd_dev, root_dev)
                return True
        except OSError:
            pass

        # Check 3: fallback — if any files exist, it's probably mounted
        try:
            if any(kd.iterdir()):
                logger.info("KNOWLEDGE_DIR has files, treating as mounted")
                return True
        except OSError:
            pass

        logger.info("KNOWLEDGE_DIR exists but appears empty/unmounted, waiting...")
        time.sleep(2)

    logger.error("KNOWLEDGE_DIR %s not mounted after %ds — refusing to start with ephemeral storage", knowledge_dir, timeout)
    return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _knowledge_mounted

    # JWT secret validation
    if not settings.jwt_secret or settings.jwt_secret == "change-me-in-production":
        is_dev = "localhost" in settings.frontend_url or "127.0.0.1" in settings.frontend_url
        if is_dev:
            settings.jwt_secret = _secrets.token_urlsafe(32)
            logger.warning("JWT_SECRET not set — using ephemeral secret (dev mode). Sessions won't survive restarts.")
        else:
            raise RuntimeError("JWT_SECRET must be set in production. Set the JWT_SECRET environment variable.")

    # Only wait for mount when using SQLite (needs GCS FUSE)
    if not _is_pg():
        if not _wait_for_knowledge_dir():
            raise RuntimeError("KNOWLEDGE_DIR is not mounted. Refusing to start to prevent data loss.")

    _knowledge_mounted = True
    init_db()
    logger.info("Database initialized (mode=%s)", "PostgreSQL" if _is_pg() else "SQLite")
    yield
    # Shutdown: close PostgreSQL pool if active
    close_pg_pool()


app = FastAPI(
    title="GreatNeck.ai",
    description="AI-powered community assistant for Great Neck village codes, permits, and local info",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Import and mount route modules
from api.chat import router as chat_router
from api.admin import router as admin_router
from api.villages import router as villages_router
from api.debug import router as debug_router
from api.auth import router as auth_router
from api.conversations import router as conversations_router
from api.events import router as events_router

app.include_router(chat_router, prefix="/api")
app.include_router(admin_router, prefix="/api/admin")
app.include_router(villages_router, prefix="/api")
app.include_router(debug_router, prefix="/api/debug")
app.include_router(auth_router, prefix="/api")
app.include_router(conversations_router, prefix="/api")
app.include_router(events_router, prefix="/api")


@app.get("/health")
async def health():
    knowledge_dir = os.environ.get("KNOWLEDGE_DIR")
    if knowledge_dir and not _knowledge_mounted:
        return {"status": "starting", "detail": "waiting for storage mount"}
    return {"status": "ok"}
