"""Admin endpoints: document management and knowledge store administration."""
from __future__ import annotations

import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile, HTTPException
from pydantic import BaseModel

from rag.ingest import ingest_document, ingest_pdf
from rag.store import KnowledgeStore
from api.deps import require_admin
from llm.presets import PROVIDERS, ROLE_PRESETS, load_config, save_config

logger = logging.getLogger(__name__)

router = APIRouter()
_store = KnowledgeStore()


class ModelConfigUpdate(BaseModel):
    provider: Optional[str] = None


def _resolve_models(provider: str) -> dict[str, str]:
    """Return {role: model_id} for current settings (full tier, not fast)."""
    return {role: preset[provider] for role, preset in ROLE_PRESETS.items()}


# --- Model configuration ---


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
    collections = _store.list_collections()
    result = []
    for name in collections:
        village_key = name if name != "shared" else None
        stats = _store.get_stats(village=village_key)
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
    collections = _store.list_collections()
    per_collection = {}
    total = 0
    for name in collections:
        village_key = name if name != "shared" else None
        count = _store.get_stats(village=village_key)["document_count"]
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
