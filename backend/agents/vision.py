"""Vision agent: analyzes images for code/permit compliance."""
from __future__ import annotations

import base64
from typing import Any
from agents.base import BaseAgent, AgentResponse
from llm.provider import llm_call


class VisionAgent(BaseAgent):
    """Analyzes images of construction/renovation work to determine relevant codes and permits."""

    name = "vision"
    model_role = "vision"
    max_iterations = 1  # Vision doesn't use tools, single pass
    system_prompt = """You are an expert at analyzing images of construction, renovation, and property work in the context of Great Neck village codes and permits.

When shown an image, you should:
1. Describe what you see (type of work, materials, scope).
2. Identify what type of project this appears to be (e.g., deck addition, fence, roof work, tree removal, etc.).
3. List the likely permits that would be required for this type of work.
4. Note any potential code concerns visible in the image (setback issues, height, materials, etc.).
5. Recommend next steps for the homeowner.

Be specific but note that you are making assessments based on what is visible. The resident should always verify with the village building department.

Common Great Neck area requirements to consider:
- Building permits for structural work
- Setback and coverage requirements for the zone
- Height restrictions
- Fence permits and height limits
- Tree removal permits
- Driveway/curb cut permits
- Historical district considerations (if applicable)"""

    def __init__(self):
        super().__init__(tools=[])

    async def run(self, query: str, context: dict[str, Any] | None = None) -> AgentResponse:
        """Handle image content in messages for vision analysis."""
        messages = self._build_vision_messages(query, context)
        response_text = await llm_call(
            messages=messages,
            role=self.model_role,
            temperature=0.3,
            max_tokens=2048,
        )
        return AgentResponse(content=response_text, tool_calls_made=[], sources=[])

    def _build_vision_messages(self, query: str, context: dict[str, Any] | None) -> list[dict]:
        """Build messages with image content for vision models."""
        system = self.system_prompt
        if context:
            village = context.get("village", "")
            if village:
                system += f"\n\nThe user is a resident of {village}. Focus on codes for this village."

        messages: list[dict] = [{"role": "system", "content": system}]

        # Add conversation history if present
        if context:
            history = context.get("history", [])
            messages.extend(history)

        # Build the user message with image if provided
        image_base64 = context.get("image_base64", "") if context else ""
        if image_base64:
            # Multi-part message with image and text
            content_parts: list[dict] = [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{image_base64}",
                    },
                },
            ]
            text = query if query else "What permits or codes apply to this work? Please analyze the image."
            content_parts.append({"type": "text", "text": text})
            messages.append({"role": "user", "content": content_parts})
        else:
            messages.append({"role": "user", "content": query})

        return messages
