"""Provider-agnostic LLM calls via LiteLLM."""

import asyncio
import logging
import time
from typing import Any
import litellm
from .models import get_model
from metrics.collector import record_llm_usage

logger = logging.getLogger(__name__)

# Suppress LiteLLM's verbose logging
litellm.suppress_debug_info = True

MAX_RETRIES = 5
RETRY_DELAY = 2  # seconds


def _extract_and_record(response, model: str, role: str, start_time: float):
    """Extract token usage from LiteLLM response and push to metrics queue."""
    try:
        usage = getattr(response, "usage", None)
        prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
        completion_tokens = getattr(usage, "completion_tokens", 0) or 0
        total_tokens = prompt_tokens + completion_tokens

        # LiteLLM provides per-call cost calculation
        try:
            cost = litellm.completion_cost(completion_response=response)
        except Exception:
            cost = 0.0

        latency_ms = int((time.time() - start_time) * 1000)

        record_llm_usage(
            role=role,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            cost_usd=cost,
            latency_ms=latency_ms,
        )
    except Exception:
        logger.debug("Failed to record LLM usage metrics", exc_info=True)


async def _retry(coro_fn, retries=MAX_RETRIES):
    """Retry a coroutine on transient errors (overloaded, rate limit)."""
    for attempt in range(retries):
        try:
            return await coro_fn()
        except Exception as e:
            err_str = str(e).lower()
            is_transient = ("overloaded" in err_str or "529" in err_str or "rate" in err_str) and "not found" not in err_str and "404" not in err_str
            if is_transient and attempt < retries - 1:
                wait = RETRY_DELAY * (attempt + 1)
                logger.warning(f"LLM transient error (attempt {attempt+1}), retrying in {wait}s: {e}")
                await asyncio.sleep(wait)
            else:
                raise


async def llm_call(
    messages: list[dict],
    role: str = "reasoning",
    temperature: float = 0.2,
    max_tokens: int = 4096,
) -> str:
    """Simple LLM call, returns text response."""
    model = get_model(role)
    start = time.time()

    async def _call():
        response = await litellm.acompletion(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        _extract_and_record(response, model, role, start)
        return response.choices[0].message.content

    return await _retry(_call)


async def llm_call_with_tools(
    messages: list[dict],
    tools: list[dict],
    role: str = "reasoning",
    temperature: float = 0.2,
    max_tokens: int = 4096,
) -> Any:
    """LLM call with tool definitions. Returns the full message object."""
    model = get_model(role)
    start = time.time()

    async def _call():
        response = await litellm.acompletion(
            model=model,
            messages=messages,
            tools=tools if tools else None,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        _extract_and_record(response, model, role, start)
        return response.choices[0].message

    return await _retry(_call)
