"""Chat pipeline tests: prompt integrity, context injection, routing edge cases.

Two categories:
1. Prompt snapshot tests — verify system prompts contain critical instructions (fast, no LLM)
2. Golden-set tests — send real queries to the LLM and assert routing (slow, costs money)
   Run with: pytest -m slow
"""
import json
import pytest
from unittest.mock import AsyncMock, patch


# ═══════════════════════════════════════════════════════════════════
# Prompt snapshot tests — fast, no LLM, catch accidental prompt edits
# ═══════════════════════════════════════════════════════════════════


def test_router_prompt_contains_all_agent_categories():
    """If someone edits the router prompt and drops a category, this catches it."""
    from agents.router import RouterAgent

    router = RouterAgent()
    prompt = router.system_prompt

    expected_agents = ["village_code", "permit", "community", "report", "vision", "general", "off_topic"]
    for agent in expected_agents:
        assert agent in prompt, f"Router prompt missing agent category: {agent}"


def test_router_prompt_requires_json_output():
    """Router must instruct the LLM to return JSON."""
    from agents.router import RouterAgent

    prompt = RouterAgent().system_prompt
    assert "JSON" in prompt
    assert '"agent"' in prompt
    assert '"refined_query"' in prompt


def test_router_valid_agents_match_prompt():
    """The valid_agents set in run() must match what the prompt advertises."""
    from agents.router import RouterAgent
    import re

    router = RouterAgent()
    # Extract agent names from the prompt (lines like - "village_code" —)
    prompt_agents = set(re.findall(r'"(\w+)"(?:\s*—)', router.system_prompt))
    # The hardcoded set in run()
    code_agents = {"village_code", "permit", "community", "report", "vision", "general", "off_topic"}

    assert prompt_agents == code_agents, (
        f"Mismatch between prompt categories {prompt_agents} and code validation set {code_agents}"
    )


def test_context_injection_includes_village():
    """Village name must appear in system prompt when provided."""
    from agents.base import BaseAgent

    agent = BaseAgent()
    messages = agent._build_messages(
        "test query",
        context={"village": "Great Neck Plaza", "history": []},
    )

    full_system = _extract_system_text(messages)
    assert "Great Neck Plaza" in full_system


def test_context_injection_includes_jurisdiction_hierarchy():
    """System prompt should explain the jurisdiction hierarchy when village is set."""
    from agents.base import BaseAgent

    agent = BaseAgent()
    messages = agent._build_messages(
        "test query",
        context={"village": "Thomaston", "history": []},
    )

    full_system = _extract_system_text(messages)
    assert "Nassau County" in full_system
    assert "Town of North Hempstead" in full_system


def test_context_injection_includes_playbook_catalog():
    """Playbook catalog must be injected with carousel instructions."""
    from agents.base import BaseAgent

    catalog = [{"id": "g1", "title": "Winter Prep", "description": "Winterize your home"}]
    agent = BaseAgent()
    messages = agent._build_messages(
        "how do I prepare for winter?",
        context={"village": "", "history": [], "playbook_catalog": catalog},
    )

    full_system = _extract_system_text(messages)
    assert "Winter Prep" in full_system
    assert "playbook-carousel" in full_system


def test_context_injection_no_catalog_when_empty():
    """No playbook section in prompt when catalog is empty/None."""
    from agents.base import BaseAgent

    agent = BaseAgent()
    messages = agent._build_messages(
        "hello",
        context={"village": "", "history": [], "playbook_catalog": None},
    )

    full_system = _extract_system_text(messages)
    assert "playbook-carousel" not in full_system


def test_context_injection_chinese_language():
    """Chinese language instruction must appear when language=zh."""
    from agents.base import BaseAgent

    agent = BaseAgent()
    messages = agent._build_messages(
        "zoning rules",
        context={"village": "", "history": [], "language": "zh"},
    )

    full_system = _extract_system_text(messages)
    assert "简体中文" in full_system


