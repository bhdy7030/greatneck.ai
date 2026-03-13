"""Auth integration tests: JWT mint/validate, refresh tokens, user upsert."""
from jose import jwt, JWTError
from config import settings
from tests.conftest import create_test_user, mint_token


def test_upsert_user_creates_and_returns():
    user = create_test_user()
    assert user["email"] == "alice@test.pytest"
    assert user["name"] == "Alice Test"
    assert user["id"] > 0


def test_upsert_user_idempotent():
    u1 = create_test_user()
    u2 = create_test_user()
    assert u1["id"] == u2["id"]


def test_jwt_roundtrip():
    user = create_test_user()
    token = mint_token(user["id"])
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    assert payload["sub"] == str(user["id"])


def test_jwt_invalid_secret_rejects():
    user = create_test_user()
    token = mint_token(user["id"])
    try:
        jwt.decode(token, "wrong-secret", algorithms=[settings.jwt_algorithm])
        assert False, "Should have raised"
    except JWTError:
        pass


def test_refresh_token_roundtrip():
    from db import create_refresh_token, validate_refresh_token, revoke_user_refresh_tokens
    user = create_test_user()
    token = create_refresh_token(user["id"])
    assert len(token) > 20

    validated = validate_refresh_token(token)
    assert validated is not None
    assert validated["id"] == user["id"]

    revoke_user_refresh_tokens(user["id"])
    assert validate_refresh_token(token) is None
