"""Chat endpoint: routes queries through the agent pipeline."""
from __future__ import annotations

import asyncio
import json as _json
import logging
import re
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agents.router import RouterAgent
from agents.village_code import VillageCodeAgent
from agents.permit import PermitAgent
from agents.community import CommunityAgent
from agents.vision import VisionAgent
from agents.planner import PlannerAgent
from agents.critic import CriticAgent
from agents.base import AgentResponse
from debug.memory import debug_memory
from knowledge.registry import lookup_and_format as registry_lookup
from api.deps import get_optional_user
from db import (
    add_message,
    get_messages,
    get_conversation,
    update_conversation_title,
    create_conversation,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Pre-instantiate agents (they are stateless, safe to reuse)
_router_agent = RouterAgent()
_planner_agent = PlannerAgent()
_critic_agent = CriticAgent()
_agents: dict[str, Any] = {
    "village_code": VillageCodeAgent(),
    "permit": PermitAgent(),
    "community": CommunityAgent(),
    "vision": VisionAgent(),
}


class ChatRequest(BaseModel):
    message: str
    village: str = ""
    image_base64: str | None = None
    history: list[dict] = Field(default_factory=list)
    debug: bool = False
    conversation_id: str | None = None
    web_search_mode: str = "limited"  # "off", "limited", "unlimited"
    fast_mode: bool = False
    language: str = "en"  # "en" or "zh"


class ChatResponse(BaseModel):
    response: str
    sources: list[dict] = Field(default_factory=list)
    agent_used: str = ""
    pipeline_debug: dict = Field(default_factory=dict)  # Pipeline visibility
    conversation_id: str | None = None


def _load_db_history(conversation_id: str) -> list[dict]:
    """Load chat history from DB for a conversation."""
    msgs = get_messages(conversation_id)
    return [{"role": m["role"], "content": m["content"]} for m in msgs]


def _auto_title(conversation_id: str, message: str):
    """Set conversation title from first user message."""
    convo = get_conversation(conversation_id)
    if convo and convo["title"] == "New conversation":
        title = message[:50].strip()
        if len(message) > 50:
            title += "..."
        update_conversation_title(conversation_id, title)


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, user: dict | None = Depends(get_optional_user)) -> ChatResponse:
    """Main chat endpoint. Routes through RouterAgent then to a specialist."""
    try:
        # If authenticated with conversation_id, load history from DB
        if user and request.conversation_id:
            convo = get_conversation(request.conversation_id)
            if convo and convo["user_id"] == user["id"]:
                request.history = _load_db_history(request.conversation_id)
                add_message(request.conversation_id, "user", request.message, request.image_base64)
                _auto_title(request.conversation_id, request.message)
        elif user and not request.conversation_id:
            # Auto-create conversation
            convo = create_conversation(user["id"], request.village, request.message[:50] or "New conversation")
            request.conversation_id = convo["id"]
            add_message(request.conversation_id, "user", request.message, request.image_base64)

        result = await _handle_chat(request)
        result.conversation_id = request.conversation_id

        # Save assistant response
        if user and request.conversation_id:
            add_message(
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
async def chat_stream(request: ChatRequest, user: dict | None = Depends(get_optional_user)):
    """Streaming chat endpoint. Emits SSE events for each pipeline step."""
    # If authenticated with conversation_id, load history from DB and save user message
    if user and request.conversation_id:
        convo = get_conversation(request.conversation_id)
        if convo and convo["user_id"] == user["id"]:
            request.history = _load_db_history(request.conversation_id)
            add_message(request.conversation_id, "user", request.message, request.image_base64)
            _auto_title(request.conversation_id, request.message)
    elif user and not request.conversation_id:
        convo = create_conversation(user["id"], request.village, request.message[:50] or "New conversation")
        request.conversation_id = convo["id"]
        add_message(request.conversation_id, "user", request.message, request.image_base64)

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
    from tools.budget import set_budget
    from llm.presets import set_fast_mode
    set_budget(mode=request.web_search_mode, limit=5)
    set_fast_mode(request.fast_mode)

    context: dict[str, Any] = {
        "village": request.village,
        "history": request.history,
        "language": request.language,
    }

    # Only allow debug events for users with debug permission
    has_debug_perm = bool(user and (user.get("is_admin") or user.get("can_debug")))
    is_debug = request.debug and has_debug_perm

    try:
        # Inject debug memory instructions into context if available
        debug_instructions = debug_memory.get_active_instructions()
        if debug_instructions:
            context["debug_instructions"] = debug_instructions

        # Check internal registry for known answers (saves search costs)
        registry_context = registry_lookup(request.message, request.village)
        if registry_context:
            context["registry_context"] = registry_context
            if is_debug:
                yield _sse_event("debug", {
                    "stage": "registry",
                    "data": {"matched": True, "context_length": len(registry_context)},
                })

        # Step 1: Router
        yield _sse_event("step", {"stage": "router", "status": "running", "label": "Classifying query..."})
        routing = await _router_agent.run(request.message, context=context)
        agent_name = routing.get("agent", "general")
        refined_query = routing.get("refined_query", request.message)
        yield _sse_event("step", {
            "stage": "router", "status": "done",
            "label": f"Routed to {agent_name}",
            "detail": refined_query,
        })
        if is_debug:
            yield _sse_event("debug", {"stage": "router", "data": routing})

        if agent_name == "off_topic":
            off_topic_resp = _build_off_topic_response()
            if user and request.conversation_id:
                add_message(request.conversation_id, "assistant", off_topic_resp, agent_used="router")
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

        # Pre-inject RAG context for all agents so curated knowledge
        # (permits, jurisdiction hierarchy, etc.) is always available
        from rag.store import KnowledgeStore
        _rag_store = KnowledgeStore()
        rag_results = _rag_store.search(refined_query, village=request.village or None, n_results=3)
        shared_results = _rag_store.search(refined_query, village=None, n_results=3)
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

        # Step 2: Planner
        search_plan_text = None
        specialist_model_role = None
        plan = await _planner_agent.run(refined_query, village=request.village, agent_type=agent_name)
        if plan:
            search_plan_text = plan.raw_text
            if plan.complexity != "high":
                specialist_model_role = "specialist"

            yield _sse_event("step", {
                "stage": "planner", "status": "done",
                "label": f"Plan: {plan.project_type} ({plan.complexity} complexity)",
                "detail": f"{len(plan.steps)} search steps planned",
                "plan": {
                    "steps": [{"tool": s.tool, "query": s.query} for s in plan.steps],
                    "web_fallbacks": plan.web_fallback_queries,
                    "model": specialist_model_role or "reasoning",
                },
            })
        else:
            yield _sse_event("step", {"stage": "planner", "status": "skipped", "label": "Planning skipped (simple query)"})

        if is_debug:
            yield _sse_event("debug", {
                "stage": "model_selection",
                "data": {
                    "specialist_model": specialist_model_role or "reasoning",
                    "complexity": plan.complexity if plan else "n/a",
                    "debug_instructions_injected": bool(debug_instructions),
                },
            })

        # Step 3: Specialist with tool call streaming
        model_label = "Sonnet" if specialist_model_role == "specialist" else "Opus"
        yield _sse_event("step", {"stage": "specialist", "status": "running", "label": f"Searching ({model_label})..."})

        async def on_tool_event(event: dict):
            """Callback for streaming tool calls from BaseAgent."""
            # Non-local yield not possible, so we use a queue pattern
            pass  # Handled via queue below

        # Use a queue to bridge BaseAgent callbacks → SSE stream
        tool_event_queue: asyncio.Queue[dict | None] = asyncio.Queue()

        async def emit_tool_event(event: dict):
            await tool_event_queue.put(event)

        # Run the specialist in a background task so we can yield events as they come
        agent_response_holder: list[AgentResponse] = []

        async def run_specialist():
            resp = await agent.run(
                refined_query,
                context=context,
                search_plan=search_plan_text,
                model_role_override=specialist_model_role,
                on_event=emit_tool_event,
            )
            agent_response_holder.append(resp)
            await tool_event_queue.put(None)  # sentinel

        task = asyncio.create_task(run_specialist())

        # Yield tool events as they stream in
        while True:
            event = await tool_event_queue.get()
            if event is None:
                break
            yield _sse_event("tool", event)

        await task  # ensure no exceptions are lost
        agent_response = agent_response_holder[0]

        tool_count = len(agent_response.tool_calls_made)
        yield _sse_event("step", {
            "stage": "specialist", "status": "done",
            "label": f"Completed ({tool_count} tool calls)",
        })

        # Step 4: Critic (skip for simple community queries without a plan)
        skip_critic = agent_name == "community" and not plan
        if not skip_critic:
            yield _sse_event("step", {"stage": "critic", "status": "running", "label": "Validating response..."})
            verdict = await _critic_agent.run(
                original_query=request.message,
                draft_response=agent_response.content,
                tool_calls_made=agent_response.tool_calls_made,
                village=request.village,
            )
            yield _sse_event("step", {
                "stage": "critic", "status": "done",
                "label": f"Verdict: {verdict.decision} ({verdict.confidence:.0%})",
                "detail": verdict.feedback[:200] if verdict.feedback else "",
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
                yield _sse_event("step", {"stage": "retry", "status": "running", "label": "Retrying with Opus + feedback..."})

                # Retry with queue pattern
                retry_queue: asyncio.Queue[dict | None] = asyncio.Queue()

                async def emit_retry_event(event: dict):
                    await retry_queue.put(event)

                retry_holder: list[AgentResponse] = []

                async def run_retry():
                    resp = await agent.run(
                        refined_query,
                        context=context,
                        search_plan=search_plan_text,
                        critic_feedback=verdict.feedback,
                        model_role_override=None,
                        on_event=emit_retry_event,
                    )
                    retry_holder.append(resp)
                    await retry_queue.put(None)

                retry_task = asyncio.create_task(run_retry())
                while True:
                    event = await retry_queue.get()
                    if event is None:
                        break
                    yield _sse_event("tool", {**event, "retry": True})

                await retry_task
                agent_response = retry_holder[0]

                yield _sse_event("step", {"stage": "retry", "status": "done", "label": "Retry completed"})

                # Second critic
                yield _sse_event("step", {"stage": "critic2", "status": "running", "label": "Final validation..."})
                verdict = await _critic_agent.run(
                    original_query=request.message,
                    draft_response=agent_response.content,
                    tool_calls_made=agent_response.tool_calls_made,
                    is_retry=True,
                )
                yield _sse_event("step", {
                    "stage": "critic2", "status": "done",
                    "label": f"Final verdict: {verdict.decision} ({verdict.confidence:.0%})",
                })

            if verdict.decision == "insufficient":
                insufficient_resp = _build_insufficient_response(request.message, request.village)
                if user and request.conversation_id:
                    add_message(request.conversation_id, "assistant", insufficient_resp, agent_used=agent_name)
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
            add_message(
                request.conversation_id, "assistant", agent_response.content,
                sources=sources if sources else None,
                agent_used=agent_name,
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
    from tools.budget import set_budget
    from llm.presets import set_fast_mode
    set_budget(mode=request.web_search_mode, limit=5)
    set_fast_mode(request.fast_mode)

    context: dict[str, Any] = {
        "village": request.village,
        "history": request.history,
        "language": request.language,
    }

    # Check internal registry for known answers
    reg_ctx = registry_lookup(request.message, request.village)
    if reg_ctx:
        context["registry_context"] = reg_ctx

    # If an image is provided, route through VisionAgent first
    if request.image_base64:
        context["image_base64"] = request.image_base64
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

    routing = await _router_agent.run(request.message, context=context)
    agent_name = routing.get("agent", "general")
    refined_query = routing.get("refined_query", request.message)
    debug["router"] = {"agent": agent_name, "refined_query": refined_query}

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
    plan = await _planner_agent.run(
        refined_query,
        village=request.village,
        agent_type=agent_name,
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
    agent_response: AgentResponse = await agent.run(
        refined_query,
        context=context,
        search_plan=search_plan_text,
        model_role_override=specialist_model_role,
    )

    debug["specialist"] = {
        "tool_calls": [
            {"tool": tc["tool"], "args": tc["args"]}
            for tc in agent_response.tool_calls_made
        ],
        "model_role": specialist_model_role or "reasoning",
    }

    # Step 3: Critic validation (skip for simple community queries without a plan)
    skip_critic = agent_name == "community" and not plan
    if not skip_critic:
        verdict = await _critic_agent.run(
            original_query=request.message,
            draft_response=agent_response.content,
            tool_calls_made=agent_response.tool_calls_made,
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

    return ChatResponse(
        response=agent_response.content,
        sources=_extract_sources(agent_response),
        agent_used=agent_name,
        pipeline_debug=debug,
    )


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
