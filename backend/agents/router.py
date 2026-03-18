"""Router agent: classifies incoming queries and delegates to specialist agents."""
from __future__ import annotations

import json
from typing import Any
from agents.base import BaseAgent, AgentResponse
from llm.provider import llm_call


class RouterAgent(BaseAgent):
    """Classifies queries and routes them to the appropriate specialist agent."""

    name = "router"
    model_role = "router"
    system_prompt = """You are a query router for GreatNeck.ai, the Great Neck community assistant.
Your ONLY job is to classify the user's query and return a JSON routing decision.

Classify into one of these categories:
- "village_code" — questions about zoning laws, building codes, ordinances, setback requirements, noise rules, property regulations, code enforcement
- "permit" — questions about permits, applications, forms, fees, inspections, building department submissions, construction projects, renovations, driveway work, fences, decks, roofing, plumbing, electrical work, or any home improvement that may require a permit
- "community" — questions about schools, libraries, parks, community events, activities, things to do, what's happening, programs, classes, local services, recreation, restaurants, neighborhood life, real estate, garbage/recycling schedules, trash pickup days, bulk pickup info
- "report" — ONLY when user wants to actively report a problem, file a complaint, or draft a message to officials. Examples: reporting a pothole, filing a noise complaint, reporting a fallen tree, streetlight outage. NOT for asking about schedules or information.
- "vision" — when the user provides an image and wants analysis of construction/renovation work, code compliance from photos
- "general" — greetings or simple conversational messages (hi, hello, thanks)
- "off_topic" — queries completely unrelated to Great Neck or local community topics. Examples: coding help, homework, math problems, recipes, general AI chat, medical advice, stock picks, writing essays. Be strict: if it has nothing to do with Great Neck / Long Island / local life / housing / community, it's off_topic.

You MUST respond with ONLY a JSON object in this exact format:
{"agent": "village_code", "refined_query": "the refined search query"}

The refined_query should be a clear, search-friendly version of the user's question.
Do NOT include any other text, explanation, or markdown. Only the JSON object."""

    def __init__(self):
        super().__init__(tools=[])

    async def run(self, query: str, context: dict[str, Any] | None = None) -> dict:
        """Route the query. Returns a dict with {agent, refined_query} instead of AgentResponse."""
        messages = self._build_messages(query, context)
        response_text = await llm_call(
            messages=messages,
            role=self.model_role,
            temperature=0.0,
            max_tokens=256,
        )

        # Parse the routing decision — extract first {...} object to handle
        # leading/trailing markdown fences or stray text from the LLM
        import re as _re
        try:
            m = _re.search(r"\{[^{}]+\}", response_text, _re.DOTALL)
            decision = json.loads(m.group()) if m else {}
            if not isinstance(decision, dict):
                decision = {}
        except (json.JSONDecodeError, ValueError, AttributeError):
            decision = {}
        if not decision:
            decision = {"agent": "general", "refined_query": query}

        # Validate the agent name
        valid_agents = {"village_code", "permit", "community", "report", "vision", "general", "off_topic"}
        if decision.get("agent") not in valid_agents:
            decision["agent"] = "general"
        if not decision.get("refined_query"):
            decision["refined_query"] = query

        return decision
