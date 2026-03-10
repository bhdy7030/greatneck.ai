"""Admin endpoints: document management and knowledge store administration."""
from __future__ import annotations

import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, Header, UploadFile, HTTPException
from pydantic import BaseModel

from rag.ingest import ingest_document, ingest_pdf
from rag.store import KnowledgeStore
from api.deps import require_admin
from llm.presets import PROVIDERS, ROLE_PRESETS, load_config, save_config
from db import (
    get_dau, get_daily_queries, get_tier_breakdown, get_total_users,
    get_top_agents, get_daily_token_usage, get_usage_by_role, get_usage_by_model,
)
from api.aio import run_sync

logger = logging.getLogger(__name__)

router = APIRouter()
_store = KnowledgeStore()


@router.get("/metrics")
async def get_metrics(user: dict = Depends(require_admin)) -> dict:
    """Return DAU, query volume, tier breakdown, and real token/cost metrics."""
    from datetime import date

    dau = await run_sync(get_dau, 30)
    daily_queries = await run_sync(get_daily_queries, 30)
    tier_breakdown = await run_sync(get_tier_breakdown)
    total_users = await run_sync(get_total_users)
    top_agents = await run_sync(get_top_agents, 7)

    # Real token usage from llm_usage table
    daily_tokens = await run_sync(get_daily_token_usage, 30)
    usage_by_role = await run_sync(get_usage_by_role, 7)
    usage_by_model = await run_sync(get_usage_by_model, 7)

    today_str = date.today().isoformat()
    today_dau = next((d for d in dau if d["date"] == today_str), None)
    today_queries_row = next((d for d in daily_queries if d["date"] == today_str), None)
    today_token_row = next((d for d in daily_tokens if d["date"] == today_str), None)

    today_queries = today_queries_row["count"] if today_queries_row else 0
    today_sessions = today_dau["sessions"] if today_dau else 0
    today_users = today_dau["users"] if today_dau else 0

    today_cost = today_token_row["cost_usd"] if today_token_row else 0
    today_tokens = today_token_row["total_tokens"] if today_token_row else 0
    month_cost = sum(d["cost_usd"] for d in daily_tokens)
    month_tokens = sum(d["total_tokens"] for d in daily_tokens)

    return {
        "dau": dau,
        "daily_queries": daily_queries,
        "daily_tokens": daily_tokens,
        "tier_breakdown": tier_breakdown,
        "total_users": total_users,
        "top_agents": top_agents,
        "usage_by_role": usage_by_role,
        "usage_by_model": usage_by_model,
        "today": {
            "queries": today_queries,
            "sessions": today_sessions,
            "users": today_users,
            "tokens": today_tokens,
            "cost_usd": round(today_cost, 4),
        },
        "cost": {
            "today_usd": round(today_cost, 4),
            "month_usd": round(month_cost, 4),
            "month_tokens": month_tokens,
        },
    }


class ModelConfigUpdate(BaseModel):
    provider: Optional[str] = None


def _resolve_models(provider: str) -> dict[str, str]:
    """Return {role: model_id} for current settings (full tier, not fast)."""
    return {role: preset[provider] for role, preset in ROLE_PRESETS.items()}


# --- Model configuration ---


@router.get("/cache/stats")
async def cache_stats(user: dict = Depends(require_admin)) -> dict:
    """Return hit/miss stats for all cache layers."""
    from cache import all_stats
    return {"caches": all_stats()}


@router.post("/cache/clear")
async def cache_clear(user: dict = Depends(require_admin)) -> dict:
    """Clear all caches (e.g., after knowledge re-ingestion)."""
    from cache import clear_all
    await run_sync(clear_all)
    return {"ok": True}


@router.get("/models")
async def get_model_config(user: dict = Depends(require_admin)) -> dict:
    """Return current provider and resolved model map."""
    cfg = load_config()
    provider = cfg.get("provider", "claude")
    return {
        "provider": provider,
        "models": _resolve_models(provider),
    }


@router.put("/models")
async def update_model_config(
    body: ModelConfigUpdate, user: dict = Depends(require_admin)
) -> dict:
    """Update provider. Returns updated config."""
    cfg = load_config()

    if body.provider is not None:
        if body.provider not in PROVIDERS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid provider '{body.provider}'. Must be one of {PROVIDERS}",
            )
        cfg["provider"] = body.provider

    save_config(cfg)

    provider = cfg["provider"]
    return {
        "provider": provider,
        "models": _resolve_models(provider),
    }


class IngestRequest(BaseModel):
    content: str
    source: str
    village: str = ""
    category: str = "general"


class IngestResponse(BaseModel):
    status: str
    chunks: int = 0
    source: str = ""


class CollectionInfo(BaseModel):
    name: str
    document_count: int


# --- Document upload/ingestion ---


@router.post("/documents", response_model=IngestResponse)
async def upload_document(
    file: UploadFile | None = File(None),
    content: str | None = Form(None),
    source: str | None = Form(None),
    village: str = Form(""),
    category: str = Form("general"),
    user: dict = Depends(require_admin),
) -> IngestResponse:
    """Upload a text or PDF document for ingestion into the knowledge store.

    Accepts either:
    - A file upload (text or PDF)
    - Form fields: content, source, village, category
    """
    if file:
        return await _ingest_file(file, village, category)
    elif content and source:
        result = await ingest_document(
            content=content,
            source=source,
            village=village or None,
            category=category,
        )
        return IngestResponse(**result)
    else:
        raise HTTPException(
            status_code=400,
            detail="Provide either a file upload or both 'content' and 'source' fields.",
        )


