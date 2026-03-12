"""Playbook similarity index — embedding-based pre-filter for guide recommendations.

Maintains a ChromaDB collection of published guide embeddings so chat requests
can vector-search the user's query and only inject the top 3-4 relevant guides
into the LLM context (instead of the full catalog).

Write-through: rebuilt on publish/unpublish/update alongside the Redis cache.
"""
from __future__ import annotations

import asyncio
import json
import logging

logger = logging.getLogger(__name__)

COLLECTION_NAME = "playbook-guides"


def _get_collection():
    from rag.store import _get_client
    client = _get_client()
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


def rebuild_index() -> int:
    """Fetch all published guides, clear collection, upsert each as one document.

    Returns the number of guides indexed.
    """
    from db import get_published_user_guides

    rows = get_published_user_guides()
    collection = _get_collection()

    # Clear existing entries
    if collection.count() > 0:
        existing = collection.get()
        if existing["ids"]:
            collection.delete(ids=existing["ids"])

    if not rows:
        logger.info("Playbook index rebuilt: 0 guides")
        return 0

    ids = []
    documents = []
    metadatas = []

    for row in rows:
        gd = row.get("guide_data", {})
        title = gd.get("title", "")
        if isinstance(title, dict):
            title = title.get("en", "")
        desc = gd.get("description", "")
        if isinstance(desc, dict):
            desc = desc.get("en", "")
        steps = gd.get("steps", [])
        step_titles = []
        for s in steps:
            st = s.get("title", "")
            if isinstance(st, dict):
                st = st.get("en", "")
            if st:
                step_titles.append(st)

        # Document text for embedding
        doc_text = f"{title}. {desc}."
        if step_titles:
            doc_text += f" Steps: {', '.join(step_titles)}"

        ids.append(row["id"])
        documents.append(doc_text)
        metadatas.append({
            "guide_id": row["id"],
            "title": title,
            "description": desc,
            "icon": gd.get("icon", ""),
            "color": gd.get("color", "#6B8F71"),
            "step_count": len(steps),
            "steps_json": json.dumps(step_titles),
        })

    collection.upsert(documents=documents, metadatas=metadatas, ids=ids)
    logger.info("Playbook index rebuilt: %d guides", len(ids))
    return len(ids)


def rebuild_index_async() -> None:
    """Fire-and-forget rebuild in a background thread (non-blocking)."""
    try:
        loop = asyncio.get_event_loop()
        loop.run_in_executor(None, rebuild_index)
    except RuntimeError:
        # No running event loop — just run synchronously
        rebuild_index()


def search_relevant(query: str, top_k: int = 4, threshold: float = 1.0) -> list[dict]:
    """Query the collection for guides relevant to the user's message.

    Returns up to top_k guide metadata dicts, filtered by cosine distance threshold.
    Cosine distance: 0 = identical, 2 = opposite. Default threshold 1.0 filters out
    only clearly irrelevant guides.
    """
    try:
        collection = _get_collection()
        if collection.count() == 0:
            return []

        n = min(top_k, collection.count())
        results = collection.query(query_texts=[query], n_results=n)

        if not results["ids"] or not results["ids"][0]:
            return []

        guides = []
        for i in range(len(results["ids"][0])):
            distance = results["distances"][0][i] if results["distances"] else 999
            if distance > threshold:
                continue
            meta = results["metadatas"][0][i] if results["metadatas"] else {}
            # Reconstruct the guide summary dict expected by agents
            step_titles = json.loads(meta.get("steps_json", "[]"))
            guides.append({
                "id": meta.get("guide_id", results["ids"][0][i]),
                "title": meta.get("title", ""),
                "description": meta.get("description", ""),
                "icon": meta.get("icon", ""),
                "color": meta.get("color", "#6B8F71"),
                "step_count": meta.get("step_count", 0),
                "steps": step_titles,
            })

        return guides

    except Exception:
        logger.exception("Playbook index search error")
        return []
