"""Auth dependencies for FastAPI routes."""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from jose import jwt, JWTError
from config import settings
from db import get_user_by_id
from api.aio import run_sync


async def get_current_user(authorization: str = Header(...)) -> dict:
    """Require a valid JWT. Returns user dict or raises 401."""
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = await run_sync(get_user_by_id, int(user_id))
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Require is_admin=1. Returns user or raises 403."""
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def require_debug(user: dict = Depends(get_current_user)) -> dict:
    """Require is_admin=1 or can_debug=1. Returns user or raises 403."""
    if not user.get("is_admin") and not user.get("can_debug"):
        raise HTTPException(status_code=403, detail="Debug access required")
    return user


async def get_optional_user(authorization: str | None = Header(default=None)) -> dict | None:
    """Like get_current_user but returns None instead of 401 if no/invalid token."""
    if not authorization:
        return None
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id = payload.get("sub")
        if user_id is None:
            return None
        return await run_sync(get_user_by_id, int(user_id))
    except JWTError:
        return None
