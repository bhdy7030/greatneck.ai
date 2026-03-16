"""Planner agent: decomposes user queries into structured search plans."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

from llm.provider import llm_call_streaming

logger = logging.getLogger(__name__)


@dataclass
class SearchStep:
    tool: str
    query: str
    domain_hint: str
    priority: int = 1


@dataclass
class SearchPlan:
    project_type: str
    applicable_domains: list[str]
    steps: list[SearchStep]
    web_fallback_queries: list[str]
    complexity: str = "medium"  # "low", "medium", "high" — drives specialist model selection
    raw_text: str = ""  # Formatted text to inject into specialist prompt

    def to_prompt_text(self) -> str:
        """Format the plan as text for injection into the specialist's system prompt."""
        lines = [
            f"Project type: {self.project_type}",
            f"Applicable domains: {', '.join(self.applicable_domains)}",
            "",
            "Recommended search steps (in priority order):",
        ]
        for i, step in enumerate(sorted(self.steps, key=lambda s: s.priority), 1):
            lines.append(f"  {i}. {step.tool}(\"{step.query}\") — {step.domain_hint} [priority {step.priority}]")

        if self.web_fallback_queries:
            lines.append("")
            lines.append("If local searches return no relevant results, try web_search with:")
            for q in self.web_fallback_queries:
                lines.append(f'  - "{q}"')

        return "\n".join(lines)


# Agents that benefit from query planning
PLANNABLE_AGENTS = {"permit", "village_code", "community"}

PLANNER_SYSTEM_PROMPT = """You are a query planning assistant. Your job is to decompose a user's question about village codes, permits, regulations, or community information into a structured search plan.

Analyze the user's question and determine:
1. What type of project or topic they're asking about
2. What regulatory domains are relevant (zoning, building codes, permits, setbacks, community info, etc.)
3. What specific searches should be performed, in what order
4. What web search queries would be good fallbacks if local data is insufficient

You MUST respond in exactly this format:
1. First, write ONE short sentence (under 25 words) acknowledging the user's topic. Be specific. Do NOT use generic phrases like "Great question". Example: "Let me check the fence permit requirements and setback rules for your village."
2. Then on a NEW LINE, output ONLY a valid JSON object in this exact format:
{
  "project_type": "short description of the project/topic",
  "applicable_domains": ["domain1", "domain2"],
  "complexity": "low|medium|high",
  "steps": [
    {"tool": "search_permits|search_codes|search_community|search_social|search_events", "query": "specific search query", "domain_hint": "what this search targets", "priority": 1}
  ],
  "web_fallback_queries": ["web search query 1", "web search query 2"]
}

Rules:
- Use search_permits for permit requirement queries, search_codes for code/regulation queries
- Use search_community to find resident discussions, school reviews, neighborhood experiences in the knowledge base
- Use search_social for live community discussions, reviews, and local news when KB data may be stale or insufficient
- Use search_events for ANY query about events, activities, things to do, programs, classes, meetings, what's happening. This pulls from a live scraped database of future events only.
- Priority 1 = most important, 2 = supplementary
- Include 2-5 search steps covering different aspects of the question
- Web fallback queries should include the village name AND "NY" AND the current year to get fresh results
- Consider the jurisdictional hierarchy when planning searches:
  - NYS building/fire/energy codes apply to ALL villages (state-level baseline)
  - Village-specific zoning codes (setbacks, FAR, lot coverage, height limits) differ per village
  - Town of North Hempstead rules apply to unincorporated areas
  - Include a search step for state-level requirements when the question involves construction, fire safety, or building standards

DATA FRESHNESS — critical:
- The knowledge base may contain stale data. Businesses close, prices change, schedules shift, personnel rotate.
- For ANY query about things that change over time (restaurants, businesses, services, events, schedules, reviews, fees, contact info, officials), you MUST include a search_social or web_search step at priority 1, not just as fallback.
- For these time-sensitive queries, include the current year in both search_social queries and web_fallback_queries (e.g., "best restaurants Great Neck NY 2026").
- Stable topics like zoning codes, setback rules, and building code sections are fine to answer from KB alone.

- For community queries (schools, neighborhoods, local life):
  - Start with search_community (fast, KB cached) — good for background context
  - ALWAYS include search_social at priority 1 for anything involving reviews, recommendations, or current status (live — Reddit, Yelp, RedNote, local news)
  - Use search_codes if the question also touches regulations
  - Include web_search for official/current info
- Assess complexity:
  - "low": straightforward single-domain lookup (e.g., "what's the noise ordinance?")
  - "medium": multi-domain but well-defined (e.g., "do I need a permit for a fence?")
  - "high": ambiguous, multi-faceted, or requires cross-referencing multiple code areas (e.g., "I want to add a second story with a deck and convert my garage")
- Do NOT include any text outside the acknowledgment line and the JSON object"""


