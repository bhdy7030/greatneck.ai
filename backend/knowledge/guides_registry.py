"""Guide Registry — loads YAML guide definitions for the wallet checklist feature.

Guides live in backend/knowledge/guides/*.yaml. Each file defines one guide
with bilingual (en/zh) content, steps, and metadata.
"""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

import yaml

logger = logging.getLogger(__name__)

GUIDES_DIR = Path(__file__).parent / "guides"

_guides: list[dict] = []


def _load_guides() -> list[dict]:
    """Load all YAML guide files from the guides directory."""
    if not GUIDES_DIR.exists():
        logger.warning("guides/ directory not found — no guides loaded")
        return []
    guides = []
    for path in sorted(GUIDES_DIR.glob("*.yaml")):
        try:
            with open(path) as f:
                data = yaml.safe_load(f)
            if data and data.get("active", True):
                guides.append(data)
        except Exception as e:
            logger.error(f"Failed to load guide {path.name}: {e}")
    logger.info(f"Loaded {len(guides)} guides from {GUIDES_DIR}")
    return guides


# Load once at module level
_guides = _load_guides()


def reload():
    """Hot-reload all guides (useful for dev)."""
    global _guides
    _guides = _load_guides()


def get_all_guides() -> list[dict]:
    """Return all active guides."""
    return list(_guides)


def get_guide_by_id(guide_id: str) -> Optional[dict]:
    """Return a single guide by ID, or None."""
    for g in _guides:
        if g["id"] == guide_id:
            return g
    return None


def get_seasonal_guides(month: int) -> list[dict]:
    """Return guides whose season includes the given month."""
    results = []
    for g in _guides:
        season = g.get("season")
        if season and month in season.get("months", []):
            results.append(g)
    return results


def get_guides_for_context(village: str = "", month: Optional[int] = None) -> list[dict]:
    """Return guides filtered by village applicability and seasonal relevance.

    Always includes onboarding guides. Includes seasonal guides if month matches.
    Filters steps by village applies_to field.
    """
    if month is None:
        month = datetime.now().month
    results = []
    for g in _guides:
        # Include onboarding always; seasonal only if month matches
        if g["type"] == "seasonal":
            season = g.get("season")
            if not season or month not in season.get("months", []):
                continue
        # Filter steps by village if provided
        if village:
            filtered_steps = []
            for step in g.get("steps", []):
                applies = step.get("applies_to", "all")
                if applies == "all" or (isinstance(applies, list) and village.lower() in [v.lower() for v in applies]):
                    filtered_steps.append(step)
            guide_copy = {**g, "steps": filtered_steps}
            if filtered_steps:
                results.append(guide_copy)
        else:
            results.append(g)
    return results


def format_guide_context_for_chat(village: str = "", lang: str = "en") -> str:
    """Compact summary of available guides for agent system prompt injection."""
    guides = get_guides_for_context(village)
    if not guides:
        return ""
    lines = [
        "## Available Guided Checklists",
        "The following interactive checklists are available at /guides/ for users:",
        "",
    ]
    for g in guides:
        title = g["title"].get(lang, g["title"].get("en", g["id"]))
        desc = g["description"].get(lang, g["description"].get("en", ""))
        step_count = len(g.get("steps", []))
        lines.append(f"- **{title}** ({step_count} steps): {desc}")
    lines.append("")
    lines.append("You can suggest users check out /guides/ for step-by-step help.")
    return "\n".join(lines)
