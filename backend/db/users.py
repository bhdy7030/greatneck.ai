"""User CRUD, handles, profiles, tiers, avatars, bios."""
from __future__ import annotations

import re as _re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from db.connection import _exec, _exec_one, _exec_modify, _exec_scalar, _exec_insert_returning

_ET = ZoneInfo("America/New_York")

# ── Handle validation ────────────────────────────────────────────

_HANDLE_RE = _re.compile(r'^[a-z0-9]([a-z0-9-]{1,18}[a-z0-9])?$')

_RESERVED_HANDLES = {
    "admin", "administrator", "system", "sysadmin", "systemadmin",
    "greatneck", "great-neck", "great-neck-ai",
    "tinydesk", "tiny-desk",
    "moderator", "mod", "support", "help", "info",
    "root", "superuser", "staff", "official",
}

_VIBE_POOLS = {
    "commuter": [
        "lirrexpress", "quietcar", "plazaparking",
        "northernblvd", "portwash", "pennbound",
        "platform9", "expresslocal", "peakfare",
        "trainnap", "parkinglot", "morningrush",
        "metrocard", "tunnelview", "windowseat",
        "rushhour", "latetrain", "serialcommuter",
        "proplatformer", "parkingwhisper",
        "trainbrainner", "exitstrategist",
        "platformpoet", "commuterchamp",
    ],
    "foodie": [
        "bagelrun", "hmarthaul", "colbehrice",
        "lugersteak", "cavabowl", "bakeryline",
        "matcharun", "dimsum", "pizzaslice",
        "deliorder", "brunchwait", "sushispot",
        "coffeedrip", "tacotruck", "ramenbowl",
        "bodegacat", "croissant", "bobadrop",
        "snackarchitect", "brunchstrategist",
        "menuscholar", "samplechamp", "tastescout",
        "leftoverkng", "sauceboss", "spicesensei",
    ],
    "family": [
        "southhigh", "northhigh", "ptachair",
        "schooldrop", "lunchpack", "fieldtrip",
        "backpackhero", "permissionslip",
        "storytime", "playground", "naptime",
        "strategicstroller", "napnegotiator",
        "snackdistributor", "goldstarparent",
        "carpooldiplomat", "camplotteryking",
        "recitalsurvivor", "schedulejuggler",
        "snowdaychamp", "laundryolympian",
        "steppingstone", "parkwoodrink",
        "parkbench", "splashpad", "picnicpro",
        "sundayscooter", "bikelaner",
        "pianopractice", "matholympian",
        "sciencefairpro", "spellingbeecoach",
    ],
    "homebody": [
        "kingspoint", "saddlerock", "westegg",
        "kensington", "lakesuccess", "villagecode",
        "porchlife", "lawncare", "sunsetview",
        "culdesac", "yardsale", "blockparty",
        "frontporch", "gardenhose", "sprinkler",
        "firepit", "hammock", "backyard",
        "couchmayor", "pillowfort", "blanketceo",
        "remotecontroller", "deliveryloyalist",
        "thermostatking", "porchphilospher",
        "zonecodewarrior", "leafblowerhero",
    ],
}


# ── User CRUD ────────────────────────────────────────────────────

def upsert_user(google_id: str, email: str, name: str, avatar_url: str = "") -> dict:
    """Insert or update a user from Google OAuth. Upserts by email so accounts link automatically."""
    now = datetime.now(_ET).isoformat()
    _exec_modify(
        """INSERT INTO users (google_id, email, name, avatar_url, created_at, last_login_at)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT(email) DO UPDATE SET
             google_id=EXCLUDED.google_id, name=EXCLUDED.name,
             avatar_url=EXCLUDED.avatar_url, last_login_at=%s""",
        (google_id, email, name, avatar_url, now, now, now),
    )
    return _exec_one(
        "SELECT * FROM users WHERE email=%s",
        (email,),
    )


def upsert_user_apple(apple_id: str, email: str, name: str) -> dict:
    """Insert or update a user from Apple Sign In. Upserts by email so accounts link automatically."""
    now = datetime.now(_ET).isoformat()
    _exec_modify(
        """INSERT INTO users (apple_id, email, name, created_at, last_login_at)
           VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT(email) DO UPDATE SET
             apple_id=EXCLUDED.apple_id,
             name=CASE WHEN users.name='' OR users.name IS NULL THEN EXCLUDED.name ELSE users.name END,
             last_login_at=%s""",
        (apple_id, email, name, now, now, now),
    )
    return _exec_one(
        "SELECT * FROM users WHERE email=%s",
        (email,),
    )


def get_user_by_id(user_id: int) -> dict | None:
    return _exec_one(
        "SELECT * FROM users WHERE id=%s",
        (user_id,),
    )


def list_users() -> list[dict]:
    return _exec("SELECT * FROM users ORDER BY id")


def update_user_permissions(user_id: int, is_admin: int | None = None, can_debug: int | None = None) -> dict | None:
    parts, params = [], []
    if is_admin is not None:
        parts.append("is_admin=%s")
        params.append(bool(is_admin))
    if can_debug is not None:
        parts.append("can_debug=%s")
        params.append(bool(can_debug))
    if not parts:
        return get_user_by_id(user_id)
    params.append(user_id)
    sql = f"UPDATE users SET {', '.join(parts)} WHERE id=%s"
    _exec_modify(sql, tuple(params))
    return get_user_by_id(user_id)


def set_user_tier(user_id: int, tier: str) -> dict | None:
    _exec_modify(
        "UPDATE users SET tier=%s WHERE id=%s",
        (tier, user_id),
    )
    return get_user_by_id(user_id)


