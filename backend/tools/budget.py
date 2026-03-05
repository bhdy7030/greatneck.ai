"""Per-request web search budget using contextvars (async-safe).

Modes:
  "off"       — no web/Tavily calls allowed
  "limited"   — max N calls per request (default 5)
  "unlimited" — no limit
"""
from __future__ import annotations

import contextvars
from dataclasses import dataclass

# Per-request budget, set at the start of each chat request
_budget: contextvars.ContextVar["WebBudget | None"] = contextvars.ContextVar(
    "web_budget", default=None
)


@dataclass
class WebBudget:
    mode: str  # "off", "limited", "unlimited"
    limit: int  # only used when mode == "limited"
    used: int = 0

    def try_use(self) -> bool:
        """Try to consume one web call. Returns True if allowed."""
        if self.mode == "off":
            return False
        if self.mode == "unlimited":
            self.used += 1
            return True
        # limited
        if self.used >= self.limit:
            return False
        self.used += 1
        return True

    @property
    def remaining(self) -> int | None:
        """Remaining calls, or None if unlimited."""
        if self.mode == "unlimited":
            return None
        if self.mode == "off":
            return 0
        return max(0, self.limit - self.used)


def set_budget(mode: str = "limited", limit: int = 5) -> WebBudget:
    """Set the web search budget for the current async context."""
    budget = WebBudget(mode=mode, limit=limit)
    _budget.set(budget)
    return budget


def get_budget() -> WebBudget:
    """Get current budget (defaults to limited/5 if not set)."""
    b = _budget.get()
    if b is None:
        return WebBudget(mode="limited", limit=5)
    return b


def check_budget() -> str | None:
    """Check if a web call is allowed. Returns None if OK, or an error message."""
    budget = get_budget()
    if budget.try_use():
        return None
    if budget.mode == "off":
        return (
            "Web search is not available right now. "
            "Answer the user's question using your knowledge base results and general knowledge. "
            "Give a helpful, actionable response. Do NOT apologize or say you cannot help."
        )
    return (
        f"Web search budget exhausted ({budget.limit} calls used). "
        "Answer using knowledge base results and general knowledge. "
        "Give a helpful, actionable response. Do NOT apologize or say you cannot help."
    )
