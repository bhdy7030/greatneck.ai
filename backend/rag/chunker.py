"""Smart document chunker that respects code section boundaries."""
from __future__ import annotations

import re
import hashlib
from dataclasses import dataclass


@dataclass
class Chunk:
    text: str
    metadata: dict
    chunk_id: str


def chunk_document(
    text: str,
    source: str,
    village: str | None = None,
    category: str = "general",
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
) -> list[Chunk]:
    """Chunk a document, trying to respect section boundaries."""
    # Try section-based splitting first (for village codes)
    sections = _split_by_sections(text)
    if len(sections) > 1:
        return _chunks_from_sections(sections, source, village, category)

    # Fall back to size-based splitting
    return _chunks_by_size(text, source, village, category, chunk_size, chunk_overlap)


# Pattern matches common code section headers like "Section 237-4", "§ 575-12", "Chapter 3"
_SECTION_RE = re.compile(
    r"^(?:Section|§|Chapter|Article)\s+[\d\-\.]+",
    re.MULTILINE | re.IGNORECASE,
)


def _split_by_sections(text: str) -> list[tuple[str, str]]:
    """Split text by section headers. Returns [(header, body), ...]."""
    matches = list(_SECTION_RE.finditer(text))
    if len(matches) < 2:
        return []
    sections = []
    for i, match in enumerate(matches):
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        header = match.group().strip()
        body = text[start:end].strip()
        sections.append((header, body))
    return sections


def _chunks_from_sections(
    sections: list[tuple[str, str]], source: str, village: str | None, category: str
) -> list[Chunk]:
    chunks = []
    for header, body in sections:
        # If a section is too long, sub-chunk it
        if len(body) > 2000:
            sub_chunks = _chunks_by_size(body, source, village, category, 1000, 200)
            for i, sc in enumerate(sub_chunks):
                sc.metadata["section"] = header
                sc.metadata["sub_chunk"] = i
            chunks.extend(sub_chunks)
        else:
            cid = _make_id(source, header, body)
            chunks.append(Chunk(
                text=body,
                metadata={
                    "source": source,
                    "village": village or "",
                    "category": category,
                    "section": header,
                },
                chunk_id=cid,
            ))
    return chunks


def _chunks_by_size(
    text: str, source: str, village: str | None, category: str,
    chunk_size: int, overlap: int,
) -> list[Chunk]:
    chunks = []
    # Split by paragraphs first
    paragraphs = text.split("\n\n")
    current = ""
    idx = 0
    for para in paragraphs:
        if len(current) + len(para) > chunk_size and current:
            cid = _make_id(source, str(idx), current)
            chunks.append(Chunk(
                text=current.strip(),
                metadata={"source": source, "village": village or "", "category": category, "chunk_index": idx},
                chunk_id=cid,
            ))
            # Keep overlap
            current = current[-overlap:] + "\n\n" + para
            idx += 1
        else:
            current = current + "\n\n" + para if current else para

    if current.strip():
        cid = _make_id(source, str(idx))
        chunks.append(Chunk(
            text=current.strip(),
            metadata={"source": source, "village": village or "", "category": category, "chunk_index": idx},
            chunk_id=cid,
        ))
    return chunks


def _make_id(source: str, key: str, content: str = "") -> str:
    data = f"{source}:{key}:{content[:100]}"
    return hashlib.sha256(data.encode()).hexdigest()[:16]
