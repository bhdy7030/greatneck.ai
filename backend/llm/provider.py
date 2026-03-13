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
            try:
                input_cost, output_cost = litellm.cost_per_token(
                    model=model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                )
                cost = input_cost + output_cost
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


def _strip_cache_control(messages: list[dict]) -> list[dict]:
    """Remove cache_control from messages (Gemini rejects small cached content)."""
    stripped = []
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, list):
            new_parts = []
            for part in content:
                if isinstance(part, dict) and "cache_control" in part:
                    part = {k: v for k, v in part.items() if k != "cache_control"}
                new_parts.append(part)
            stripped.append({**msg, "content": new_parts})
        else:
            stripped.append(msg)
    return stripped


async def _retry(coro_fn, retries=MAX_RETRIES):
    """Retry a coroutine on transient errors (overloaded, rate limit)."""
    for attempt in range(retries):
        try:
            return await coro_fn()
        except Exception as e:
            logger.error(f"LLM call error (attempt {attempt+1}/{retries}): {type(e).__name__}: {e}")
            err_str = str(e).lower()
            is_transient = (
                ("overloaded" in err_str or "529" in err_str or "rate" in err_str)
                and "not found" not in err_str and "404" not in err_str
                and "400" not in err_str and "badrequesterror" not in err_str
            )
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
    _msgs = messages  # may be replaced on cache error retry

    async def _call():
        response = await litellm.acompletion(
            model=model,
            messages=_msgs,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        _extract_and_record(response, model, role, start)
        return response.choices[0].message.content

    try:
        return await _retry(_call)
    except Exception as e:
        if "cached content is too small" in str(e).lower():
            logger.info("Retrying without cache_control (prompt too short for Gemini caching)")
            _msgs = _strip_cache_control(messages)
            return await _call()
        raise


async def llm_call_streaming(
    messages: list[dict],
    role: str = "reasoning",
    temperature: float = 0.2,
    max_tokens: int = 4096,
):
    """Async generator that yields token chunks from a streaming LLM call."""
    model = get_model(role)
    start = time.time()

    try:
        response = await litellm.acompletion(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )
    except Exception as e:
        if "cached content is too small" in str(e).lower():
            logger.info("Retrying stream without cache_control (prompt too short for Gemini caching)")
            response = await litellm.acompletion(
                model=model,
                messages=_strip_cache_control(messages),
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )
        else:
            raise

    full_content = ""
    prompt_tokens = 0
    completion_tokens = 0

    async for chunk in response:
        choice = chunk.choices[0] if chunk.choices else None
        if not choice:
            continue
        delta = choice.delta.content or ""
        if delta:
            full_content += delta
            yield delta

        # Capture usage from the final chunk if available
        usage = getattr(chunk, "usage", None)
        if usage:
            prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
            completion_tokens = getattr(usage, "completion_tokens", 0) or 0

    # Record metrics after stream completes
    try:
        total_tokens = prompt_tokens + completion_tokens
        # Estimate cost from token counts
        try:
            input_cost, output_cost = litellm.cost_per_token(
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            )
            cost = input_cost + output_cost
        except Exception:
            cost = 0.0
        latency_ms = int((time.time() - start) * 1000)
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
        logger.debug("Failed to record streaming LLM usage metrics", exc_info=True)


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
    _msgs = messages

    async def _call():
        response = await litellm.acompletion(
            model=model,
            messages=_msgs,
            tools=tools or None,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        _extract_and_record(response, model, role, start)
        return response.choices[0].message

    try:
        return await _retry(_call)
    except Exception as e:
        if "cached content is too small" in str(e).lower():
            logger.info("Retrying with_tools without cache_control (prompt too short for Gemini caching)")
            _msgs = _strip_cache_control(messages)
            return await _call()
        raise
