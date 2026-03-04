"""Common Answers Registry — in-memory lookup for known community knowledge.

Engineers maintain `common_answers.yaml`. This module loads it once at import
time, then provides a fast keyword-matching lookup. Matched entries are
formatted as high-priority context for agent system prompts.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from pathlib import Path
from typing import List, Optional

import yaml

logger = logging.getLogger(__name__)

REGISTRY_FILE = Path(__file__).parent / "common_answers.yaml"

# Minimum keyword overlap to consider a match
MIN_KEYWORD_HITS = 2


def _load_entries() -> list[dict]:
    if not REGISTRY_FILE.exists():
        logger.warning("common_answers.yaml not found — registry empty")
        return []
    with open(REGISTRY_FILE) as f:
        data = yaml.safe_load(f) or {}
    return data.get("entries", [])


# Load once at module level
_entries: list[dict] = _load_entries()


def reload():
    """Hot-reload the registry (useful after editing the YAML)."""
    global _entries
    _entries = _load_entries()
    logger.info(f"Registry reloaded: {len(_entries)} entries")


def _is_stale(entry: dict) -> bool:
    """Check if an entry's last_verified date exceeds its stale_days."""
    last = entry.get("last_verified", "")
    stale_days = entry.get("stale_days", 90)
    if not last:
        return True
    try:
        verified = datetime.strptime(str(last), "%Y-%m-%d").date()
        return (date.today() - verified).days > stale_days
    except ValueError:
        return True


def _applies_to_village(entry: dict, village: str) -> bool:
    scope = entry.get("applies_to", "all")
    if scope == "all":
        return True
    if isinstance(scope, list):
        return village.lower() in [v.lower() for v in scope]
    return True


def lookup(query: str, village: str = "") -> list[dict]:
    """Find registry entries matching the query by keyword overlap.

    Returns list of matching entry dicts, each augmented with `_stale: bool`.
    """
    query_lower = query.lower()
    query_words = set(query_lower.split())
    matches = []

    for entry in _entries:
        if village and not _applies_to_village(entry, village):
            continue

        keywords = entry.get("keywords", [])
        hits = 0
        for kw in keywords:
            kw_lower = kw.lower()
            # Check both exact word match and substring match
            if kw_lower in query_words or kw_lower in query_lower:
                hits += 1

        if hits >= MIN_KEYWORD_HITS:
            matches.append({**entry, "_stale": _is_stale(entry), "_hits": hits})

    # Sort by keyword hits (most relevant first)
    matches.sort(key=lambda m: m["_hits"], reverse=True)
    return matches


def format_context(matches: list[dict]) -> str:
    """Format matched entries as context for injection into agent prompts."""
    if not matches:
        return ""

    lines = [
        "## Known Answers (from internal registry — high confidence)",
        "The following information is from a curated, engineer-maintained knowledge base.",
        "Use it as your PRIMARY source. Only search if you need additional detail.",
        "IMPORTANT: Include ALL relevant links mentioned in the answer — do not drop any URLs.",
        "",
    ]

    for m in matches:
        lines.append(f"### {m['topic']}")
        lines.append(m["answer"].strip())
        if m.get("source_name"):
            source_line = f"Source: {m['source_name']}"
            if m.get("source_url"):
                source_line += f" ({m['source_url']})"
            lines.append(source_line)
        if m["_stale"]:
            lines.append(
                "⚠ This entry has not been verified recently. "
                "Use web_search to confirm the information is still current "
                "before presenting it to the user."
            )
        lines.append("")

    return "\n".join(lines)


def lookup_and_format(query: str, village: str = "") -> str:
    """One-call convenience: lookup + format. Returns empty string if no match."""
    return format_context(lookup(query, village))