def set_promo_expiry(user_id: int, expires_at: str) -> dict | None:
    _exec_modify(
        "UPDATE users SET promo_expires_at=%s WHERE id=%s",
        (expires_at, user_id),
    )
    return get_user_by_id(user_id)


def get_total_users() -> int:
    val = _exec_scalar("SELECT COUNT(*) AS cnt FROM users")
    return val if val else 0


def get_tier_breakdown() -> dict:
    rows = _exec("SELECT id, tier, promo_expires_at, is_admin FROM users")
    counts = {"free": 0, "free_promo": 0, "pro": 0}
    now = datetime.now(timezone.utc)
    for r in rows:
        if r["is_admin"] or r["tier"] == "pro":
            counts["pro"] += 1
        elif r["promo_expires_at"]:
            try:
                exp = datetime.fromisoformat(str(r["promo_expires_at"]))
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if now < exp:
                    counts["free_promo"] += 1
                else:
                    counts["free"] += 1
            except (ValueError, TypeError):
                counts["free"] += 1
        else:
            counts["free"] += 1
    return counts


def mark_user_invited(user_id: int) -> dict | None:
    _exec_modify(
        "UPDATE users SET is_invited=TRUE WHERE id=%s",
        (user_id,),
    )
    return get_user_by_id(user_id)


# ── Profile / Handle functions ───────────────────────────────────

def _validate_handle(handle: str) -> bool:
    """Check handle format: 3-20 chars, lowercase alphanumeric + hyphens, no leading/trailing/consecutive hyphens."""
    if not handle or len(handle) < 3 or len(handle) > 20:
        return False
    if '--' in handle:
        return False
    return bool(_HANDLE_RE.match(handle))


def check_handle_available(handle: str, exclude_user_id: int | None = None) -> bool:
    """Check if a handle is available. Optionally exclude a user (for handle changes)."""
    if not _validate_handle(handle):
        return False
    if handle.lower() in _RESERVED_HANDLES:
        if exclude_user_id is not None:
            current = _exec_one(
                "SELECT handle FROM users WHERE id=%s",
                (exclude_user_id,),
            )
            if current and current.get("handle") == handle.lower():
                return True
        return False
    if exclude_user_id is not None:
        row = _exec_scalar(
            "SELECT COUNT(*) FROM users WHERE handle=%s AND id!=%s",
            (handle, exclude_user_id),
        )
    else:
        row = _exec_scalar(
            "SELECT COUNT(*) FROM users WHERE handle=%s",
            (handle,),
        )
    return row == 0


def generate_handle_suggestions(vibe: str = "") -> list[str]:
    """Generate 5 unused handle suggestions, Great Neck themed."""
    import random

    if vibe and vibe in _VIBE_POOLS:
        stems = list(_VIBE_POOLS[vibe])
    else:
        stems = []
        for pool in _VIBE_POOLS.values():
            stems.extend(pool)

    random.shuffle(stems)

    suggestions = []
    tried = set()

    for stem in stems:
        if stem in tried or len(stem) < 3:
            continue
        tried.add(stem)
        if _validate_handle(stem) and check_handle_available(stem):
            suggestions.append(stem)
            if len(suggestions) >= 5:
                return suggestions

    random.shuffle(stems)
    for stem in stems:
        for _ in range(5):
            suffix = str(random.randint(1, 99))
            candidate = f"{stem}{suffix}"
            if len(candidate) > 20 or candidate in tried:
                continue
            tried.add(candidate)
            if _validate_handle(candidate) and check_handle_available(candidate):
                suggestions.append(candidate)
                if len(suggestions) >= 5:
                    return suggestions

    return suggestions


def set_user_handle(user_id: int, handle: str) -> dict | None:
    """Set a user's handle. Returns updated user dict, or None if handle is taken."""
    if not _validate_handle(handle):
        return None
    try:
        _exec_modify(
            "UPDATE users SET handle=%s WHERE id=%s",
            (handle, user_id),
        )
        return get_user_by_id(user_id)
    except Exception:
        return None


def get_user_by_handle(handle: str) -> dict | None:
    """Get a user by their handle."""
    return _exec_one(
        "SELECT * FROM users WHERE handle=%s",
        (handle,),
    )


def set_user_custom_avatar(user_id: int, url: str) -> dict | None:
    """Set a user's custom avatar URL."""
    _exec_modify(
        "UPDATE users SET custom_avatar_url=%s WHERE id=%s",
        (url, user_id),
    )
    return get_user_by_id(user_id)


def set_user_bio(user_id: int, bio: str) -> dict | None:
    """Set a user's bio."""
    _exec_modify(
        "UPDATE users SET bio=%s WHERE id=%s",
        (bio, user_id),
    )
    return get_user_by_id(user_id)


def search_users_by_handle(prefix: str, limit: int = 10) -> list[dict]:
    """Search users by handle prefix (for @mention autocomplete)."""
    prefix_like = prefix.lower() + "%"
    return _exec(
        "SELECT id, handle, name, avatar_url, custom_avatar_url FROM users WHERE handle LIKE %s AND handle IS NOT NULL ORDER BY handle LIMIT %s",
        (prefix_like, limit),
    )


def ensure_system_user(handle, name):
    """Create or find a system user by handle. Returns user id."""
    existing = get_user_by_handle(handle)
    if existing:
        return existing["id"]
    email = f"{handle}@system.local"
    row = _exec_insert_returning(
        "INSERT INTO users (email, name, handle) VALUES (%s, %s, %s) RETURNING id",
        (email, name, handle),
    )
    return row["id"]
