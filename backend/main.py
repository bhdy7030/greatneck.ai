"""GreatNeck Community Assistant — FastAPI backend."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings

app = FastAPI(
    title="GreatNeck Community Assistant",
    description="AI-powered assistant for Great Neck village codes, permits, and community info",
    version="0.1.0",
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

app.include_router(chat_router, prefix="/api")
app.include_router(admin_router, prefix="/api/admin")
app.include_router(villages_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}
