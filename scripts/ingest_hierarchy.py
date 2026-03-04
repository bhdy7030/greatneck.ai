"""One-time script: ingest geographic hierarchy into the shared RAG collection."""
import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent / "backend"))

from rag.store import KnowledgeStore
from rag.chunker import chunk_document

HIERARCHY_FILE = __import__("pathlib").Path(__file__).parent.parent / "knowledge" / "sources" / "geographic_hierarchy.md"

def main():
    store = KnowledgeStore()
    content = HIERARCHY_FILE.read_text()

    chunks = chunk_document(
        content,
        source="Geographic & Jurisdictional Hierarchy",
        village=None,  # shared collection
        category="reference",
    )

    if not chunks:
        print("No chunks generated")
        return

    store.add_documents(
        texts=[c.text for c in chunks],
        metadatas=[c.metadata for c in chunks],
        ids=[c.chunk_id for c in chunks],
        village=None,  # shared collection
    )
    print(f"Ingested {len(chunks)} chunks into 'shared' collection")

if __name__ == "__main__":
    main()