def test_context_injection_search_plan():
    """Search plan must be injected when provided."""
    from agents.base import BaseAgent

    agent = BaseAgent()
    messages = agent._build_messages(
        "test",
        context={"village": "", "history": []},
        search_plan="1. Search zoning codes\n2. Check setback tables",
    )

    full_system = _extract_system_text(messages)
    assert "Search zoning codes" in full_system
    assert "Search Plan" in full_system


def test_context_injection_critic_feedback():
    """Critic feedback must be injected when provided."""
    from agents.base import BaseAgent

    agent = BaseAgent()
    messages = agent._build_messages(
        "test",
        context={"village": "", "history": []},
        critic_feedback="Response was missing specific code section numbers",
    )

    full_system = _extract_system_text(messages)
    assert "missing specific code section numbers" in full_system
    assert "Critic Feedback" in full_system


def test_data_freshness_warning_present():
    """All agents should include the data freshness warning."""
    from agents.base import BaseAgent

    agent = BaseAgent()
    messages = agent._build_messages("test", context=None)
    full_system = _extract_system_text(messages)

    assert "Data Freshness" in full_system
    assert "outdated" in full_system


def test_bluf_formatting_instruction_present():
    """All agents should include BLUF formatting instruction."""
    from agents.base import BaseAgent

    agent = BaseAgent()
    messages = agent._build_messages("test", context=None)
    full_system = _extract_system_text(messages)

    assert "BLUF" in full_system
    assert "Bottom Line Up Front" in full_system


# ═══════════════════════════════════════════════════════════════════
# Router edge-case tests — mock LLM, test parsing/fallback logic
# ═══════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_router_handles_malformed_json():
    """Router should default to 'general' when LLM returns garbage."""
    from agents.router import RouterAgent

    with patch("agents.router.llm_call", new_callable=AsyncMock, return_value="I'm not sure"):
        router = RouterAgent()
        result = await router.run("hello")

    assert result["agent"] == "general"
    assert result["refined_query"] == "hello"


@pytest.mark.asyncio
async def test_router_handles_markdown_wrapped_json():
    """Router should strip markdown code blocks around JSON."""
    from agents.router import RouterAgent

    mock_response = '```json\n{"agent": "community", "refined_query": "events this weekend"}\n```'

    with patch("agents.router.llm_call", new_callable=AsyncMock, return_value=mock_response):
        router = RouterAgent()
        result = await router.run("What's happening this weekend?")

    assert result["agent"] == "community"
    assert result["refined_query"] == "events this weekend"


@pytest.mark.asyncio
async def test_router_rejects_invalid_agent_name():
    """Router should fall back to 'general' for unknown agent names."""
    from agents.router import RouterAgent

    mock_response = json.dumps({"agent": "hacker_agent", "refined_query": "test"})

    with patch("agents.router.llm_call", new_callable=AsyncMock, return_value=mock_response):
        router = RouterAgent()
        result = await router.run("test")

    assert result["agent"] == "general"


# ═══════════════════════════════════════════════════════════════════
# Golden-set tests — real LLM calls, run with: pytest -m slow
# These cost money and take seconds. Run nightly or before deploy.
# ═══════════════════════════════════════════════════════════════════


GOLDEN_ROUTING_CASES = [
    ("What are the setback requirements for R-1 zoning?", "village_code"),
    ("Do I need a permit to build a deck?", "permit"),
    ("What events are happening this weekend?", "community"),
    ("I want to report a pothole on Middle Neck Road", "report"),
    ("Help me write a Python function", "off_topic"),
    ("Hi there!", "general"),
]


