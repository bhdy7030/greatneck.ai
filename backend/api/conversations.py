"""Conversation CRUD routes — all require authentication."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from api.deps import get_current_user
from db import (
    create_conversation,
    list_conversations,
    get_conversation,
    get_messages,
    update_conversation_title,
    delete_conversation,
)

router = APIRouter()


class CreateConversationRequest(BaseModel):
    village: str = ""


class RenameConversationRequest(BaseModel):
    title: str


@router.get("/conversations")
async def list_convos(user: dict = Depends(get_current_user)):
    """List all conversations for the current user."""
    convos = list_conversations(user["id"])
    return [
        {
            "id": c["id"],
            "title": c["title"],
            "village": c["village"],
            "updated_at": c["updated_at"],
            "message_count": c.get("message_count", 0),
            "preview": (c.get("preview") or "")[:100],
        }
        for c in convos
    ]


@router.post("/conversations")
async def create_convo(body: CreateConversationRequest, user: dict = Depends(get_current_user)):
    """Create a new conversation."""
    convo = create_conversation(user["id"], body.village)
    return convo


@router.get("/conversations/{conversation_id}")
async def get_convo(conversation_id: str, user: dict = Depends(get_current_user)):
    """Get a conversation with its messages. Ownership check."""
    convo = get_conversation(conversation_id)
    if not convo or convo["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Conversation not found")
    messages = get_messages(conversation_id)
    return {
        **convo,
        "messages": [
            {
                "id": m["id"],
                "role": m["role"],
                "content": m["content"],
                "image_base64": m.get("image_base64"),
                "sources": m.get("sources", []),
                "agent_used": m.get("agent_used"),
                "created_at": m["created_at"],
            }
            for m in messages
        ],
    }


@router.put("/conversations/{conversation_id}")
async def rename_convo(
    conversation_id: str,
    body: RenameConversationRequest,
    user: dict = Depends(get_current_user),
):
    """Rename a conversation."""
    convo = get_conversation(conversation_id)
    if not convo or convo["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Conversation not found")
    update_conversation_title(conversation_id, body.title)
    return {"ok": True}


@router.delete("/conversations/{conversation_id}")
async def delete_convo(conversation_id: str, user: dict = Depends(get_current_user)):
    """Delete a conversation (CASCADE removes messages)."""
    convo = get_conversation(conversation_id)
    if not convo or convo["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Conversation not found")
    delete_conversation(conversation_id)
    return {"ok": True}
