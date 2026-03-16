"""Chat endpoint: routes queries through the agent pipeline."""
from __future__ import annotations

import asyncio
import json as _json
import logging
import re
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agents.router import RouterAgent
from agents.village_code import VillageCodeAgent
from agents.permit import PermitAgent
from agents.community import CommunityAgent
from agents.vision import VisionAgent
from agents.report import ReportAgent
from agents.planner import PlannerAgent
from agents.critic import CriticAgent
from agents.base import AgentResponse
from debug.memory import debug_memory
from knowledge.registry import async_lookup_and_format as registry_lookup
from config import settings
from api.deps import get_optional_user
from api.tier import resolve_tier, get_tier_features
from api.aio import run_sync
from db import (
    add_message,
    get_messages,
    get_conversation,
    update_conversation_title,
    create_conversation,
    get_or_create_usage,
    increment_usage,
    claim_extended_trial,
    get_published_user_guides,
)
from cache.redis_client import redis_get, redis_set, redis_delete

logger = logging.getLogger(__name__)

router = APIRouter()

_GUIDE_CATALOG_CACHE_KEY = "chat:guide_catalog"
_GUIDE_CATALOG_TTL = 86400  # 24 hours — invalidated on publish/update


def _build_guide_summaries() -> list[dict]:
    """Fetch published guides from DB and build compact summaries."""
    rows = get_published_user_guides()
    summaries = []
    for row in rows:
        gd = row.get("guide_data", {})
        title = gd.get("title", "")
        if isinstance(title, dict):
            title = title.get("en", "")
        desc = gd.get("description", "")
        if isinstance(desc, dict):
            desc = desc.get("en", "")
        steps = gd.get("steps", [])
        step_titles = []
        for s in steps:
            st = s.get("title", "")
            if isinstance(st, dict):
                st = st.get("en", "")
            if st:
                step_titles.append(st)
        summaries.append({
            "id": row["id"],
            "title": title,
            "description": desc,
            "icon": gd.get("icon", ""),
            "color": gd.get("color", "#6B8F71"),
            "step_count": len(steps),
            "steps": step_titles,
        })
    return summaries


def _fetch_guide_catalog() -> list[dict]:
    """Fetch published guide summaries, Redis-cached for 24h."""
    cached = redis_get(_GUIDE_CATALOG_CACHE_KEY)
    if cached:
        return cached.get("guides", [])

    summaries = _build_guide_summaries()
    redis_set(_GUIDE_CATALOG_CACHE_KEY, {"guides": summaries}, ttl=_GUIDE_CATALOG_TTL)
    return summaries


def invalidate_guide_catalog_cache() -> None:
    """Write-through: rebuild and re-cache immediately so the next chat request is fast."""
    summaries = _build_guide_summaries()
    redis_set(_GUIDE_CATALOG_CACHE_KEY, {"guides": summaries}, ttl=_GUIDE_CATALOG_TTL)


async def _enforce_tier(request: "ChatRequest", user: dict | None, session_id: str | None) -> dict | None:
    """Apply tier-based limits. Returns an error dict if blocked, None if allowed.

    Also mutates request to server-enforce fast_mode and web_search.
    """
    tier = resolve_tier(user)
    features = get_tier_features(tier)

    # Server-override client toggles
    if features["fast_mode_forced"]:
        request.fast_mode = True
    if not features["web_search"]:
        request.web_search = False

    # Anonymous usage limits
    if tier == "anonymous":
        if not session_id:
            return {"code": "missing_session", "message": "Session ID required"}

        usage = await run_sync(get_or_create_usage, session_id)
        query_count = usage["query_count"]
        initial = settings.anon_initial_queries
        extended = settings.anon_extended_queries

        if usage["extended_trial"]:
            limit = initial + extended
        else:
            limit = initial

        if query_count >= limit:
            if not usage["extended_trial"]:
                return {"code": "trial_exhausted", "message": "Guest queries used up. Get 10 more or sign in for unlimited community access."}
            else:
                return {"code": "must_sign_in", "message": "Guest queries used up. Sign in with Google for unlimited community access."}

        # Increment usage count
        await run_sync(increment_usage, session_id)
    elif user and session_id:
        # Track usage for logged-in users too (analytics)
        await run_sync(get_or_create_usage, session_id, user_id=user["id"])
        await run_sync(increment_usage, session_id)

    return None

# Pre-instantiate agents (they are stateless, safe to reuse)
_router_agent = RouterAgent()
_planner_agent = PlannerAgent()
_critic_agent = CriticAgent()
_agents: dict[str, Any] = {
    "village_code": VillageCodeAgent(),
    "permit": PermitAgent(),
    "community": CommunityAgent(),
    "vision": VisionAgent(),
    "report": ReportAgent(),
}


class ChatRequest(BaseModel):
    message: str
    village: str = ""
    image_base64: str | None = None
    image_mime: str = "image/jpeg"
    history: list[dict] = Field(default_factory=list)
    debug: bool = False
    conversation_id: str | None = None
    web_search: bool = True
    fast_mode: bool = False
    language: str = "en"  # "en" or "zh"
    skip_playbooks: bool = False


class ChatResponse(BaseModel):
    response: str
    sources: list[dict] = Field(default_factory=list)
    agent_used: str = ""
    pipeline_debug: dict = Field(default_factory=dict)  # Pipeline visibility
    conversation_id: str | None = None


