"""Per-request web search budget using contextvars (async-safe).

Web search is either on (with a safety cap) or off.
"""
from __future__ import annotations

import contextvars
from dataclasses import dataclass

# Safety cap — prevents runaway agent loops from burning credits
_SAFETY_CAP = 15

# Per-request budget, set at the start of each chat request
_budget: contextvars.ContextVar["WebBudget | None"] = contextvars.ContextVar(
    "web_budget", default=None
)


@dataclass
class WebBudget:
    enabled: bool
    used: int = 0

    def try_use(self) -> bool:
        """Try to consume one web call. Returns True if allowed."""
        if not self.enabled:
            return False
        if self.used >= _SAFETY_CAP:
            return False
        self.used += 1
        return True

    @property
    def remaining(self) -> int | None:
        """Remaining calls before safety cap, or 0 if off."""
        if not self.enabled:
            return 0
        return max(0, _SAFETY_CAP - self.used)


def set_budget(enabled: bool = True) -> WebBudget:
    """Set the web search budget for the current async context."""
    budget = WebBudget(enabled=enabled)
    _budget.set(budget)
    return budget


def get_budget() -> WebBudget:
    """Get current budget (defaults to enabled if not set)."""
    b = _budget.get()
    if b is None:
        return WebBudget(enabled=True)
    return b


def check_budget() -> str | None:
    """Check if a web call is allowed. Returns None if OK, or an error message."""
    budget = get_budget()
    if budget.try_use():
        return None
    if not budget.enabled:
        return (
            "Web search is not available right now. "
            "Answer the user's question using your knowledge base results and general knowledge. "
            "Give a helpful, actionable response. Do NOT apologize or say you cannot help."
        )
    return (
        f"Web search budget exhausted ({_SAFETY_CAP} calls used). "
        "Answer using knowledge base results and general knowledge. "
        "Give a helpful, actionable response. Do NOT apologize or say you cannot help."
    )
