"""Shared fixtures for integration tests.

Requires a running PostgreSQL instance. Uses the same DATABASE_URL env var as the app.
Run: DATABASE_URL=postgresql://askmura:localdev@localhost:5432/askmura pytest
"""
import os
import pytest
from datetime import datetime, timedelta, timezone
from jose import jwt

# Ensure DATABASE_URL is set before any db imports
assert os.environ.get("DATABASE_URL"), (
    "DATABASE_URL must be set. Run: "
    "DATABASE_URL=postgresql://askmura:localdev@localhost:5432/askmura pytest"
)

# Set a test JWT secret
os.environ.setdefault("JWT_SECRET", "test-secret-for-pytest")

from config import settings
settings.jwt_secret = "test-secret-for-pytest"
settings.invite_required = False

from db import init_db, close_pg_pool
from db.connection import _exec_modify


@pytest.fixture(scope="session", autouse=True)
def setup_db():
    """Initialize DB schema once for the test session."""
    init_db()
    yield
    close_pg_pool()


@pytest.fixture(autouse=True)
def clean_test_data():
    """Clean up test data after each test."""
    yield
    # Delete test data in reverse dependency order — use parameterized LIKE
    # Clean by test user IDs — covers ug-* guides created by test users
    test_user_q = "SELECT id FROM users WHERE email LIKE %s"
    p = ("%@test.pytest",)
    _exec_modify("DELETE FROM guide_comments WHERE user_id IN (" + test_user_q + ")", p)
    _exec_modify("DELETE FROM likes WHERE user_id IN (" + test_user_q + ")", p)
    _exec_modify("DELETE FROM notifications WHERE user_id IN (" + test_user_q + ")", p)
    _exec_modify("DELETE FROM guide_step_status WHERE guide_id LIKE %s", ("test-%",))
    _exec_modify("DELETE FROM guide_saves WHERE guide_id LIKE %s", ("test-%",))
    _exec_modify("DELETE FROM user_guides WHERE user_id IN (" + test_user_q + ")", p)
    _exec_modify("DELETE FROM refresh_tokens WHERE user_id IN (" + test_user_q + ")", p)
    _exec_modify("DELETE FROM usage_tracking WHERE session_id LIKE %s", ("test-%",))
    _exec_modify("DELETE FROM conversations WHERE user_id IN (" + test_user_q + ")", p)
    _exec_modify("DELETE FROM waitlist WHERE email LIKE %s", p)
    _exec_modify("DELETE FROM users WHERE email LIKE %s", p)


def create_test_user(email: str = "alice@test.pytest", name: str = "Alice Test") -> dict:
    """Create a test user and return the user dict."""
    from db import upsert_user
    return upsert_user(
        google_id=f"google-{email}",
        email=email,
        name=name,
        avatar_url="",
    )


def mint_token(user_id: int) -> str:
    """Mint a JWT for a test user."""
    expire = datetime.now(timezone.utc) + timedelta(hours=1)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def auth_headers(user_id: int) -> dict:
    """Return Authorization header dict for a test user."""
    return {"Authorization": f"Bearer {mint_token(user_id)}"}
