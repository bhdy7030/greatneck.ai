"""GreatNeck.ai — FastAPI backend."""

import logging
import secrets as _secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from db import init_db

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # JWT secret validation
    if not settings.jwt_secret or settings.jwt_secret == "change-me-in-production":
        is_dev = "localhost" in settings.frontend_url or "127.0.0.1" in settings.frontend_url
        if is_dev:
            settings.jwt_secret = _secrets.token_urlsafe(32)
            logger.warning("JWT_SECRET not set — using ephemeral secret (dev mode). Sessions won't survive restarts.")
        else:
            raise RuntimeError("JWT_SECRET must be set in production. Set the JWT_SECRET environment variable.")

    init_db()
    yield


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
    return {"status": "ok"}
