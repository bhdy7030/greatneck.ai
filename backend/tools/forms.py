"""Permit and form-related tools."""

import json
from pathlib import Path
from tools.registry import tool
from tools.search import _source_and_url, _filter_relevant
from rag.store import KnowledgeStore
from config import settings

_store = KnowledgeStore()
_FORMS_DIR = settings.knowledge_dir / "sources" / "forms"


@tool(
    name="search_permits",
    description="Search for permit requirements by project type (e.g., 'deck addition', 'fence installation', 'home renovation'). Returns relevant permit information and requirements.",
)
async def search_permits(project_type: str, village: str = "") -> str:
    """Search knowledge store with category='permits' filter."""
    results = _store.search(
        project_type,
        village=village or None,
        n_results=5,
        where={"category": "permits"},
    )
    results = _filter_relevant(results)

    # If no permit-specific results, broaden search
    if not results:
        results = _store.search(
            f"permit {project_type}",
            village=village or None,
            n_results=5,
        )
        results = _filter_relevant(results)

    if not results:
        return (
            f"No relevant permit information found for '{project_type}' in the local knowledge base. "
            "This village may have limited data coverage. "
            "Consider using web_search to find permit requirements online."
        )

    formatted_parts = []
    for i, doc in enumerate(results, 1):
        meta = doc.get("metadata", {})
        source_name, url = _source_and_url(meta)
        section = meta.get("section", "")
        header = f"[{i}] {source_name}"
        if section:
            header += f" - {section}"
        lines = [header]
        if url:
            lines.append(f"url: {url}")
        lines.append(doc["text"])
        formatted_parts.append("\n".join(lines))

    return "\n\n---\n\n".join(formatted_parts)


@tool(
    name="get_form",
    description="Retrieve a permit or application form template by its ID (e.g., 'building_permit', 'fence_permit'). Returns the form fields and instructions.",
)
async def get_form(form_id: str) -> str:
    """Retrieve a form template from knowledge/sources/forms/."""
    # Look for the form file (support .json and .txt)
    for ext in (".json", ".txt", ".md"):
        form_path = _FORMS_DIR / f"{form_id}{ext}"
        if form_path.exists():
            content = form_path.read_text(encoding="utf-8")
            return f"Form: {form_id}\n\n{content}"

    # List available forms if the requested one is not found
    available = []
    if _FORMS_DIR.exists():
        available = [f.stem for f in _FORMS_DIR.iterdir() if f.is_file()]

    if available:
        return f"Form '{form_id}' not found. Available forms: {', '.join(available)}"
    return f"Form '{form_id}' not found. No forms are currently available in the system."


@tool(
    name="fill_form",
    description="Generate a filled-out version of a permit form given user data. Provide the form ID and a JSON string of user information (name, address, project details, etc.).",
)
async def fill_form(form_id: str, user_data: str) -> str:
    """Return filled form data (JSON) by merging form template with user info."""
    # First, retrieve the form template
    template_text = await get_form.fn(form_id)
    if "not found" in template_text.lower():
        return template_text

    # Parse user data
    try:
        data = json.loads(user_data)
    except json.JSONDecodeError:
        return "Error: user_data must be a valid JSON string. Example: {\"name\": \"John Doe\", \"address\": \"123 Main St\"}"

    # Build a filled form response
    filled = {
        "form_id": form_id,
        "status": "draft",
        "user_data": data,
        "template_reference": template_text[:500],
        "instructions": (
            "This is a draft form. Please review all fields carefully before "
            "submitting to the village office. Some fields may need to be "
            "completed manually."
        ),
    }

    return json.dumps(filled, indent=2)
