"""Tier resolution and feature gating."""
from __future__ import annotations

from datetime import datetime, timezone

from config import settings


def resolve_tier(user: dict | None) -> str:
    """Resolve effective tier for a request.

    Returns one of: "anonymous", "free", "free_promo", "pro"
    """
    if user is None:
        return "anonymous"

    # Admins and pro-tier users → pro
    if user.get("is_admin") or user.get("tier") == "pro":
        return "pro"

    # Check promo period
    promo = user.get("promo_expires_at")
    if promo:
        try:
            exp = datetime.fromisoformat(promo)
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) < exp:
                return "free_promo"
        except (ValueError, TypeError):
            pass

    return "free"


def get_tier_features(tier: str) -> dict:
    """Return feature flags for a given tier.

    Keys:
        web_search_mode: "off" | "limited" | "unlimited"
        fast_mode_forced: bool — if True, client cannot use Deep mode
        deep_mode_allowed: bool
        max_queries: int | None — None means unlimited
    """
    if tier == "pro" or tier == "free_promo":
        return {
            "web_search_mode": "unlimited",
            "fast_mode_forced": False,
            "deep_mode_allowed": True,
            "max_queries": None,
        }

    if tier == "free":
        return {
            "web_search_mode": settings.free_web_search_mode,
            "fast_mode_forced": settings.free_fast_mode_only,
            "deep_mode_allowed": not settings.free_fast_mode_only,
            "max_queries": None,
        }

    # anonymous
    return {
        "web_search_mode": "limited",
        "fast_mode_forced": True,
        "deep_mode_allowed": False,
        "max_queries": settings.anon_initial_queries + settings.anon_extended_queries,
    }
