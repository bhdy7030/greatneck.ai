"""Contact lookup tool for village departments."""
from __future__ import annotations

from tools.registry import tool
from data.contacts import CONTACTS
from api.villages import VILLAGES

# Build a quick lookup for village websites
_VILLAGE_WEBSITES: dict[str, str] = {v.id: v.website for v in VILLAGES}
_VILLAGE_NAMES: dict[str, str] = {v.id: v.full_name for v in VILLAGES}


@tool(
    name="get_village_contacts",
    description="Get contact info (name, email, phone, website) for a village department. Use department='clerk' for general inquiries, 'dpw' for public works, 'building' for building/permits, 'police' for safety/noise.",
)
async def get_village_contacts(village: str, department: str = "clerk") -> str:
    """Return formatted contact info for a village department."""
    if village not in CONTACTS:
        available = ", ".join(sorted(CONTACTS.keys()))
        return f"Village '{village}' not found. Available villages: {available}"

    village_depts = CONTACTS[village]
    # Fall back to clerk if department not found
    dept = village_depts.get(department) or village_depts.get("clerk", {})
    dept_key = department if department in village_depts else "clerk"
    clerk = village_depts.get("clerk", {})

    # Email fallback: department email → clerk email
    email = dept.get("email") or clerk.get("email")
    email_source = ""
    if dept.get("email"):
        email_source = ""
    elif clerk.get("email"):
        email_source = " (via Village Clerk — department has no direct email)"

    village_name = _VILLAGE_NAMES.get(village, village)
    website = _VILLAGE_WEBSITES.get(village, "")

    lines = [
        f"Village: {village_name}",
        f"Department: {dept.get('name', dept_key)}",
    ]
    if email:
        lines.append(f"Email: {email}{email_source}")
    else:
        lines.append("Email: Not in our records — use search_codes or web_search to find it, or direct the user to the village website contact page.")
    lines.append(f"Phone: {dept.get('phone', 'N/A')}")
    if website:
        lines.append(f"Website: {website}")

    return "\n".join(lines)
