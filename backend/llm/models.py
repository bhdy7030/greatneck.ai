"""Model role mappings. Agents reference roles, not specific models."""

from config import settings

# Map agent roles to model identifiers (LiteLLM format)
ROLE_TO_MODEL: dict[str, str] = {
    "router": settings.model_router,
    "reasoning": settings.model_reasoning,
    "specialist": settings.model_specialist,
    "vision": settings.model_vision,
    "simple": settings.model_simple,
    "planner": settings.model_planner,
    "critic": settings.model_critic,
}


def get_model(role: str) -> str:
    return ROLE_TO_MODEL.get(role, settings.model_reasoning)