@pytest.mark.slow
@pytest.mark.asyncio
@pytest.mark.parametrize("query,expected_agent", GOLDEN_ROUTING_CASES)
async def test_golden_routing(query: str, expected_agent: str):
    """Send real queries to the LLM and verify routing decisions.

    Calls llm_call directly with plain messages (no cache_control) to avoid
    Gemini's context caching minimum token requirement. The router prompt is
    only ~987 tokens, below Gemini's 1024 minimum for cached content.
    """
    from agents.router import RouterAgent
    from llm.provider import llm_call

    router = RouterAgent()
    # Build messages but strip cache_control to avoid Gemini caching error
    messages = [
        {"role": "system", "content": router.system_prompt},
        {"role": "user", "content": query},
    ]
    response_text = await llm_call(
        messages=messages, role="router", temperature=0.0, max_tokens=256,
    )

    # Apply same parsing logic as RouterAgent.run()
    cleaned = response_text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        cleaned = cleaned.rsplit("```", 1)[0].strip()
    try:
        decision = json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        decision = {"agent": "general", "refined_query": query}

    assert decision["agent"] == expected_agent, (
        f"Query '{query}' routed to '{decision['agent']}', expected '{expected_agent}'. "
        f"Raw LLM response: {response_text[:200]}"
    )


# ═══════════════════════════════════════════════════════════════════
# E2E smoke test — full pipeline through /api/chat/stream
# Catches integration bugs (e.g. numpy array truthiness in ChromaDB)
# that unit tests miss because mocks return plain Python types.
# ═══════════════════════════════════════════════════════════════════


@pytest.mark.slow
@pytest.mark.asyncio
async def test_chat_stream_e2e():
    """Send a real message through the full pipeline and verify SSE tokens come back.

    Exercises: embedding → semantic cache → RAG search → router → planner →
    agent → tool calls → SSE streaming. Uses a simple greeting to avoid
    dependency on knowledge base content.
    """
    import httpx
    from main import app
    from httpx import ASGITransport
    from tests.conftest import create_test_user, mint_token

    user = create_test_user(email="e2e-chat@test.pytest", name="E2E Test")
    token = mint_token(user["id"])

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        timeout=60.0,
    ) as client:
        # Create a conversation
        conv_resp = await client.post(
            "/api/conversations",
            json={"village": ""},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert conv_resp.status_code == 200
        conv_id = conv_resp.json()["id"]

        # Send chat via SSE stream
        response = await client.post(
            "/api/chat/stream",
            json={
                "message": "Hi, what can you help me with?",
                "village": "",
                "conversation_id": conv_id,
            },
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "text/event-stream",
            },
        )
        assert response.status_code == 200

        # Parse SSE events
        events = _parse_sse(response.text)
        assert len(events) > 0, "No SSE events received"

        # No error events
        error_events = [e for e in events if e.get("_event") == "error"]
        assert not error_events, f"Got error: {error_events}"

        # Must have token or response events (streamed answer)
        token_events = [e for e in events if e.get("_event") == "token"]
        response_events = [e for e in events if e.get("_event") == "response"]
        assert token_events or response_events, (
            f"No answer events. Event types: {[e.get('_event') for e in events]}"
        )

        # Reconstruct response text
        if token_events:
            full_text = "".join(e.get("text", "") for e in token_events)
        else:
            full_text = response_events[0].get("response", "")

        assert len(full_text) > 10, f"Response too short: {full_text[:100]}"

        # Must end with a response event (final answer)
        assert any(e.get("_event") == "response" for e in events), "Missing response event"


def _parse_sse(text: str) -> list[dict]:
    """Parse SSE text into a list of {event_type, ...data} dicts."""
    events = []
    current_event = None
    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("event: "):
            current_event = line[7:]
        elif line.startswith("data: "):
            data_str = line[6:]
            if data_str == "[DONE]":
                continue
            try:
                data = json.loads(data_str)
                data["_event"] = current_event
                events.append(data)
            except json.JSONDecodeError:
                pass
            current_event = None
    return events


# ═══════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════


def _extract_system_text(messages: list[dict]) -> str:
    """Extract full system prompt text from message list."""
    system_content = messages[0]["content"]
    if isinstance(system_content, list):
        return " ".join(part["text"] for part in system_content)
    return system_content
