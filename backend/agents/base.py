"""Base agent with tool-use loop. All specialist agents extend this."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")
from typing import Any, Callable, Awaitable, Optional

from llm.provider import llm_call_with_tools
from tools.registry import Tool, execute_tool

# Callback type for streaming pipeline events
EventCallback = Optional[Callable[[dict[str, Any]], Awaitable[None]]]


@dataclass
class AgentResponse:
    content: str
    tool_calls_made: list[dict] = field(default_factory=list)
    sources: list[dict] = field(default_factory=list)


class BaseAgent:
    """Lightweight agent: reason → use tools → reason → respond."""

    name: str = "base"
    system_prompt: str = "You are a helpful assistant."
    model_role: str = "reasoning"
    max_iterations: int = 8

    def __init__(self, tools: list[Tool] | None = None):
        self.tools = tools or []

    async def run(
        self,
        query: str,
        context: dict[str, Any] | None = None,
        search_plan: str | None = None,
        critic_feedback: str | None = None,
        model_role_override: str | None = None,
        on_event: EventCallback = None,
    ) -> AgentResponse:
        messages = self._build_messages(query, context, search_plan=search_plan, critic_feedback=critic_feedback)
        tool_schemas = [t.to_openai_tool() for t in self.tools]
        calls_made: list[dict] = []
        effective_role = model_role_override or self.model_role

        for _ in range(self.max_iterations):
            response = await llm_call_with_tools(
                messages=messages,
                tools=tool_schemas,
                role=effective_role,
            )

            # If no tool calls, we have our final answer
            if not response.tool_calls:
                return AgentResponse(
                    content=response.content or "",
                    tool_calls_made=calls_made,
                )

            # Process tool calls
            messages.append(response.model_dump())
            for tc in response.tool_calls:
                fn_name = tc.function.name
                args = json.loads(tc.function.arguments)

                # Emit tool_call event before execution
                if on_event:
                    await on_event({"type": "tool_call", "tool": fn_name, "args": args})

                result = await execute_tool(fn_name, args)
                calls_made.append({"tool": fn_name, "args": args, "result_preview": result[:2000]})

                # Emit tool_result event after execution
                if on_event:
                    is_empty = "no relevant" in result.lower()[:100] or "not found" in result.lower()[:100]
                    await on_event({
                        "type": "tool_result",
                        "tool": fn_name,
                        "preview": result[:200],
                        "has_results": not is_empty,
                    })

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })

        # Hit max iterations — return whatever we have
        return AgentResponse(content="I need more information to answer this fully.", tool_calls_made=calls_made)

    def _build_messages(
        self,
        query: str,
        context: dict[str, Any] | None,
        search_plan: str | None = None,
        critic_feedback: str | None = None,
    ) -> list[dict]:
        system = self.system_prompt
        now = datetime.now(_ET)
        # Provide weekday context so LLM can resolve "this Friday", "tomorrow", etc.
        weekday = now.strftime('%A')  # e.g. "Tuesday"
        days_of_week = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        day_idx = days_of_week.index(weekday)
        upcoming = ", ".join(
            f"{days_of_week[(day_idx + i) % 7]} {(now + __import__('datetime').timedelta(days=i)).strftime('%B %-d')}"
            for i in range(7)
        )
        current_year = now.strftime('%Y')
        system += (
            f"\n\nCurrent date/time: {now.strftime('%A, %B %-d, %Y at %I:%M %p')} (Eastern Time)"
            f"\nUpcoming days: {upcoming}"
        )

        # Data freshness awareness (applies to all agents)
        system += f"""

## Data Freshness (IMPORTANT)
The local knowledge base may contain outdated information — businesses close, fees change, schedules shift, regulations get amended. You MUST account for this:
- **When searching for time-sensitive topics** (restaurants, businesses, events, schedules, hours, pricing, reviews, contact info, officials, personnel), **always verify with a live search** (search_social or web_search) — do NOT rely solely on the knowledge base.
- **Include "{current_year}" in web/social search queries** for time-sensitive topics to get current results (e.g., "best ramen Great Neck NY {current_year}").
- **If KB results mention businesses, restaurants, or services**, note they may have changed and cross-check with live search when possible.
- **Prefer recent sources over old ones.** If you have both KB data and live search results, prioritize the live data for anything time-sensitive.
- For stable topics (zoning codes, setback rules, building code sections), KB data is reliable — no need for live verification unless the user asks about recent changes.
- **If web search is disabled or budget is exhausted**, still answer from KB but add a brief note that the information may be outdated and suggest the user enable web search for the most current results."""

        # Response formatting guidelines (applies to all user-facing agents)
        system += """

## Response Format (applies to your FINAL answer to the user — NOT to your search strategy)
1. **BLUF (Bottom Line Up Front):** Your very first sentence must be the direct answer or key takeaway, in **bold**. Do not bury the lead.
2. **Zero fluff:** No generic intros ("Great question!"), no empathetic filler, no summary conclusions that repeat what was already said.
3. **Scannable structure:** Use ### headings, bullet points, and **bold** for key terms. No paragraphs longer than 3-4 sentences.
4. **Actionable close:** End with a specific next step, contact info, or a targeted follow-up question — not a vague "hope this helps."
5. **Always cite sources.** When your answer comes from search results or web pages, mention source names inline. Never omit sources when you have them.

NOTE: These formatting rules apply to your written response ONLY. Do NOT reduce your search thoroughness — always do multi-hop searches, follow-up queries, and verify information as instructed by your search strategy."""

        if context:
            village = context.get("village", "")
            if village:
                system += (
                    f"\n\nThe user is a resident of {village}. Focus on codes and rules for this village."
                    f"\n\n## Geographic Jurisdiction Awareness"
                    f"\nThe Great Neck area sits within this hierarchy: "
                    f"New York State → Nassau County → Town of North Hempstead → individual villages. "
                    f"NYS building/fire codes set the MINIMUM standard and always apply. "
                    f"Village-specific codes (zoning, setbacks, FAR, lot coverage) may impose STRICTER requirements. "
                    f"Each village has its own codes — rules in one village do NOT apply to another. "
                    f"When answering, consider which jurisdiction level the regulation comes from."
                )
            history = context.get("history", [])
        else:
            history = []

        # Inject pre-loaded RAG context (always available for permit/code agents)
        rag_baseline = (context or {}).get("rag_baseline", "")
        if rag_baseline:
            system += f"\n\n{rag_baseline}"

        # Inject known answers from internal registry (high-priority context)
        registry_context = (context or {}).get("registry_context", "")
        if registry_context:
            system += f"\n\n{registry_context}"

        # Inject debug instructions from god mode memory
        debug_instructions = (context or {}).get("debug_instructions", "")
        if debug_instructions:
            system += f"\n\n{debug_instructions}"

        if search_plan:
            system += f"\n\n## Search Plan\nA planner has analyzed the user's query and recommends the following search strategy:\n{search_plan}"

        if critic_feedback:
            system += (
                f"\n\n## Critic Feedback (IMPORTANT)\n"
                f"A previous attempt to answer this query was rejected by a quality reviewer. "
                f"Address the following feedback:\n{critic_feedback}"
            )

        # Language instruction — tell LLM to respond in Chinese when requested
        if context and context.get("language") == "zh":
            system += (
                "\n\n## Language Instruction (IMPORTANT)\n"
                "Respond in Simplified Chinese (简体中文). "
                "Keep section numbers, law/code references, village names, and proper nouns in English."
            )

        messages: list[dict] = [{"role": "system", "content": system}]
        messages.extend(history)
        messages.append({"role": "user", "content": query})
        return messages
