"""Lightweight tool registry. Agents declare which tools they use."""
from __future__ import annotations

import inspect
import json
from dataclasses import dataclass, field
from typing import Any, Callable, get_type_hints


@dataclass
class Tool:
    name: str
    description: str
    fn: Callable
    parameters: dict = field(default_factory=dict)

    def to_openai_tool(self) -> dict:
        """Convert to OpenAI-compatible tool schema (used by LiteLLM)."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


# Global registry
_TOOLS: dict[str, Tool] = {}


def tool(name: str, description: str):
    """Decorator to register a function as a tool."""

    def decorator(fn: Callable) -> Tool:
        params = _extract_params(fn)
        t = Tool(name=name, description=description, fn=fn, parameters=params)
        _TOOLS[name] = t
        return t

    return decorator


def get_tool(name: str) -> Tool | None:
    return _TOOLS.get(name)


def get_tools_for_agent(tool_names: list[str]) -> list[Tool]:
    return [_TOOLS[n] for n in tool_names if n in _TOOLS]


async def execute_tool(name: str, arguments: dict[str, Any]) -> str:
    """Execute a tool by name with given arguments. Returns string result."""
    from cache import tool_cache, make_key, CACHEABLE_TOOLS

    # Check tool result cache for deterministic tools
    use_cache = name in CACHEABLE_TOOLS
    if use_cache:
        cache_key = make_key("tool", name, arguments)
        cached = tool_cache.get(cache_key)
        if cached is not None:
            return cached

    t = _TOOLS.get(name)
    if not t:
        return json.dumps({"error": f"Unknown tool: {name}"})
    try:
        result = t.fn(**arguments)
        if inspect.isawaitable(result):
            result = await result
        if isinstance(result, str):
            if use_cache:
                tool_cache.set(cache_key, result)
            return result
        dumped = json.dumps(result, default=str)
        if use_cache:
            tool_cache.set(cache_key, dumped)
        return dumped
    except Exception as e:
        return json.dumps({"error": str(e)})


def _extract_params(fn: Callable) -> dict:
    """Extract JSON Schema parameters from function signature."""
    hints = get_type_hints(fn)
    sig = inspect.signature(fn)
    properties = {}
    required = []
    for param_name, param in sig.parameters.items():
        if param_name in ("self", "cls"):
            continue
        hint = hints.get(param_name, str)
        prop: dict[str, Any] = {"type": _python_type_to_json(hint)}
        if param.default is inspect.Parameter.empty:
            required.append(param_name)
        else:
            prop["default"] = param.default
        properties[param_name] = prop

    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


def _python_type_to_json(t: type) -> str:
    mapping = {str: "string", int: "integer", float: "number", bool: "boolean"}
    return mapping.get(t, "string")