class PlannerAgent:
    """Decomposes queries into search plans. Single LLM call, no tools."""

    name = "planner"
    model_role = "planner"

    # Callback type: receives preview token chunks as they stream
    PreviewCallback = Optional[Callable[[str], Awaitable[None]]]

    async def run(
        self,
        query: str,
        village: str = "",
        agent_type: str = "",
        on_preview_token: PreviewCallback = None,
    ) -> SearchPlan | None:
        """Generate a search plan for the given query.

        Streams a brief user-facing acknowledgment sentence via *on_preview_token*
        before the JSON plan, so the caller can push tokens to the client immediately.
        Returns None if planning is skipped.
        """
        if agent_type not in PLANNABLE_AGENTS:
            return None

        from datetime import datetime
        from zoneinfo import ZoneInfo
        current_year = datetime.now(ZoneInfo("America/New_York")).strftime('%Y')

        # Split system prompt into static (cacheable) and dynamic parts.
        # The base PLANNER_SYSTEM_PROMPT is identical across all requests —
        # marking it with cache_control saves ~0.5s on repeated calls
        # (Anthropic prompt caching / Gemini implicit caching).
        static_part = PLANNER_SYSTEM_PROMPT
        dynamic_part = f"\n\nCurrent year: {current_year}. Use this in search queries for time-sensitive topics."
        if village:
            dynamic_part += f"\nThe user is asking about: {village}"

        system_content = [
            {"type": "text", "text": static_part, "cache_control": {"type": "ephemeral"}},
            {"type": "text", "text": dynamic_part},
        ]

        messages = [
            {"role": "system", "content": system_content},
            {"role": "user", "content": query},
        ]

        try:
            # Stream the response so we can emit preview tokens in real time.
            # The model outputs: <acknowledgment sentence>\n<JSON>
            # We stream everything before the first '{' as preview tokens,
            # then collect the rest as JSON for parsing.
            full_text = ""
            json_started = False
            json_buf = ""

            async for chunk in llm_call_streaming(
                messages=messages,
                role=self.model_role,
                temperature=0.0,
                max_tokens=1024,
            ):
                full_text += chunk

                if not json_started:
                    # Check if this chunk contains the start of JSON
                    brace_pos = chunk.find("{")
                    if brace_pos != -1:
                        # Everything before '{' is preview text
                        preview_part = chunk[:brace_pos]
                        if preview_part and on_preview_token:
                            await on_preview_token(preview_part)
                        json_started = True
                        json_buf = chunk[brace_pos:]
                    else:
                        # Still in preview text — stream to user
                        if on_preview_token:
                            await on_preview_token(chunk)
                else:
                    json_buf += chunk

            # Parse the JSON portion
            cleaned = json_buf.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[-1]
                cleaned = cleaned.rsplit("```", 1)[0]
                cleaned = cleaned.strip()

            data = json.loads(cleaned)

            steps = [
                SearchStep(
                    tool=s.get("tool", "search_codes"),
                    query=s.get("query", ""),
                    domain_hint=s.get("domain_hint", ""),
                    priority=s.get("priority", 1),
                )
                for s in data.get("steps", [])
            ]

            complexity = data.get("complexity", "medium")
            if complexity not in ("low", "medium", "high"):
                complexity = "medium"

            plan = SearchPlan(
                project_type=data.get("project_type", ""),
                applicable_domains=data.get("applicable_domains", []),
                steps=steps,
                web_fallback_queries=data.get("web_fallback_queries", []),
                complexity=complexity,
            )
            plan.raw_text = plan.to_prompt_text()

            logger.info(f"Planner generated plan: {plan.project_type} with {len(steps)} steps")
            return plan

        except (json.JSONDecodeError, Exception) as e:
            logger.warning(f"Planner failed to generate plan: {e}")
            return None
