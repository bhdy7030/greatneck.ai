"""Google OAuth authentication routes."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import RedirectResponse
from jose import jwt
import httpx

from config import settings
from db import upsert_user, list_users, update_user_permissions
from api.deps import get_current_user, require_admin

router = APIRouter()

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def _create_jwt(user_id: int) -> str:
    """Mint a JWT for the given user."""
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


@router.get("/auth/google")
async def google_login(return_to: str = "/chat/"):
    """Redirect to Google OAuth consent screen."""
    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.google_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
        "state": return_to,
    }
    return RedirectResponse(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@router.get("/auth/google/callback")
async def google_callback(code: str, state: str = "/chat/"):
    """Exchange auth code for user info, upsert user, mint JWT, redirect to frontend."""
    # Exchange code for tokens
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if token_resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to exchange auth code")
        tokens = token_resp.json()

        # Get user info
        userinfo_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        if userinfo_resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to fetch user info")
        userinfo = userinfo_resp.json()

    # Upsert user in DB
    user = upsert_user(
        google_id=userinfo["sub"],
        email=userinfo.get("email", ""),
        name=userinfo.get("name", ""),
        avatar_url=userinfo.get("picture", ""),
    )

    # Auto-grant admin for configured emails
    admin_list = [e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()]
    if user.get("email", "").lower() in admin_list and not user.get("is_admin"):
        user = update_user_permissions(user["id"], is_admin=1) or user

    token = _create_jwt(user["id"])
    # Redirect back to the page the user started login from
    return_path = state if state.startswith("/") else "/chat/"
    sep = "&" if "?" in return_path else "?"
    return RedirectResponse(f"{settings.frontend_url}{return_path}{sep}token={token}")


@router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    """Return the current authenticated user's info."""
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "avatar_url": user["avatar_url"],
        "is_admin": bool(user.get("is_admin")),
        "can_debug": bool(user.get("can_debug")),
    }


@router.get("/auth/users")
async def get_users(user: dict = Depends(require_admin)):
    """List all users (admin only)."""
    users = list_users()
    return [
        {
            "id": u["id"],
            "email": u["email"],
            "name": u["name"],
            "is_admin": bool(u.get("is_admin")),
            "can_debug": bool(u.get("can_debug")),
            "last_login_at": u.get("last_login_at"),
        }
        for u in users
    ]


@router.put("/auth/users/{user_id}/permissions")
async def set_user_permissions(
    user_id: int,
    body: dict,
    user: dict = Depends(require_admin),
):
    """Update a user's permission flags (admin only)."""
    updated = update_user_permissions(
        user_id,
        is_admin=body.get("is_admin"),
        can_debug=body.get("can_debug"),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": updated["id"],
        "email": updated["email"],
        "name": updated["name"],
        "is_admin": bool(updated.get("is_admin")),
        "can_debug": bool(updated.get("can_debug")),
    }
