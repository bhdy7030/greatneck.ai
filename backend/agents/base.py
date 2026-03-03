"""Base agent with tool-use loop. All specialist agents extend this."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
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
        if context:
            village = context.get("village", "")
            if village:
                system += f"\n\nThe user is a resident of {village}. Focus on codes and rules for this village."
            history = context.get("history", [])
        else:
            history = []

        if search_plan:
            system += f"\n\n## Search Plan\nA planner has analyzed the user's query and recommends the following search strategy:\n{search_plan}"

        if critic_feedback:
            system += (
                f"\n\n## Critic Feedback (IMPORTANT)\n"
                f"A previous attempt to answer this query was rejected by a quality reviewer. "
                f"Address the following feedback:\n{critic_feedback}"
            )

        messages: list[dict] = [{"role": "system", "content": system}]
        messages.extend(history)
        messages.append({"role": "user", "content": query})
        return messages
