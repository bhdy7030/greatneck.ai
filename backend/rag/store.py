"""ChromaDB knowledge store with per-village collections."""
from __future__ import annotations

import chromadb
from config import settings

_client: chromadb.ClientAPI | None = None


def _get_client() -> chromadb.ClientAPI:
    global _client
    if _client is None:
        settings.chroma_dir.mkdir(parents=True, exist_ok=True)
        _client = chromadb.PersistentClient(path=str(settings.chroma_dir))
    return _client


def embed_query(text: str) -> list[float]:
    """Embed a query string once. Reuse the vector for multiple searches."""
    client = _get_client()
    collection = client.get_or_create_collection(name="shared")
    # Use ChromaDB's default embedding function
    ef = collection._embedding_function
    return ef([text])[0]


class KnowledgeStore:
    """Wraps ChromaDB. One collection per village + a 'shared' collection."""

    def __init__(self):
        self.client = _get_client()

    def _collection_name(self, village: str | None) -> str:
        if not village:
            return "shared"
        return village.lower().replace(" ", "_").replace(".", "")

    def get_or_create_collection(self, village: str | None = None):
        name = self._collection_name(village)
        return self.client.get_or_create_collection(name=name)

    def add_documents(
        self,
        texts: list[str],
        metadatas: list[dict],
        ids: list[str],
        village: str | None = None,
    ):
        collection = self.get_or_create_collection(village)
        # Deduplicate IDs within this batch (chunker can produce collisions)
        seen: dict[str, int] = {}
        dedup_texts, dedup_metas, dedup_ids = [], [], []
        for t, m, i in zip(texts, metadatas, ids):
            if i in seen:
                continue
            seen[i] = 1
            dedup_texts.append(t)
            dedup_metas.append(m)
            dedup_ids.append(i)
        collection.upsert(documents=dedup_texts, metadatas=dedup_metas, ids=dedup_ids)

    def search(
        self,
        query: str,
        village: str | None = None,
        n_results: int = 5,
        where: dict | None = None,
        query_embedding: list[float] | None = None,
    ) -> list[dict]:
        """Search a village's collection. Returns list of {text, metadata, distance}.

        If query_embedding is provided, uses it directly instead of re-embedding.
        """
        collection = self.get_or_create_collection(village)
        if collection.count() == 0:
            return []
        kwargs: dict = {"n_results": min(n_results, collection.count())}
        if query_embedding:
            kwargs["query_embeddings"] = [query_embedding]
        else:
            kwargs["query_texts"] = [query]
        if where:
            kwargs["where"] = where
        results = collection.query(**kwargs)
        docs = []
        for i in range(len(results["documents"][0])):
            docs.append({
                "text": results["documents"][0][i],
                "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                "distance": results["distances"][0][i] if results["distances"] else None,
            })
        return docs

    def search_across_villages(
        self, query: str, villages: list[str], n_results: int = 5
    ) -> list[dict]:
        """Search across multiple village collections."""
        all_results = []
        for v in villages:
            all_results.extend(self.search(query, village=v, n_results=n_results))
        all_results.sort(key=lambda x: x.get("distance", 999))
        return all_results[:n_results]

    def list_collections(self) -> list[str]:
        return [c.name for c in self.client.list_collections()]

    def delete_document(self, doc_id: str, village: str | None = None):
        collection = self.get_or_create_collection(village)
        collection.delete(ids=[doc_id])

    def get_stats(self, village: str | None = None) -> dict:
        collection = self.get_or_create_collection(village)
        return {"village": village or "shared", "document_count": collection.count()}
