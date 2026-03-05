"""Provider presets and runtime config for model selection."""

import contextvars
import json
from pathlib import Path

_CONFIG_PATH = Path(__file__).parent.parent / "runtime_config.json"

# Per-request fast_mode override (set from chat request, read in get_model)
_fast_mode_override: contextvars.ContextVar[bool | None] = contextvars.ContextVar(
    "fast_mode_override", default=None
)

PROVIDERS = ("claude", "gemini")

# Role → (claude_model, gemini_model)
ROLE_PRESETS: dict[str, dict[str, str]] = {
    "router":     {"claude": "claude-haiku-4-5-20251001",   "gemini": "gemini/gemini-3-flash-preview"},
    "reasoning":  {"claude": "claude-opus-4-20250514",      "gemini": "gemini/gemini-3.1-pro-preview"},
    "specialist": {"claude": "claude-sonnet-4-20250514",    "gemini": "gemini/gemini-3.1-pro-preview"},
    "vision":     {"claude": "claude-opus-4-20250514",      "gemini": "gemini/gemini-3.1-pro-preview"},
    "simple":     {"claude": "claude-haiku-4-5-20251001",   "gemini": "gemini/gemini-3-flash-preview"},
    "planner":    {"claude": "claude-sonnet-4-20250514",    "gemini": "gemini/gemini-3.1-pro-preview"},
    "critic":     {"claude": "claude-haiku-4-5-20251001",   "gemini": "gemini/gemini-3-flash-preview"},
}

FAST_MODELS: dict[str, str] = {
    "claude": "claude-haiku-4-5-20251001",
    "gemini": "gemini/gemini-3-flash-preview",
}

DEFAULT_CONFIG = {"provider": "claude", "fast_mode": False}


def load_config() -> dict:
    """Read runtime config from disk; returns defaults if missing/corrupt."""
    try:
        return json.loads(_CONFIG_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return dict(DEFAULT_CONFIG)


def save_config(cfg: dict) -> dict:
    """Write runtime config to disk and return it."""
    _CONFIG_PATH.write_text(json.dumps(cfg, indent=2) + "\n")
    return cfg


def set_fast_mode(fast: bool) -> None:
    """Set per-request fast_mode override (call at start of each chat request)."""
    _fast_mode_override.set(fast)


def get_fast_mode() -> bool | None:
    """Get per-request fast_mode override, or None if not set."""
    return _fast_mode_override.get()
