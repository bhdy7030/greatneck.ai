"""Model role mappings. Agents reference roles, not specific models."""

from llm.presets import ROLE_PRESETS, FAST_MODELS, load_config, get_fast_mode


def get_model(role: str) -> str:
    """Resolve a model role to a concrete model ID using runtime config."""
    cfg = load_config()
    provider = cfg.get("provider", "claude")

    # fast_mode is per-session only (set from chat request via contextvars)
    fast_mode = get_fast_mode() or False

    if fast_mode:
        return FAST_MODELS.get(provider, FAST_MODELS["claude"])

    preset = ROLE_PRESETS.get(role, ROLE_PRESETS["reasoning"])
    return preset.get(provider, preset["claude"])
