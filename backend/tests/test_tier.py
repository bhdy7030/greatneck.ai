"""Tier and usage tracking tests."""
from tests.conftest import create_test_user


def test_usage_tracking_roundtrip():
    from db import get_or_create_usage, increment_usage
    user = create_test_user()

    usage = get_or_create_usage("test-session-1", user["id"])
    assert usage["query_count"] == 0

    usage2 = increment_usage("test-session-1")
    assert usage2["query_count"] == 1

    usage3 = increment_usage("test-session-1")
    assert usage3["query_count"] == 2


def test_extended_trial_claim():
    from db import get_or_create_usage, claim_extended_trial
    get_or_create_usage("test-session-2")

    assert claim_extended_trial("test-session-2") is True
    assert claim_extended_trial("test-session-2") is False  # already claimed