async def _ingest_file(file: UploadFile, village: str, category: str) -> IngestResponse:
    """Handle file upload ingestion."""
    filename = file.filename or "upload"
    file_bytes = await file.read()

    if filename.lower().endswith(".pdf"):
        # Save to a temporary file for PDF processing
        import tempfile
        from pathlib import Path

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        try:
            result = await ingest_pdf(
                file_path=tmp_path,
                village=village or None,
                category=category,
            )
        finally:
            Path(tmp_path).unlink(missing_ok=True)

        return IngestResponse(**result)
    else:
        # Treat as text
        try:
            text = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="File must be UTF-8 text or PDF.")

        result = await ingest_document(
            content=text,
            source=filename,
            village=village or None,
            category=category,
        )
        return IngestResponse(**result)


@router.post("/documents/json", response_model=IngestResponse)
async def upload_document_json(request: IngestRequest, user: dict = Depends(require_admin)) -> IngestResponse:
    """Upload document content as JSON (alternative to form/file upload)."""
    result = await ingest_document(
        content=request.content,
        source=request.source,
        village=request.village or None,
        category=request.category,
    )
    return IngestResponse(**result)


# --- Knowledge store management ---


@router.get("/sources")
async def list_sources(user: dict = Depends(require_admin)) -> list[dict]:
    """List all knowledge store collections with document counts."""
    collections = await run_sync(_store.list_collections)
    result = []
    for name in collections:
        village_key = name if name != "shared" else None
        stats = await run_sync(_store.get_stats, village=village_key)
        result.append({
            "name": name,
            "village": name,
            "source": name,
            "category": "all",
            "document_count": stats["document_count"],
            "chunk_count": stats["document_count"],
        })
    return result


@router.get("/stats")
async def knowledge_stats(user: dict = Depends(require_admin)) -> dict:
    """Get overall knowledge base statistics."""
    collections = await run_sync(_store.list_collections)
    per_collection = {}
    total = 0
    for name in collections:
        village_key = name if name != "shared" else None
        stats = await run_sync(_store.get_stats, village=village_key)
        count = stats["document_count"]
        per_collection[name] = count
        total += count
    return {
        "collections": collections,
        "total_documents": total,
        "per_collection": per_collection,
    }


@router.delete("/sources/{village}")
async def delete_source(village: str, user: dict = Depends(require_admin)) -> dict:
    """Delete a village's collection from the knowledge store."""
    try:
        collection_name = _store._collection_name(village if village != "shared" else None)
        _store.client.delete_collection(name=collection_name)
        return {"status": "deleted", "village": village}
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Collection not found: {e}")


@router.post("/ingest/parkdistrict")
async def ingest_parkdistrict(user: dict = Depends(require_admin)) -> dict:
    """Admin: scrape Great Neck Park District website and ingest into RAG."""
    from scrapers.parkdistrict import scrape_park_district

    pages = await scrape_park_district()
    total_chunks = 0
    for page in pages:
        result = await ingest_document(
            content=page.text,
            source=f"Great Neck Park District — {page.title}",
            village=None,
            category="community",
            url=page.url,
        )
        if result["status"] == "ok":
            total_chunks += result["chunks"]

    return {"status": "ok", "pages": len(pages), "chunks": total_chunks}


@router.post("/ingest/refresh")
async def refresh_rag(
    x_cron_secret: str = Header(default="", alias="X-Cron-Secret"),
):
    """Cron: re-scrape and ingest RAG sources (community, parkdistrict, sites)."""
    from config import settings

    if not settings.cron_secret:
        raise HTTPException(status_code=503, detail="Cron secret not configured")
    if x_cron_secret != settings.cron_secret:
        raise HTTPException(status_code=403, detail="Invalid cron secret")

    from scrapers.parkdistrict import scrape_park_district
    from scrapers.social import scrape_community, format_post_for_ingestion

    results = {}

    # Park District pages
    try:
        pages = await scrape_park_district()
        chunks = 0
        for page in pages:
            r = await ingest_document(
                content=page.text,
                source=f"Great Neck Park District — {page.title}",
                village=None, category="community", url=page.url,
            )
            if r["status"] == "ok":
                chunks += r["chunks"]
        results["parkdistrict"] = {"pages": len(pages), "chunks": chunks}
    except Exception as e:
        logger.error(f"[ingest:refresh] parkdistrict failed: {e}")
        results["parkdistrict"] = {"error": str(e)}

    # Community social (Reddit, Yelp, news)
    try:
        posts = await scrape_community()
        ingested = 0
        for post in posts:
            content = format_post_for_ingestion(post)
            if len(content) < 50:
                continue
            r = await ingest_document(
                content=content,
                source=post.source_type or "Community",
                village=None, category="community", url=post.url,
            )
            if r["status"] == "ok":
                ingested += 1
        results["community"] = {"posts": len(posts), "ingested": ingested}
    except Exception as e:
        logger.error(f"[ingest:refresh] community failed: {e}")
        results["community"] = {"error": str(e)}

    return {"status": "ok", "results": results}
