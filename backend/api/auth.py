"""Google & Apple OAuth authentication routes."""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import RedirectResponse
from jose import jwt
import httpx
from pydantic import BaseModel

from config import settings
from db import (
    upsert_user, upsert_user_apple, list_users, update_user_permissions,
    set_user_tier, set_promo_expiry,
    create_refresh_token, validate_refresh_token, revoke_user_refresh_tokens,
)
from api.deps import get_current_user, require_admin

router = APIRouter()

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize"
APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"


def _create_jwt(user_id: int) -> str:
    """Mint a JWT for the given user."""
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


def _finalize_login(user: dict, return_path: str) -> RedirectResponse:
    """Shared post-login logic: admin/pro grants, promo, mint tokens, redirect."""
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
    rp = return_path if return_path.startswith("/") else "/chat/"
    sep = "&" if "?" in rp else "?"
    return RedirectResponse(
        f"{settings.frontend_url}{rp}{sep}token={access_token}&refresh={refresh_token}",
        status_code=303,
    )


# ── Google OAuth ──


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

        userinfo_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        if userinfo_resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to fetch user info")
        userinfo = userinfo_resp.json()

    user = upsert_user(
        google_id=userinfo["sub"],
        email=userinfo.get("email", ""),
        name=userinfo.get("name", ""),
        avatar_url=userinfo.get("picture", ""),
    )

    return _finalize_login(user, state)


# ── Apple Sign In ──


def _generate_apple_client_secret() -> str:
    """Generate a short-lived ES256 JWT used as the client_secret for Apple token exchange."""
    now = int(time.time())
    # Handle newlines in env-var-encoded private keys
    private_key = settings.apple_private_key.replace("\\n", "\n")
    return jwt.encode(
        {
            "iss": settings.apple_team_id,
            "iat": now,
            "exp": now + 86400 * 180,  # 6 months max
            "aud": "https://appleid.apple.com",
            "sub": settings.apple_client_id,
        },
        private_key,
        algorithm="ES256",
        headers={"kid": settings.apple_key_id},
    )


async def _fetch_apple_jwks() -> dict:
    """Fetch Apple's public JWKS for id_token verification."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(APPLE_JWKS_URL)
        resp.raise_for_status()
        return resp.json()


@router.get("/auth/apple")
async def apple_login(return_to: str = "/chat/"):
    """Redirect to Apple Sign In consent screen."""
    params = {
        "client_id": settings.apple_client_id,
        "redirect_uri": settings.apple_redirect_uri,
        "response_type": "code",
        "scope": "name email",
        "response_mode": "form_post",
        "state": return_to,
    }
    return RedirectResponse(f"{APPLE_AUTH_URL}?{urlencode(params)}")


@router.post("/auth/apple/callback")
async def apple_callback(request: Request):
    """Handle Apple's POST callback: exchange code, verify id_token, upsert user."""
    form = await request.form()
    code = form.get("code")
    state = form.get("state", "/chat/")
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")

    # Apple sends user info (name) as JSON only on FIRST authorization
    user_json = form.get("user")
    apple_name = ""
    if user_json:
        import json
        try:
            user_data = json.loads(user_json)
            first = user_data.get("name", {}).get("firstName", "")
            last = user_data.get("name", {}).get("lastName", "")
            apple_name = f"{first} {last}".strip()
        except (json.JSONDecodeError, AttributeError):
            pass

    # Exchange code for tokens
    client_secret = _generate_apple_client_secret()
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            APPLE_TOKEN_URL,
            data={
                "client_id": settings.apple_client_id,
                "client_secret": client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": settings.apple_redirect_uri,
            },
        )
        if token_resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to exchange Apple auth code")
        tokens = token_resp.json()

    id_token = tokens.get("id_token")
    if not id_token:
        raise HTTPException(status_code=400, detail="No id_token from Apple")

    # Verify id_token against Apple's JWKS
    jwks = await _fetch_apple_jwks()

    # Decode header to find the right key
    header = jwt.get_unverified_header(id_token)
    kid = header.get("kid")
    apple_key = None
    for key in jwks.get("keys", []):
        if key["kid"] == kid:
            apple_key = key
            break
    if not apple_key:
        raise HTTPException(status_code=400, detail="Apple JWKS key not found")

    # Verify and decode (skip at_hash check — we don't need the access_token)
    claims = jwt.decode(
        id_token,
        apple_key,
        algorithms=["RS256"],
        audience=settings.apple_client_id,
        issuer="https://appleid.apple.com",
        options={"verify_at_hash": False},
    )

    apple_sub = claims["sub"]
    email = claims.get("email", "")
    if not email:
        raise HTTPException(status_code=400, detail="Apple did not provide email")

    user = upsert_user_apple(
        apple_id=apple_sub,
        email=email,
        name=apple_name,
    )

    return _finalize_login(user, state)


# ── User Info ──


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
        "is_invited": bool(user.get("is_invited")),
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
            "is_invited": bool(u.get("is_invited")),
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
    tier: str  # "free" (community) or "pro" (sponsor)


@router.put("/auth/users/{user_id}/tier")
async def set_user_tier_endpoint(
    user_id: int,
    body: TierUpdateRequest,
    user: dict = Depends(require_admin),
):
    """Admin: set a user's tier to 'free' (community) or 'pro' (sponsor)."""
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
