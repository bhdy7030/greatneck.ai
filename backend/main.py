"""GreatNeck.ai — FastAPI backend."""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings
from db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
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
