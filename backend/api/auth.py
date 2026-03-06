"""Google OAuth authentication routes."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import RedirectResponse
from jose import jwt
import httpx
from pydantic import BaseModel

from config import settings
from db import (
    upsert_user, list_users, update_user_permissions,
    set_user_tier, set_promo_expiry,
    create_refresh_token, validate_refresh_token, revoke_user_refresh_tokens,
)
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

    # Auto-grant pro tier for configured emails
    pro_list = [e.strip().lower() for e in settings.pro_emails.split(",") if e.strip()]
    if user.get("email", "").lower() in pro_list and user.get("tier") != "pro":
        user = set_user_tier(user["id"], "pro") or user

    # Set promo expiry for new free users (no promo set yet, not pro)
    if user.get("tier", "free") == "free" and not user.get("promo_expires_at") and settings.free_promo_days > 0:
        promo_exp = (datetime.now(timezone.utc) + timedelta(days=settings.free_promo_days)).isoformat()
        user = set_promo_expiry(user["id"], promo_exp) or user

    # Mint tokens
    access_token = _create_jwt(user["id"])
    refresh_token = create_refresh_token(user["id"])

    # Redirect back to the page the user started login from
    return_path = state if state.startswith("/") else "/chat/"
    sep = "&" if "?" in return_path else "?"
    return RedirectResponse(
        f"{settings.frontend_url}{return_path}{sep}token={access_token}&refresh={refresh_token}"
    )


@router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    """Return the current authenticated user's info."""
    from api.tier import resolve_tier
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "avatar_url": user["avatar_url"],
        "is_admin": bool(user.get("is_admin")),
        "can_debug": bool(user.get("can_debug")),
        "tier": resolve_tier(user),
        "promo_expires_at": user.get("promo_expires_at"),
    }


@router.get("/auth/users")
async def get_users(user: dict = Depends(require_admin)):
    """List all users (admin only)."""
    from api.tier import resolve_tier
    users = list_users()
    return [
        {
            "id": u["id"],
            "email": u["email"],
            "name": u["name"],
            "is_admin": bool(u.get("is_admin")),
            "can_debug": bool(u.get("can_debug")),
            "tier": resolve_tier(u),
            "raw_tier": u.get("tier", "free"),
            "promo_expires_at": u.get("promo_expires_at"),
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


# ── Refresh Tokens ──


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/auth/refresh")
async def refresh_access_token(body: RefreshRequest):
    """Exchange a valid refresh token for a new access JWT."""
    user = validate_refresh_token(body.refresh_token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    access_token = _create_jwt(user["id"])
    return {"token": access_token}


@router.post("/auth/logout")
async def logout_user(body: RefreshRequest):
    """Revoke all refresh tokens for the user."""
    user = validate_refresh_token(body.refresh_token)
    if user:
        revoke_user_refresh_tokens(user["id"])
    return {"ok": True}


# ── Admin Tier Management ──


class TierUpdateRequest(BaseModel):
    tier: str  # "free" or "pro"


@router.put("/auth/users/{user_id}/tier")
async def set_user_tier_endpoint(
    user_id: int,
    body: TierUpdateRequest,
    user: dict = Depends(require_admin),
):
    """Admin: set a user's tier to 'free' or 'pro'."""
    if body.tier not in ("free", "pro"):
        raise HTTPException(status_code=400, detail="Tier must be 'free' or 'pro'")
    updated = set_user_tier(user_id, body.tier)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": updated["id"], "email": updated["email"], "tier": updated.get("tier", "free")}


class PromoUpdateRequest(BaseModel):
    days: int  # 0 = remove promo, positive = set N days from now


@router.put("/auth/users/{user_id}/promo")
async def set_user_promo_endpoint(
    user_id: int,
    body: PromoUpdateRequest,
    user: dict = Depends(require_admin),
):
    """Admin: set or extend a user's promo trial period."""
    if body.days <= 0:
        updated = set_promo_expiry(user_id, None)
    else:
        promo_exp = (datetime.now(timezone.utc) + timedelta(days=body.days)).isoformat()
        updated = set_promo_expiry(user_id, promo_exp)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": updated["id"], "email": updated["email"], "promo_expires_at": updated.get("promo_expires_at")}
