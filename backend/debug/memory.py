from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

MEMORY_FILE = Path(__file__).parent.parent.parent / "knowledge" / "debug_memory.json"


class DebugMemory:
    """Persistent debug observations and instructions for improving RAG/agents."""

    def _load(self) -> list[dict]:
        if not MEMORY_FILE.exists():
            return []
        return json.loads(MEMORY_FILE.read_text())

    def _save(self, entries: list[dict]):
        MEMORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        MEMORY_FILE.write_text(json.dumps(entries, indent=2))

    def list_all(self, type_filter=None, status_filter=None) -> list[dict]:
        entries = self._load()
        if type_filter:
            entries = [e for e in entries if e["type"] == type_filter]
        if status_filter:
            entries = [e for e in entries if e["status"] == status_filter]
        return entries

    def add(self, type: str, content: str, related_query: str = "", tags: list[str] = None, conversation: list[dict] = None) -> dict:
        entries = self._load()
        entry = {
            "id": str(uuid.uuid4())[:8],
            "timestamp": datetime.now().isoformat(),
            "type": type,  # rag_quality, agent_workflow, query_pattern, instruction
            "content": content,
            "related_query": related_query,
            "tags": tags or [],
            "status": "active",
            "conversation": conversation or [],
        }
        entries.append(entry)
        self._save(entries)
        return entry

    def update(self, id: str, **kwargs) -> dict | None:
        entries = self._load()
        for e in entries:
            if e["id"] == id:
                for k, v in kwargs.items():
                    if k in e:
                        e[k] = v
                self._save(entries)
                return e
        return None

    def delete(self, id: str) -> bool:
        entries = self._load()
        filtered = [e for e in entries if e["id"] != id]
        if len(filtered) == len(entries):
            return False
        self._save(filtered)
        return True

    def get_active_instructions(self) -> str:
        """Format active entries as context for agent system prompts."""
        active = [e for e in self._load() if e["status"] == "active"]
        if not active:
            return ""
        lines = ["## Debug Instructions & Observations (from god mode)"]
        for e in active:
            prefix = f"[{e['type']}]"
            lines.append(f"- {prefix} {e['content']}")
            if e.get("related_query"):
                lines.append(f"  (related query: \"{e['related_query']}\")")
            if e.get("conversation"):
                msgs = e["conversation"]
                chat_msgs = [m for m in msgs if m.get("role") in ("user", "assistant")]
                if chat_msgs:
                    summary_parts = []
                    for m in chat_msgs[:4]:
                        text = (m.get("content") or "")[:80]
                        summary_parts.append(f"{m['role']}: {text}")
                    lines.append(f"  (conversation: {' | '.join(summary_parts)})")
        return "\n".join(lines)


debug_memory = DebugMemory()
