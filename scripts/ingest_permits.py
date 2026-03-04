"""One-time script: ingest permit and inspection procedures into the shared RAG collection."""
import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent / "backend"))

from rag.store import KnowledgeStore
from rag.chunker import chunk_document

PERMITS_FILE = __import__("pathlib").Path(__file__).parent.parent / "backend" / "knowledge" / "permits_and_inspections.txt"

def main():
    store = KnowledgeStore()
    content = PERMITS_FILE.read_text()

    chunks = chunk_document(
        content,
        source="Permit & Inspection Procedures — Great Neck Area Villages",
        village=None,  # shared collection (applies to all villages)
        category="permits",
    )

    if not chunks:
        print("No chunks generated")
        return

    # Deduplicate chunks by ID (chunker may produce collisions on similar sections)
    seen = {}
    for c in chunks:
        if c.chunk_id not in seen:
            seen[c.chunk_id] = c
        else:
            # Append index suffix to make unique
            idx = 1
            new_id = f"{c.chunk_id}_{idx}"
            while new_id in seen:
                idx += 1
                new_id = f"{c.chunk_id}_{idx}"
            c.chunk_id = new_id
            seen[new_id] = c

    deduped = list(seen.values())
    collection = store.get_or_create_collection(village=None)
    collection.upsert(
        documents=[c.text for c in deduped],
        metadatas=[c.metadata for c in deduped],
        ids=[c.chunk_id for c in deduped],
    )
    print(f"Ingested {len(deduped)} chunks into 'shared' collection")

if __name__ == "__main__":
    main()
