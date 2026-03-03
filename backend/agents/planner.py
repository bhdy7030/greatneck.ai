"""Planner agent: decomposes user queries into structured search plans."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from llm.provider import llm_call

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
PLANNABLE_AGENTS = {"permit", "village_code"}

PLANNER_SYSTEM_PROMPT = """You are a query planning assistant. Your job is to decompose a user's question about village codes, permits, or regulations into a structured search plan.

Analyze the user's question and determine:
1. What type of project or topic they're asking about
2. What regulatory domains are relevant (zoning, building codes, permits, setbacks, etc.)
3. What specific searches should be performed, in what order
4. What web search queries would be good fallbacks if local data is insufficient

You MUST respond with ONLY a valid JSON object in this exact format:
{
  "project_type": "short description of the project/topic",
  "applicable_domains": ["domain1", "domain2"],
  "complexity": "low|medium|high",
  "steps": [
    {"tool": "search_permits|search_codes", "query": "specific search query", "domain_hint": "what this search targets", "priority": 1}
  ],
  "web_fallback_queries": ["web search query 1", "web search query 2"]
}

Rules:
- Use search_permits for permit requirement queries, search_codes for code/regulation queries
- Priority 1 = most important, 2 = supplementary
- Include 2-5 search steps covering different aspects of the question
- Web fallback queries should include the village name and be specific
- Assess complexity:
  - "low": straightforward single-domain lookup (e.g., "what's the noise ordinance?")
  - "medium": multi-domain but well-defined (e.g., "do I need a permit for a fence?")
  - "high": ambiguous, multi-faceted, or requires cross-referencing multiple code areas (e.g., "I want to add a second story with a deck and convert my garage")
- Do NOT include any text outside the JSON object"""


class PlannerAgent:
    """Decomposes queries into search plans. Single LLM call, no tools."""

    name = "planner"
    model_role = "planner"

    async def run(self, query: str, village: str = "", agent_type: str = "") -> SearchPlan | None:
        """Generate a search plan for the given query. Returns None if planning is skipped."""
        if agent_type not in PLANNABLE_AGENTS:
            return None

        system = PLANNER_SYSTEM_PROMPT
        if village:
            system += f"\n\nThe user is asking about: {village}"

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": query},
        ]

        try:
            response_text = await llm_call(
                messages=messages,
                role=self.model_role,
                temperature=0.0,
                max_tokens=1024,
            )

            # Parse JSON (handle markdown code blocks)
            cleaned = response_text.strip()
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