async def _load_db_history(conversation_id: str) -> list[dict]:
    """Load chat history from DB for a conversation."""
    msgs = await run_sync(get_messages, conversation_id)
    return [{"role": m["role"], "content": m["content"]} for m in msgs]


async def _auto_title(conversation_id: str, message: str):
    """Set conversation title from first user message."""
    convo = await run_sync(get_conversation, conversation_id)
    if convo and convo["title"] == "New conversation":
        title = message[:50].strip()
        if len(message) > 50:
            title += "..."
        await run_sync(update_conversation_title, conversation_id, title)


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    user: dict | None = Depends(get_optional_user),
    x_session_id: str | None = Header(default=None),
) -> ChatResponse:
    """Main chat endpoint. Routes through RouterAgent then to a specialist."""
    try:
        # Stash session_id for metrics
        request._session_id = x_session_id or ""

        # Tier enforcement
        block = await _enforce_tier(request, user, x_session_id)
        if block:
            return ChatResponse(response=block["message"], sources=[], agent_used="tier_gate")

        # If authenticated with conversation_id, load history from DB
        if user and request.conversation_id:
            convo = await run_sync(get_conversation, request.conversation_id)
            if convo and convo["user_id"] == user["id"]:
                request.history = await _load_db_history(request.conversation_id)
                await run_sync(add_message, request.conversation_id, "user", request.message, request.image_base64)
                await _auto_title(request.conversation_id, request.message)
        elif user and not request.conversation_id:
            # Auto-create conversation
            convo = await run_sync(create_conversation, user["id"], request.village, request.message[:50] or "New conversation")
            request.conversation_id = convo["id"]
            await run_sync(add_message, request.conversation_id, "user", request.message, request.image_base64)

        result = await _handle_chat(request)
        result.conversation_id = request.conversation_id

        # Save assistant response
        if user and request.conversation_id:
            await run_sync(
                add_message,
                request.conversation_id, "assistant", result.response,
                sources=result.sources if result.sources else None,
                agent_used=result.agent_used,
            )

        return result
    except Exception as e:
        logger.exception("Chat error")
        return ChatResponse(
            response=_friendly_error(e),
            sources=[],
            agent_used="error",
            conversation_id=request.conversation_id,
        )


