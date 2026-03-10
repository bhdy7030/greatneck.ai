"""Batch-translate event fields (title, description, venue) to Chinese."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from db import _exec, _exec_modify, _is_pg

logger = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

_SYSTEM_PROMPT = """\
You are a professional English→Chinese translator for a community events calendar \
on Long Island, New York.

Rules:
- Translate naturally into Simplified Chinese.
- Keep proper nouns (people, organizations, brand names) in English; \
add Chinese in parentheses only if a well-known translation exists.
- Keep street addresses and place names in English.
- If a field is empty or null, return null for it.
- Return ONLY a JSON array in the same order as the input, nothing else."""

_USER_TEMPLATE = """\
Translate the following event fields to Simplified Chinese.
Return a JSON array where each element has: {{"id": <id>, "title_zh": "...", "description_zh": "...", "venue_zh": "..."}}.

Events:
{events_json}"""


async def translate_untranslated_events() -> int:
    """Translate all future events that lack Chinese translations. Returns count translated."""
    from llm import llm_call

    today = datetime.now(_ET).strftime("%Y-%m-%d")
    ph = "%s" if _is_pg() else "?"

    rows = _exec(
        f"SELECT id, title, description, venue FROM events WHERE title_zh IS NULL AND event_date >= {ph}",
        f"SELECT id, title, description, venue FROM events WHERE title_zh IS NULL AND event_date >= {ph}",
        (today,),
    )

    if not rows:
        logger.info("[translate] No untranslated events found")
        return 0

    logger.info(f"[translate] Translating {len(rows)} events...")

    # Build input payload — truncate descriptions to keep token usage manageable
    events_for_llm = [
        {"id": r["id"], "title": r["title"], "description": (r["description"] or "")[:150], "venue": r["venue"] or ""}
        for r in rows
    ]

    # Batch into chunks of 10 to stay within token limits
    BATCH_SIZE = 10
    updated = 0

    for i in range(0, len(events_for_llm), BATCH_SIZE):
        batch = events_for_llm[i : i + BATCH_SIZE]
        try:
            response_text = await llm_call(
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": _USER_TEMPLATE.format(events_json=json.dumps(batch, ensure_ascii=False))},
                ],
                role="translation",
                temperature=0.1,
                max_tokens=8192,
            )

            # Parse — strip markdown fences if present
            text = response_text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
                if text.endswith("```"):
                    text = text[:-3]
                text = text.strip()

            translations = json.loads(text)
            if not isinstance(translations, list):
                logger.error(f"[translate] Batch {i // BATCH_SIZE}: LLM response is not a JSON array")
                continue

            for item in translations:
                eid = item.get("id")
                if eid is None:
                    continue
                title_zh = item.get("title_zh") or None
                desc_zh = item.get("description_zh") or None
                venue_zh = item.get("venue_zh") or None

                _exec_modify(
                    f"UPDATE events SET title_zh={ph}, description_zh={ph}, venue_zh={ph} WHERE id={ph}",
                    f"UPDATE events SET title_zh={ph}, description_zh={ph}, venue_zh={ph} WHERE id={ph}",
                    (title_zh, desc_zh, venue_zh, eid),
                )
                updated += 1
        except json.JSONDecodeError:
            logger.error(f"[translate] Batch {i // BATCH_SIZE}: Failed to parse JSON: {text[:200]}")
            continue
        except Exception as e:
            logger.warning(f"[translate] Batch {i // BATCH_SIZE} failed: {e}")
            continue

    logger.info(f"[translate] Updated {updated}/{len(rows)} events with Chinese translations")
    return updated
