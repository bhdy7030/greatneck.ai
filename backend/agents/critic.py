"""Critic agent: validates specialist responses for quality and relevance."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from llm.provider import llm_call

logger = logging.getLogger(__name__)


@dataclass
class CriticVerdict:
    decision: str  # "accept", "retry", or "insufficient"
    feedback: str  # Feedback for retry, or reason for insufficient
    confidence: float = 0.0


CRITIC_SYSTEM_PROMPT = """You are a quality reviewer for a village government information assistant. Your job is to evaluate whether a draft response adequately answers the user's question with relevant, accurate information.

You will receive:
1. The original user question
2. The draft response from the specialist agent
3. A summary of tool calls made (searches performed and their results)

Evaluate the response on these criteria:
- **Geographic accuracy (CRITICAL)**: The response MUST be about the correct village/town. The user's village will be noted below. If the response discusses a DIFFERENT municipality with a similar name (e.g., Thomaston CT instead of Thomaston NY, or a different state/county), this is a HARD FAIL — return "retry" with feedback to search for the correct location. This is the most important check.
- **Source relevance**: Do the cited sources actually relate to the question? (e.g., garbage collection docs should NOT be cited for fence questions)
- **Answer completeness**: Does the response actually address what was asked?
- **Evidence backing**: Are claims supported by the tool results, or fabricated?
- **Honesty**: If data was insufficient, does the response acknowledge this rather than making up answers?

You MUST respond with ONLY a valid JSON object:
{
  "decision": "accept|retry|insufficient",
  "feedback": "explanation of your decision",
  "confidence": 0.85
}

Decision guide:
- "accept": Response is relevant and adequately answers the question. Web search results count as valid sources — if the response is grounded in web results, that's acceptable even if local knowledge base had no data.
- "retry": Response has issues that could be fixed with better searches or reasoning. Provide specific feedback on what to improve.
- "insufficient": NO useful data was found from ANY source (local or web). The tools returned nothing actionable. Only use this when the agent truly has nothing to work with.

IMPORTANT distinctions:
- If web_search returned relevant results and the response uses them appropriately → "accept"
- If the response embellishes beyond what sources say but the core answer is grounded → "retry" with feedback to stick to verified facts
- If the response cites completely UNRELATED documents (e.g., garbage collection for a fence question) → "retry" or "insufficient"
- "insufficient" should be RARE — only when all searches (local AND web) returned nothing useful
Do NOT include any text outside the JSON object."""


class CriticAgent:
    """Validates specialist responses. Single LLM call, no tools."""

    name = "critic"
    model_role = "critic"

    async def run(
        self,
        original_query: str,
        draft_response: str,
        tool_calls_made: list[dict],
        is_retry: bool = False,
        village: str = "",
    ) -> CriticVerdict:
        """Evaluate a draft response. On retry pass, only accept or insufficient."""
        tool_summary = self._summarize_tool_calls(tool_calls_made)

        system = CRITIC_SYSTEM_PROMPT
        if village:
            system += (
                f"\n\nThe user's village is: **{village}** (Great Neck area, Long Island, New York). "
                f"Any response about a different municipality (different state, different county) is WRONG. "
                f"For example, Thomaston CT is NOT Thomaston NY. Great Neck Plaza is NOT Great Neck Estates."
            )
        if is_retry:
            system += (
                "\n\nIMPORTANT: This is a RETRY attempt. The specialist has already been given feedback "
                "and tried again. Your only options are 'accept' or 'insufficient'. Do NOT return 'retry'.\n"
                "Be lenient on this pass: if the response provides SOME useful direction grounded in "
                "tool results (even web search results), choose 'accept'. Only choose 'insufficient' "
                "if the response is completely ungrounded or all tool calls returned nothing useful."
            )

        user_content = (
            f"## Original Question\n{original_query}\n\n"
            f"## Draft Response\n{draft_response}\n\n"
            f"## Tool Calls Made\n{tool_summary}"
        )

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ]

        try:
            response_text = await llm_call(
                messages=messages,
                role=self.model_role,
                temperature=0.0,
                max_tokens=512,
            )

            cleaned = response_text.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[-1]
                cleaned = cleaned.rsplit("```", 1)[0]
                cleaned = cleaned.strip()

            data = json.loads(cleaned)

            decision = data.get("decision", "accept")
            # On retry, force to accept or insufficient
            if is_retry and decision == "retry":
                decision = "insufficient"

            # Validate decision value
            if decision not in ("accept", "retry", "insufficient"):
                decision = "accept"

            verdict = CriticVerdict(
                decision=decision,
                feedback=data.get("feedback", ""),
                confidence=float(data.get("confidence", 0.5)),
            )

            logger.info(f"Critic verdict: {verdict.decision} (confidence: {verdict.confidence:.2f})")
            return verdict

        except (json.JSONDecodeError, Exception) as e:
            logger.warning(f"Critic failed to parse response: {e}. Defaulting to accept.")
            return CriticVerdict(decision="accept", feedback="Critic evaluation failed", confidence=0.0)

    def _summarize_tool_calls(self, tool_calls: list[dict]) -> str:
        """Create a concise summary of tool calls for the critic to review."""
        if not tool_calls:
            return "No tool calls were made."

        parts = []
        for i, call in enumerate(tool_calls, 1):
            tool_name = call.get("tool", "unknown")
            args = call.get("args", {})
            preview = call.get("result_preview", "")
            # Truncate preview for critic context
            if len(preview) > 500:
                preview = preview[:500] + "..."
            parts.append(
                f"[{i}] {tool_name}({json.dumps(args)})\n"
                f"Result: {preview}"
            )

        return "\n\n".join(parts)
