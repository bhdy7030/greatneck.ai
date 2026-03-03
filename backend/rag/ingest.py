"""Document ingestion pipeline: parse → chunk → embed → store."""
from __future__ import annotations

from pathlib import Path
from .chunker import chunk_document
from .store import KnowledgeStore

_store = KnowledgeStore()


async def ingest_document(
    content: str,
    source: str,
    village: str | None = None,
    category: str = "general",
    url: str = "",
) -> dict:
    """Ingest text content into the knowledge store."""
    chunks = chunk_document(content, source=source, village=village, category=category)
    if url:
        for c in chunks:
            c.metadata["url"] = url
    if not chunks:
        return {"status": "empty", "chunks": 0}

    _store.add_documents(
        texts=[c.text for c in chunks],
        metadatas=[c.metadata for c in chunks],
        ids=[c.chunk_id for c in chunks],
        village=village,
    )
    return {"status": "ok", "chunks": len(chunks), "source": source}


async def ingest_pdf(file_path: str | Path, village: str | None = None, category: str = "general") -> dict:
    """Parse and ingest a PDF file."""
    import pdfplumber

    path = Path(file_path)
    text_parts = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    full_text = "\n\n".join(text_parts)
    return await ingest_document(full_text, source=path.name, village=village, category=category)


async def ingest_html(html: str, source_url: str, village: str | None = None, category: str = "general") -> dict:
    """Parse HTML and ingest as text."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    # Remove scripts and styles
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    return await ingest_document(text, source=source_url, village=village, category=category, url=source_url)
