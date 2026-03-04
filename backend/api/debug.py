"""Debug endpoints: memory store for RAG/agent observations and instructions."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from debug.memory import debug_memory
from knowledge.registry import reload as reload_registry

router = APIRouter()


class MemoryEntry(BaseModel):
    type: str  # rag_quality, agent_workflow, query_pattern, instruction
    content: str
    related_query: str = ""
    tags: list[str] = []
    conversation: list[dict] = []


class MemoryUpdate(BaseModel):
    content: Optional[str] = None
    status: Optional[str] = None
    tags: Optional[list[str]] = None


@router.get("/memory")
async def list_memory(type: Optional[str] = None, status: Optional[str] = None):
    return debug_memory.list_all(type_filter=type, status_filter=status)


@router.post("/memory")
async def add_memory(entry: MemoryEntry):
    return debug_memory.add(
        type=entry.type,
        content=entry.content,
        related_query=entry.related_query,
        tags=entry.tags,
        conversation=entry.conversation,
    )


@router.put("/memory/{entry_id}")
async def update_memory(entry_id: str, update: MemoryUpdate):
    result = debug_memory.update(entry_id, **update.model_dump(exclude_none=True))
    if not result:
        raise HTTPException(status_code=404, detail="Entry not found")
    return result


@router.delete("/memory/{entry_id}")
async def delete_memory(entry_id: str):
    if not debug_memory.delete(entry_id):
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"deleted": True}


@router.get("/memory/context")
async def get_memory_context():
    return {"context": debug_memory.get_active_instructions()}


@router.post("/registry/reload")
async def reload_registry_endpoint():
    """Hot-reload common_answers.yaml without restarting the server."""
    reload_registry()
    return {"status": "reloaded"}