@router.post("/chat/stream")
async def chat_stream(
    request: ChatRequest,
    user: dict | None = Depends(get_optional_user),
    x_session_id: str | None = Header(default=None),
):
    """Streaming chat endpoint. Emits SSE events for each pipeline step."""
    # Tier enforcement
    block = await _enforce_tier(request, user, x_session_id)
    if block:
        async def _blocked_stream():
            yield _sse_event("error", {"message": block["message"], "code": block["code"]})
        return StreamingResponse(
            _blocked_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # If authenticated with conversation_id, load history from DB and save user message
    if user and request.conversation_id:
        convo = await run_sync(get_conversation, request.conversation_id)
        if convo and convo["user_id"] == user["id"]:
            request.history = await _load_db_history(request.conversation_id)
            await run_sync(add_message, request.conversation_id, "user", request.message, request.image_base64)
            await _auto_title(request.conversation_id, request.message)
    elif user and not request.conversation_id:
        convo = await run_sync(create_conversation, user["id"], request.village, request.message[:50] or "New conversation")
        request.conversation_id = convo["id"]
        await run_sync(add_message, request.conversation_id, "user", request.message, request.image_base64)

    # Stash session_id on request for metrics context
    request._session_id = x_session_id or ""
    return StreamingResponse(
        _handle_chat_stream(request, user=user),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _sse_event(event_type: str, data: dict) -> str:
    """Format a single SSE event."""
    return f"event: {event_type}\ndata: {_json.dumps(data)}\n\n"


def _friendly_error(e: Exception) -> str:
    """Convert raw exceptions into user-friendly messages."""
    err = str(e).lower()
    if "overloaded" in err or "529" in err:
        return "Our AI service is temporarily overloaded. Please try again in a minute."
    if "rate" in err and "limit" in err:
        return "We're receiving too many requests right now. Please wait a moment and try again."
    if "timeout" in err:
        return "The request timed out. Please try again."
    if "authentication" in err or "401" in err or "api key" in err:
        return "There's a configuration issue on our end. Please try again later."
    if "connection" in err or "network" in err:
        return "Unable to reach our AI service. Please check your connection and try again."
    return "Something went wrong. Please try again in a moment."






async def _handle_chat_stream(request: ChatRequest, user: dict | None = None) -> AsyncGenerator[str, None]:
    """Stream pipeline events as SSE."""
    import time as _time
    from tools.budget import set_budget
    from llm.presets import set_fast_mode
    from metrics.collector import set_request_context, set_source, record_pipeline_event
    set_budget(enabled=request.web_search)
    set_fast_mode(request.fast_mode)
    set_request_context(
        session_id=getattr(request, '_session_id', ''),
        conversation_id=request.conversation_id or '',
    )
    set_source("user")

    # ── Cache: skip for images and follow-up questions (history means context-dependent) ──
    _is_cacheable = not request.image_base64 and len(request.history) == 0

    # Pre-compute embedding once for reuse across semantic cache + RAG searches
    _query_embedding = None
    if _is_cacheable or not request.image_base64:
        from rag.store import embed_query
        _query_embedding = await run_sync(embed_query, request.message)

    if _is_cacheable:
        # 1) Event response cache (exact match by event ID, Redis-backed)
        from cache.events import get_cached_event_response
        cached = await run_sync(get_cached_event_response, request.message, request.language)
        if cached:
            record_pipeline_event("cache_hit", "event_cache")
            if user and request.conversation_id:
                await run_sync(add_message, request.conversation_id, "user", request.message)
                await run_sync(
                    add_message,
                    request.conversation_id, "assistant", cached["response"],
                    sources=cached["sources"] if cached["sources"] else None,
                    agent_used=cached["agent_used"],
                )
            yield _sse_event("step", {"stage": "router", "status": "done", "label": "Looking into it"})
            yield _sse_event("step", {"stage": "specialist", "status": "done", "label": "Found answer"})
            yield _sse_event("response", {
                "response": cached["response"],
                "sources": cached["sources"],
                "agent_used": cached["agent_used"],
                "conversation_id": request.conversation_id,
            })
            return

        # 2) Semantic response cache (paraphrase-aware, ChromaDB + Redis)
        from cache import semantic as semantic_cache
        sem_cached = await run_sync(
            semantic_cache.get, request.message, request.village, request.language,
            fast_mode=request.fast_mode, web_search=request.web_search,
            query_embedding=_query_embedding,
        )
        if sem_cached:
            record_pipeline_event("cache_hit", "semantic_cache")
            if user and request.conversation_id:
                await run_sync(
                    add_message,
                    request.conversation_id, "assistant", sem_cached["response"],
                    sources=sem_cached.get("sources") or None,
                    agent_used=sem_cached.get("agent_used", "cached"),
                )
            yield _sse_event("step", {"stage": "router", "status": "done", "label": "Looking into it"})
            yield _sse_event("step", {"stage": "specialist", "status": "done", "label": "Found answer"})
            yield _sse_event("response", {
                **sem_cached,
                "conversation_id": request.conversation_id,
            })
            return

        record_pipeline_event("cache_miss", "all_caches")

    context: dict[str, Any] = {
        "village": request.village,
        "history": request.history,
        "language": request.language,
    }

    # Inject playbook catalog so specialist can suggest relevant guides
    if not request.skip_playbooks:
        guide_catalog = await run_sync(_fetch_guide_catalog)
        if guide_catalog:
            context["playbook_catalog"] = guide_catalog

    # If an image is provided, add it to context for VisionAgent
    if request.image_base64:
        context["image_base64"] = request.image_base64
        context["image_mime"] = request.image_mime

    # Only allow debug events for users with debug permission
    has_debug_perm = bool(user and (user.get("is_admin") or user.get("can_debug")))
    is_debug = request.debug and has_debug_perm

    try:
        # ── Vision pipeline (image provided) ──
        if request.image_base64:
            yield _sse_event("step", {"stage": "vision", "status": "running", "label": "Analyzing image..."})
            vision_agent = _agents["vision"]
            vision_response: AgentResponse = await vision_agent.run(
                request.message, context=context
            )
            yield _sse_event("step", {"stage": "vision", "status": "done", "label": "Image analyzed"})

            # If there's also a text query, route it and combine with vision
            if request.message.strip():
                yield _sse_event("step", {"stage": "router", "status": "running", "label": "On it"})
                routing = await _router_agent.run(request.message, context=context)
                agent_name = routing.get("agent", "general")
                refined_query = routing.get("refined_query", request.message)
                yield _sse_event("step", {"stage": "router", "status": "done", "label": "Looking into it"})

                if agent_name in _agents and agent_name != "vision" and agent_name != "off_topic":
                    # Run specialist with vision analysis injected into history
                    vision_context = dict(context)
                    vision_context["history"] = context["history"] + [
                        {"role": "assistant", "content": f"[Vision Analysis]\n{vision_response.content}"},
                    ]
                    if agent_name == "general" or agent_name not in _agents:
                        specialist = _agents["community"]
                        agent_name = "community"
                    else:
                        specialist = _agents[agent_name]

                    yield _sse_event("step", {"stage": "specialist", "status": "running", "label": "Searching..."})
                    specialist_response: AgentResponse = await specialist.run(
                        refined_query, context=vision_context
                    )
                    yield _sse_event("step", {"stage": "specialist", "status": "done", "label": "Search complete"})

                    combined = (
                        f"**Image Analysis:**\n{vision_response.content}\n\n"
                        f"**Detailed Answer:**\n{specialist_response.content}"
                    )
                    sources = _extract_sources(specialist_response)
                    used = f"vision+{agent_name}"
                else:
                    combined = vision_response.content
                    sources = []
                    used = "vision"
            else:
                combined = vision_response.content
                sources = []
                used = "vision"

            # Save to DB
            if user and request.conversation_id:
                await run_sync(
                    add_message,
                    request.conversation_id, "assistant", combined,
                    sources=sources if sources else None,
                    agent_used=used,
                )

            yield _sse_event("response", {
                "response": combined,
                "sources": sources,
                "agent_used": used,
                "conversation_id": request.conversation_id,
            })
            return

        # Inject debug memory instructions into context if available
        debug_instructions = debug_memory.get_active_instructions()
        if debug_instructions:
            context["debug_instructions"] = debug_instructions

        # Check internal registry for known answers (saves search costs)
        registry_context = await registry_lookup(request.message, request.village)
        if registry_context:
            context["registry_context"] = registry_context
            if is_debug:
                yield _sse_event("debug", {
                    "stage": "registry",
                    "data": {"matched": True, "context_length": len(registry_context)},
                })

        # Step 1: Router + RAG in parallel
        yield _sse_event("step", {"stage": "router", "status": "running", "label": "On it"})

        from rag.store import KnowledgeStore
        _rag_store = KnowledgeStore()

        # Run router and RAG searches concurrently (saves ~1s)
        _t_router = _time.monotonic()
        router_coro = _router_agent.run(request.message, context=context)
        rag_coro = run_sync(_rag_store.search, request.message, village=request.village or None, n_results=3, query_embedding=_query_embedding)
        shared_rag_coro = run_sync(_rag_store.search, request.message, village=None, n_results=3, query_embedding=_query_embedding)

        routing, rag_results, shared_results = await asyncio.gather(
            router_coro, rag_coro, shared_rag_coro
        )
        _dur_router = int((_time.monotonic() - _t_router) * 1000)

        agent_name = routing.get("agent", "general")
        refined_query = routing.get("refined_query", request.message)

        record_pipeline_event("pipeline_stage", "router", duration_ms=_dur_router)
        record_pipeline_event("agent_selected", agent_name, metadata={"refined_query": refined_query[:200]})

        yield _sse_event("step", {
            "stage": "router", "status": "done",
            "label": "Looking into it",
            "detail": f"Routed to {agent_name}" if is_debug else None,
        })
        if is_debug:
            yield _sse_event("debug", {"stage": "router", "data": routing})

        if agent_name == "off_topic":
            off_topic_resp = _build_off_topic_response()
            if user and request.conversation_id:
                await run_sync(add_message, request.conversation_id, "assistant", off_topic_resp, agent_used="router")
            yield _sse_event("response", {
                "response": off_topic_resp,
                "sources": [],
                "agent_used": "router",
                "conversation_id": request.conversation_id,
            })
            return

        if agent_name == "general" or agent_name not in _agents:
            agent = _agents["community"]
            agent_name = "community"
        else:
            agent = _agents[agent_name]

        # RAG results already fetched in parallel above
        all_rag = rag_results + shared_results
        # Filter by relevance
        all_rag = [r for r in all_rag if (r.get("distance") or 0) <= 1.2]
        if all_rag:
            rag_context_parts = []
            for r in all_rag:
                meta = r.get("metadata", {})
                src = meta.get("source", "")
                rag_context_parts.append(f"[{src}] {r['text'][:500]}")
            context["rag_baseline"] = (
                "## Pre-loaded Knowledge (from local knowledge base)\n"
                "Use this as baseline context. You may still call search tools for more detail.\n\n"
                + "\n\n---\n\n".join(rag_context_parts)
            )

        # Step 2: Planner with streaming preview
        # Skip planner for simple community queries (saves ~3.7s avg)
        # Never skip for permit/village_code — they need structured search plans for quality
        skip_planner = (
            agent_name == "community" and (request.fast_mode or len(request.message) < 60)
        )
        search_plan_text = None
        specialist_model_role = None
        _t_planner = _time.monotonic()

        # Bridge planner preview tokens → SSE stream via queue
        _preview_queue: asyncio.Queue[str | None] = asyncio.Queue()

        async def _on_preview_token(text: str):
            await _preview_queue.put(text)

        plan = None
        if skip_planner:
            _dur_planner = 0
            record_pipeline_event("pipeline_stage", "planner", duration_ms=0, metadata={"complexity": "skipped_fast"})
        else:
            async def _run_planner():
                try:
                    return await _planner_agent.run(
                        refined_query,
                        village=request.village,
                        agent_type=agent_name,
                        on_preview_token=_on_preview_token,
                    )
                finally:
                    await _preview_queue.put(None)  # sentinel

            planner_task = asyncio.create_task(_run_planner())

            # Stream preview tokens to user while planner runs
            while True:
                chunk = await _preview_queue.get()
                if chunk is None:
                    break
                yield _sse_event("token", {"text": chunk, "preview": True})

            plan = await planner_task
            _dur_planner = int((_time.monotonic() - _t_planner) * 1000)
            record_pipeline_event(
                "pipeline_stage", "planner", duration_ms=_dur_planner,
                metadata={"complexity": plan.complexity if plan else "skipped"},
            )

            # Signal frontend to clear preview text before specialist streams real answer
            yield _sse_event("clear_tokens", {})

        if plan:
            search_plan_text = plan.raw_text
            if plan.complexity != "high":
                specialist_model_role = "specialist"

            yield _sse_event("step", {
                "stage": "planner", "status": "done",
                "label": "Planned search",
                "detail": f"Plan: {plan.project_type} ({plan.complexity})" if is_debug else None,
                "plan": {
                    "steps": [{"tool": s.tool, "query": s.query} for s in plan.steps],
                    "web_fallbacks": plan.web_fallback_queries,
                    "model": specialist_model_role or "reasoning",
                } if is_debug else None,
            })
        else:
            yield _sse_event("step", {"stage": "planner", "status": "skipped", "label": "Let me find that"})

        if is_debug:
            yield _sse_event("debug", {
                "stage": "model_selection",
                "data": {
                    "specialist_model": specialist_model_role or "reasoning",
                    "complexity": plan.complexity if plan else "n/a",
                    "debug_instructions_injected": bool(debug_instructions),
                },
            })

        # Step 3: Specialist with tool call + token streaming
        model_label = "Sonnet" if specialist_model_role == "specialist" else "Opus"
        yield _sse_event("step", {"stage": "specialist", "status": "running", "label": "Searching..."})

        # Use a queue to bridge BaseAgent events → SSE stream
        # Events are: ("tool_event", dict), ("token", str), ("done", content, calls)
        stream_queue: asyncio.Queue[tuple | None] = asyncio.Queue()

        async def emit_tool_event(event: dict):
            await stream_queue.put(("tool_event", event))

        agent_content = ""
        agent_calls: list[dict] = []

        _t_specialist = _time.monotonic()

        async def run_specialist():
            try:
                async for item in agent.run_streaming(
                    refined_query,
                    context=context,
                    search_plan=search_plan_text,
                    model_role_override=specialist_model_role,
                    on_event=emit_tool_event,
                ):
                    await stream_queue.put(item)
            except Exception:
                logger.exception("Specialist streaming failed")
            finally:
                await stream_queue.put(None)  # sentinel always sent

        task = asyncio.create_task(run_specialist())

        # Yield tool events and tokens as they stream in
        while True:
            item = await stream_queue.get()
            if item is None:
                break
            if item[0] == "tool_event":
                yield _sse_event("tool", item[1])
            elif item[0] == "token":
                yield _sse_event("token", {"text": item[1]})
            elif item[0] == "done":
                agent_content = item[1]
                agent_calls = item[2]

        await task  # ensure no exceptions are lost
        _dur_specialist = int((_time.monotonic() - _t_specialist) * 1000)
        record_pipeline_event(
            "pipeline_stage", "specialist", duration_ms=_dur_specialist,
            metadata={"agent": agent_name, "tool_calls": len(agent_calls), "model": model_label},
        )

        # Build an AgentResponse for downstream compatibility
        agent_response = AgentResponse(
            content=agent_content,
            tool_calls_made=agent_calls,
        )

        tool_count = len(agent_response.tool_calls_made)
        yield _sse_event("step", {
            "stage": "specialist", "status": "done",
            "label": "Search complete" if not is_debug else f"Completed ({tool_count} tool calls)",
        })

        # Step 4: Critic — only for permit/village_code where accuracy is critical
        # Community, general, report, off_topic don't need a second LLM review
        skip_critic = agent_name not in ("permit", "village_code") or request.fast_mode
        if not skip_critic:
            yield _sse_event("step", {"stage": "critic", "status": "running", "label": "Reviewing answer..."})
            _t_critic = _time.monotonic()
            verdict = await _critic_agent.run(
                original_query=request.message,
                draft_response=agent_response.content,
                tool_calls_made=agent_response.tool_calls_made,
                village=request.village,
            )
            _dur_critic = int((_time.monotonic() - _t_critic) * 1000)
            record_pipeline_event(
                "pipeline_stage", "critic", duration_ms=_dur_critic,
                metadata={"decision": verdict.decision, "confidence": verdict.confidence},
            )
            yield _sse_event("step", {
                "stage": "critic", "status": "done",
                "label": "Reviewed" if not is_debug else f"Verdict: {verdict.decision} ({verdict.confidence:.0%})",
                "detail": (verdict.feedback[:200] if verdict.feedback else "") if is_debug else None,
            })
            if is_debug:
                yield _sse_event("debug", {
                    "stage": "critic",
                    "data": {
                        "decision": verdict.decision,
                        "confidence": verdict.confidence,
                        "feedback": verdict.feedback,
                    },
                })

            if verdict.decision == "retry":
                yield _sse_event("step", {"stage": "retry", "status": "running", "label": "Improving answer..."})

                # Retry with streaming queue pattern
                retry_queue: asyncio.Queue[tuple | None] = asyncio.Queue()

                async def emit_retry_event(event: dict):
                    await retry_queue.put(("tool_event", event))

                retry_content = ""
                retry_calls: list[dict] = []

                async def run_retry():
                    async for item in agent.run_streaming(
                        refined_query,
                        context=context,
                        search_plan=search_plan_text,
                        critic_feedback=verdict.feedback,
                        model_role_override=None,
                        on_event=emit_retry_event,
                    ):
                        await retry_queue.put(item)
                    await retry_queue.put(None)

                retry_task = asyncio.create_task(run_retry())
                while True:
                    item = await retry_queue.get()
                    if item is None:
                        break
                    if item[0] == "tool_event":
                        yield _sse_event("tool", {**item[1], "retry": True})
                    elif item[0] == "token":
                        yield _sse_event("token", {"text": item[1]})
                    elif item[0] == "done":
                        retry_content = item[1]
                        retry_calls = item[2]

                await retry_task
                agent_response = AgentResponse(
                    content=retry_content,
                    tool_calls_made=retry_calls,
                )

                yield _sse_event("step", {"stage": "retry", "status": "done", "label": "Answer improved"})

                # Second critic
                yield _sse_event("step", {"stage": "critic2", "status": "running", "label": "Final review..."})
                verdict = await _critic_agent.run(
                    original_query=request.message,
                    draft_response=agent_response.content,
                    tool_calls_made=agent_response.tool_calls_made,
                    is_retry=True,
                )
                yield _sse_event("step", {
                    "stage": "critic2", "status": "done",
                    "label": "Verified" if not is_debug else f"Final verdict: {verdict.decision} ({verdict.confidence:.0%})",
                })

            if verdict.decision == "insufficient":
                insufficient_resp = _build_insufficient_response(request.message, request.village)
                if user and request.conversation_id:
                    await run_sync(add_message, request.conversation_id, "assistant", insufficient_resp, agent_used=agent_name)
                yield _sse_event("response", {
                    "response": insufficient_resp,
                    "sources": [],
                    "agent_used": agent_name,
                    "conversation_id": request.conversation_id,
                })
                return

        # Final response
        sources = _extract_sources(agent_response)

        # Save assistant response to DB
        if user and request.conversation_id:
            await run_sync(
                add_message,
                request.conversation_id, "assistant", agent_response.content,
                sources=sources if sources else None,
                agent_used=agent_name,
            )

        # Cache event detail responses for subsequent clicks (Redis-backed)
        from cache.events import cache_event_response
        await run_sync(cache_event_response, request.message, request.language, agent_response.content, sources, agent_name)

        # Store in semantic cache for future paraphrase hits
        if _is_cacheable:
            from cache import semantic as semantic_cache
            _sem_data = {"response": agent_response.content, "sources": sources, "agent_used": agent_name}
            await run_sync(
                semantic_cache.put, request.message, request.village, request.language, _sem_data,
                fast_mode=request.fast_mode, web_search=request.web_search,
            )

        yield _sse_event("response", {
            "response": agent_response.content,
            "sources": sources,
            "agent_used": agent_name,
            "conversation_id": request.conversation_id,
        })

    except Exception as e:
        logger.exception("Stream error")
        yield _sse_event("error", {"message": _friendly_error(e)})


async def _handle_chat(request: ChatRequest) -> ChatResponse:
    import time as _time
    from tools.budget import set_budget
    from llm.presets import set_fast_mode
    from metrics.collector import set_request_context, set_source, record_pipeline_event
    set_budget(enabled=request.web_search)
    set_fast_mode(request.fast_mode)
    set_request_context(
        session_id=getattr(request, '_session_id', ''),
        conversation_id=request.conversation_id or '',
    )
    set_source("user")

    # Semantic cache check (skip for images and follow-up questions with history)
    _is_cacheable = not request.image_base64 and len(request.history) == 0
    if _is_cacheable:
        from cache import semantic as semantic_cache
        sem_cached = await run_sync(
            semantic_cache.get, request.message, request.village, request.language,
            fast_mode=request.fast_mode, web_search=request.web_search,
        )
        if sem_cached:
            record_pipeline_event("cache_hit", "semantic_cache")
            return ChatResponse(
                response=sem_cached["response"],
                sources=sem_cached.get("sources", []),
                agent_used=sem_cached.get("agent_used", "cached"),
            )
        record_pipeline_event("cache_miss", "all_caches")

    context: dict[str, Any] = {
        "village": request.village,
        "history": request.history,
        "language": request.language,
    }

    # Inject playbook catalog so specialist can suggest relevant guides
    if not request.skip_playbooks:
        guide_catalog = await run_sync(_fetch_guide_catalog)
        if guide_catalog:
            context["playbook_catalog"] = guide_catalog

    # Check internal registry for known answers
    reg_ctx = await registry_lookup(request.message, request.village)
    if reg_ctx:
        context["registry_context"] = reg_ctx

    # If an image is provided, route through VisionAgent first
    if request.image_base64:
        context["image_base64"] = request.image_base64
        context["image_mime"] = request.image_mime
        vision_agent = _agents["vision"]
        vision_response: AgentResponse = await vision_agent.run(
            request.message, context=context
        )

        # If there is also a text query, route it through the normal pipeline
        # and combine the vision analysis with the specialist answer
        if request.message.strip():
            routing = await _router_agent.run(request.message, context=context)
            agent_name = routing.get("agent", "general")
            refined_query = routing.get("refined_query", request.message)

            if agent_name in _agents and agent_name != "vision":
                # Add vision analysis to context for the specialist
                vision_context = dict(context)
                vision_context["history"] = context["history"] + [
                    {"role": "assistant", "content": f"[Vision Analysis]\n{vision_response.content}"},
                ]
                specialist = _agents[agent_name]
                specialist_response: AgentResponse = await specialist.run(
                    refined_query, context=vision_context
                )
                combined = (
                    f"**Image Analysis:**\n{vision_response.content}\n\n"
                    f"**Detailed Answer:**\n{specialist_response.content}"
                )
                return ChatResponse(
                    response=combined,
                    sources=_extract_sources(specialist_response),
                    agent_used=f"vision+{agent_name}",
                )

        return ChatResponse(
            response=vision_response.content,
            sources=[],
            agent_used="vision",
        )

    # Standard text-only flow: Router → Planner → Specialist → Critic
    debug: dict[str, Any] = {}

    # Router
    _t_router = _time.monotonic()
    routing = await _router_agent.run(request.message, context=context)
    _dur_router = int((_time.monotonic() - _t_router) * 1000)
    agent_name = routing.get("agent", "general")
    refined_query = routing.get("refined_query", request.message)
    debug["router"] = {"agent": agent_name, "refined_query": refined_query}

    record_pipeline_event("pipeline_stage", "router", duration_ms=_dur_router)
    record_pipeline_event("agent_selected", agent_name, metadata={"refined_query": refined_query[:200]})

    logger.info(f"Routed to '{agent_name}' with query: {refined_query[:100]}")

    if agent_name == "off_topic":
        return ChatResponse(
            response=_build_off_topic_response(),
            sources=[],
            agent_used="router",
            pipeline_debug=debug,
        )

    if agent_name == "general" or agent_name not in _agents:
        agent = _agents["community"]
        agent_name = "community"
    else:
        agent = _agents[agent_name]

    # Step 1: Generate search plan (skipped for community/simple queries)
    search_plan_text = None
    specialist_model_role = None  # None = use agent's default (reasoning/Opus)
    _t_planner = _time.monotonic()
    plan = await _planner_agent.run(
        refined_query,
        village=request.village,
        agent_type=agent_name,
    )
    _dur_planner = int((_time.monotonic() - _t_planner) * 1000)
    record_pipeline_event(
        "pipeline_stage", "planner", duration_ms=_dur_planner,
        metadata={"complexity": plan.complexity if plan else "skipped"},
    )
    if plan:
        search_plan_text = plan.raw_text
        logger.info(f"Search plan generated for '{plan.project_type}' (complexity: {plan.complexity})")

        # Complexity-driven model selection:
        # - "high" → Opus (reasoning) — complex, multi-faceted queries
        # - "low"/"medium" → Sonnet (specialist) — well-defined tasks with a plan
        if plan.complexity != "high":
            specialist_model_role = "specialist"

        debug["planner"] = {
            "project_type": plan.project_type,
            "complexity": plan.complexity,
            "domains": plan.applicable_domains,
            "steps": [{"tool": s.tool, "query": s.query, "priority": s.priority} for s in plan.steps],
            "web_fallbacks": plan.web_fallback_queries,
            "specialist_model": specialist_model_role or "reasoning",
        }
    else:
        debug["planner"] = {"skipped": True}

    # Step 2: Run specialist with search plan context and appropriate model
    _t_specialist = _time.monotonic()
    agent_response: AgentResponse = await agent.run(
        refined_query,
        context=context,
        search_plan=search_plan_text,
        model_role_override=specialist_model_role,
    )
    _dur_specialist = int((_time.monotonic() - _t_specialist) * 1000)
    record_pipeline_event(
        "pipeline_stage", "specialist", duration_ms=_dur_specialist,
        metadata={"agent": agent_name, "tool_calls": len(agent_response.tool_calls_made)},
    )

    debug["specialist"] = {
        "tool_calls": [
            {"tool": tc["tool"], "args": tc["args"]}
            for tc in agent_response.tool_calls_made
        ],
        "model_role": specialist_model_role or "reasoning",
    }

    # Step 3: Critic validation (skip for simple community queries without a plan)
    skip_critic = (agent_name == "community" and not plan) or agent_name == "report"
    if not skip_critic:
        _t_critic = _time.monotonic()
        verdict = await _critic_agent.run(
            original_query=request.message,
            draft_response=agent_response.content,
            tool_calls_made=agent_response.tool_calls_made,
        )
        _dur_critic = int((_time.monotonic() - _t_critic) * 1000)
        record_pipeline_event(
            "pipeline_stage", "critic", duration_ms=_dur_critic,
            metadata={"decision": verdict.decision, "confidence": verdict.confidence},
        )
        debug["critic_pass1"] = {
            "decision": verdict.decision,
            "confidence": verdict.confidence,
            "feedback": verdict.feedback,
        }

        if verdict.decision == "retry":
            # Re-run specialist with critic feedback (one retry max)
            # Retry always uses Opus — if the first attempt wasn't good enough,
            # escalate to the best model
            logger.info(f"Critic requested retry: {verdict.feedback[:100]}")
            agent_response = await agent.run(
                refined_query,
                context=context,
                search_plan=search_plan_text,
                critic_feedback=verdict.feedback,
                model_role_override=None,  # Opus (agent default)
            )
            debug["specialist_retry"] = {
                "tool_calls": [
                    {"tool": tc["tool"], "args": tc["args"]}
                    for tc in agent_response.tool_calls_made
                ],
                "model_role": "reasoning",
            }

            # Second critic pass — only accept or insufficient
            verdict = await _critic_agent.run(
                original_query=request.message,
                draft_response=agent_response.content,
                tool_calls_made=agent_response.tool_calls_made,
                is_retry=True,
                village=request.village,
            )
            debug["critic_pass2"] = {
                "decision": verdict.decision,
                "confidence": verdict.confidence,
                "feedback": verdict.feedback,
            }

        if verdict.decision == "insufficient":
            return ChatResponse(
                response=_build_insufficient_response(request.message, request.village),
                sources=[],
                agent_used=agent_name,
                pipeline_debug=debug,
            )

    result = ChatResponse(
        response=agent_response.content,
        sources=_extract_sources(agent_response),
        agent_used=agent_name,
        pipeline_debug=debug,
    )

    # Store in semantic cache
    if _is_cacheable:
        from cache import semantic as semantic_cache
        _sem_data = {"response": result.response, "sources": result.sources, "agent_used": result.agent_used}
        await run_sync(
            semantic_cache.put, request.message, request.village, request.language, _sem_data,
            fast_mode=request.fast_mode, web_search=request.web_search,
        )

    return result


@router.post("/chat/extend-trial")
async def extend_trial(x_session_id: str = Header(...)):
    """One-click extended trial for anonymous users."""
    success = await run_sync(claim_extended_trial, x_session_id)
    if not success:
        return {"ok": False, "message": "Already extended or session not found"}
    return {"ok": True, "message": "Extended trial activated"}


@router.get("/chat/usage")
async def get_usage(
    user: dict | None = Depends(get_optional_user),
    x_session_id: str | None = Header(default=None),
):
    """Return tier, features, and usage info for the current session."""
    tier = resolve_tier(user)
    features = get_tier_features(tier)

    result = {
        "tier": tier,
        "features": features,
        "queries_used": 0,
        "queries_remaining": None,
    }

    session_id = x_session_id
    if user:
        session_id = f"user:{user['id']}" if not session_id else session_id

        # Add promo info
        if tier == "free_promo" and user.get("promo_expires_at"):
            result["promo_expires_at"] = user["promo_expires_at"]

    if session_id:
        usage = await run_sync(get_or_create_usage, session_id, user_id=user["id"] if user else None)
        result["queries_used"] = usage["query_count"]

        if tier == "anonymous":
            initial = settings.anon_initial_queries
            extended = settings.anon_extended_queries
            limit = (initial + extended) if usage["extended_trial"] else initial
            result["queries_remaining"] = max(0, limit - usage["query_count"])
            result["extended_trial"] = bool(usage["extended_trial"])

    return result


def _build_off_topic_response() -> str:
    """Polite redirect for queries unrelated to Great Neck / local community."""
    return (
        "I'm **GreatNeck.ai**, a community assistant specifically for the Great Neck area. "
        "I can help with:\n\n"
        "- **Village codes & zoning** — setbacks, FAR, noise ordinances\n"
        "- **Permits** — building permits, applications, inspections\n"
        "- **Community info** — schools, parks, libraries, local events, restaurants\n\n"
        "Your question seems outside that scope. "
        "How can I help with something local?"
    )


def _build_insufficient_response(query: str, village: str) -> str:
    """Generate an honest 'I don't have this data' response with contact info."""
    village_name = village or "your village"
    return (
        f"I wasn't able to find sufficient information to accurately answer your question "
        f"about **{query}** for {village_name}.\n\n"
        f"This may be because:\n"
        f"- The specific regulations haven't been added to our knowledge base yet\n"
        f"- The village may handle this through policies not captured in the village code\n\n"
        f"**I recommend contacting the village directly:**\n"
        f"- Call the **Building Department** for permit and construction questions\n"
        f"- Call the **Village Clerk's Office** for general regulatory questions\n"
        f"- Visit the village's official website for the most current information\n\n"
        f"_I'd rather point you to the right source than give you inaccurate information._"
    )


_HEADER_RE = re.compile(
    r"^\[(\d+)\]\s+(.+?)(?:\s+-\s+(.+?))?\s*(?:\(relevance:\s*([\d.]+)\))?$"
)

# Matches markdown links in web search results: - [Title](URL)
_WEB_LINK_RE = re.compile(r"^-\s*\[(.+?)\]\((.+?)\)$")


def _extract_sources(response: AgentResponse) -> list[dict]:
    """Extract source citations from tool calls made by the agent.

    Parses both local search results and web search results.

    Local search format:
        [1] Source Name - Section (relevance: 0.85)
        Text content here...

    Web search format:
        Summary: ...
        - [Title](URL)
          Content snippet...
    """
    sources: list[dict] = []
    seen: set[str] = set()

    for call in response.tool_calls_made:
        tool_name = call.get("tool", "")
        preview = call.get("result_preview", "")

        if tool_name == "web_search":
            _extract_web_sources(preview, sources, seen)
        elif tool_name in ("search_codes", "search_permits", "get_code_section", "search_community", "search_social"):
            _extract_local_sources(preview, sources, seen)

    return sources


def _extract_local_sources(
    preview: str, sources: list[dict], seen: set[str]
) -> None:
    """Parse local knowledge base search results."""
    blocks = preview.split("\n\n---\n\n")

    for block in blocks:
        block = block.strip()
        if not block:
            continue
        lines = block.split("\n")
        match = _HEADER_RE.match(lines[0].strip())
        if not match:
            continue

        source_name = match.group(2).strip()
        section = (match.group(3) or "").strip()
        relevance_str = match.group(4)

        url = ""
        text_start = 1
        if len(lines) > 1 and lines[1].startswith("url: "):
            url = lines[1][5:].strip()
            text_start = 2
        text = "\n".join(lines[text_start:]).strip()

        key = f"{source_name}:{section}"
        if key in seen:
            continue
        seen.add(key)

        entry: dict[str, Any] = {
            "text": text[:500],
            "source": source_name,
        }
        if section:
            entry["section"] = section
        if url:
            entry["url"] = url
        if relevance_str:
            entry["distance"] = round(1 - float(relevance_str), 3)
        sources.append(entry)


def _extract_web_sources(
    preview: str, sources: list[dict], seen: set[str]
) -> None:
    """Parse web search (Tavily) results.

    Format:
        Summary: some answer text

        - [Title](https://example.com)
          Snippet of content...

        - [Another Title](https://example2.com)
          Another snippet...
    """
    lines = preview.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        match = _WEB_LINK_RE.match(line)
        if match:
            title = match.group(1).strip()
            url = match.group(2).strip()

            # Collect the snippet text (indented lines following the link)
            snippet_lines = []
            i += 1
            while i < len(lines) and lines[i].startswith("  "):
                snippet_lines.append(lines[i].strip())
                i += 1

            if url in seen:
                continue
            seen.add(url)

            sources.append({
                "text": " ".join(snippet_lines)[:500] if snippet_lines else "",
                "source": title,
                "url": url,
                "section": "web",
            })
        else:
            i += 1
