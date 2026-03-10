"""AI Guide Creator — generates and refines playbook guides via LLM."""

import json
import logging
from llm.provider import llm_call

logger = logging.getLogger(__name__)

GUIDE_SYSTEM_PROMPT = """You are an expert local-government and community guide creator for Great Neck, NY.

Your job is to create actionable step-by-step playbooks that help residents navigate life tasks.

## Output Requirements

You MUST output ONLY valid JSON (no markdown, no explanation) matching this exact schema:

{
  "id": "generated",
  "type": "onboarding",
  "title": {"en": "English title", "zh": "Chinese title"},
  "description": {"en": "Short English description", "zh": "Short Chinese description"},
  "icon": "<emoji_key>",
  "color": "#hexcolor",
  "steps": [
    {
      "id": "step-1",
      "title": {"en": "Step title", "zh": "步骤标题"},
      "description": {"en": "Brief description", "zh": "简要描述"},
      "details": {"en": "Detailed instructions with specific local info", "zh": "详细说明"},
      "links": [
        {"label": {"en": "Link text", "zh": "链接文字"}, "url": "https://..."}
      ],
      "category": "category_name",
      "priority": "high|medium|low",
      "chat_prompt": {"en": "Question to ask AI about this step", "zh": "关于此步骤的AI问题"}
    }
  ]
}

## Content Guidelines

- Generate 5-12 actionable steps
- ALL text must be bilingual with "en" and "zh" keys
- Include Great Neck-specific information where relevant:
  - Village departments and contacts
  - PSEG LI for utilities
  - Local schools (Great Neck school district)
  - Nassau County services
  - Specific local businesses and services when appropriate
- Each step should be concrete and actionable
- Steps should be ordered logically (what to do first, second, etc.)
- Include relevant URLs for official websites, forms, etc.
- Priority: "high" for critical/time-sensitive, "medium" for important, "low" for optional/nice-to-have
- chat_prompt should be a question the user might want to ask the AI assistant about that step

## Icon Options (use one of these keys)
home, snowflake, flower, sun, leaf, star, briefcase, heart, book, tools

## Color Options (use one of these hex values)
#4A90D9, #D94A4A, #4AD97A, #D9A84A, #9B4AD9, #4AD9D9, #D94A9B, #7A8B3D
"""

REFINE_SYSTEM_PROMPT = """You are refining an existing playbook guide based on user feedback.

You will receive the current guide JSON and a user instruction for changes.

Apply the requested changes while preserving the overall structure and quality.
Output ONLY the complete updated guide JSON (same schema as before, no markdown, no explanation).

## Rules
- Keep all existing steps that weren't explicitly asked to change
- Maintain bilingual (en/zh) text for ALL fields
- Keep step IDs stable where possible (only change if steps are reordered/removed)
- If adding steps, use sequential IDs like "step-N"
- Preserve links and details that are still relevant
"""


async def generate_guide(description: str, village: str = "", lang: str = "en") -> tuple[dict | None, list[dict]]:
    """Generate a new guide from a natural language description.

    Returns (guide_data, messages) where messages is the conversation history for refinement.
    """
    village_context = f"\nThe user is in {village}, Great Neck, NY." if village else "\nThe user is in Great Neck, NY."

    user_message = f"Create a playbook for: {description}{village_context}"

    messages = [
        {"role": "system", "content": GUIDE_SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]

    try:
        response = await llm_call(
            messages=messages,
            role="reasoning",
            max_tokens=8192,
            temperature=0.3,
        )

        # Parse JSON from response (handle possible markdown wrapping)
        guide_data = _parse_guide_json(response)
        if not guide_data:
            logger.error("Failed to parse guide JSON from LLM response")
            return None, []

        # Build conversation history for refinement
        conversation = [
            {"role": "user", "content": user_message},
            {"role": "assistant", "content": json.dumps(guide_data)},
        ]

        return guide_data, conversation

    except Exception as e:
        logger.error(f"Guide generation failed: {e}")
        return None, []


async def refine_guide(instruction: str, current_guide: dict, messages: list[dict], village: str = "", lang: str = "en") -> tuple[dict | None, list[dict]]:
    """Refine an existing guide based on user instruction.

    Returns (guide_data, updated_messages).
    """
    village_context = f"\nThe user is in {village}, Great Neck, NY." if village else "\nThe user is in Great Neck, NY."

    user_message = f"Current guide:\n{json.dumps(current_guide, ensure_ascii=False)}\n\nRequested change: {instruction}{village_context}"

    llm_messages = [
        {"role": "system", "content": REFINE_SYSTEM_PROMPT},
        *messages,
        {"role": "user", "content": user_message},
    ]

    try:
        response = await llm_call(
            messages=llm_messages,
            role="reasoning",
            max_tokens=8192,
            temperature=0.3,
        )

        guide_data = _parse_guide_json(response)
        if not guide_data:
            logger.error("Failed to parse refined guide JSON from LLM response")
            return None, messages

        # Append to conversation history
        updated_messages = messages + [
            {"role": "user", "content": f"Change: {instruction}"},
            {"role": "assistant", "content": json.dumps(guide_data)},
        ]

        return guide_data, updated_messages

    except Exception as e:
        logger.error(f"Guide refinement failed: {e}")
        return None, messages


def _parse_guide_json(text: str) -> dict | None:
    """Extract and parse JSON from LLM response, handling markdown code blocks."""
    text = text.strip()

    # Remove markdown code block wrapping if present
    if text.startswith("```"):
        # Find end of first line (```json or ```)
        first_newline = text.index("\n")
        text = text[first_newline + 1:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        logger.error(f"JSON parse error: {e}")
        # Try to find JSON object in the text
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass
        return None
