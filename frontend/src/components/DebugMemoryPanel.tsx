"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getDebugMemory,
  addDebugMemory,
  updateDebugMemory,
  deleteDebugMemory,
  type DebugMemoryEntry,
  type ChatMessage as ChatMessageType,
  type PipelineEvent,
  type ConversationItem,
} from "@/lib/api";

const TYPES = ["instruction", "rag_quality", "agent_workflow", "query_pattern"] as const;

const TYPE_BADGES: Record<string, string> = {
  instruction: "bg-gold/20 text-gold-dark",
  rag_quality: "bg-red-100 text-red-700",
  agent_workflow: "bg-sage/20 text-sage-dark",
  query_pattern: "bg-surface-300 text-text-700",
};

interface DebugMemoryPanelProps {
  currentQuery?: string;
  messages?: ChatMessageType[];
  pipelineEvents?: PipelineEvent[];
}

export default function DebugMemoryPanel({ currentQuery, messages, pipelineEvents }: DebugMemoryPanelProps) {
  const [entries, setEntries] = useState<DebugMemoryEntry[]>([]);
  const [newType, setNewType] = useState<string>("instruction");
  const [newContent, setNewContent] = useState("");
  const [attachQuery, setAttachQuery] = useState(false);
  const [attachConversation, setAttachConversation] = useState(true);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [expandedConversations, setExpandedConversations] = useState<Set<string>>(new Set());

  const hasConversation = (messages?.length ?? 0) > 0;

  const loadEntries = useCallback(async () => {
    try {
      const data = await getDebugMemory(undefined, filterStatus || undefined);
      setEntries(data);
    } catch {
      // Backend may not be running
    }
  }, [filterStatus]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const buildConversation = (): ConversationItem[] | undefined => {
    if (!attachConversation || !hasConversation) return undefined;
    const items: ConversationItem[] = [];
    for (const m of messages!) {
      items.push({
        role: m.role,
        content: m.content,
        sources: m.sources,
        agent: m.agent,
      });
    }
    if (pipelineEvents && pipelineEvents.length > 0) {
      items.push({
        role: "pipeline",
        content: `${pipelineEvents.length} pipeline events`,
        events: pipelineEvents,
      });
    }
    return items;
  };

  const handleAdd = async () => {
    if (!newContent.trim()) return;
    setLoading(true);
    try {
      await addDebugMemory({
        type: newType,
        content: newContent.trim(),
        related_query: attachQuery && currentQuery ? currentQuery : "",
        conversation: buildConversation(),
      });
      setNewContent("");
      setAttachQuery(false);
      await loadEntries();
    } catch (err) {
      console.error("Failed to add entry:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleConversation = (id: string) => {
    setExpandedConversations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleResolve = async (id: string) => {
    await updateDebugMemory(id, { status: "resolved" });
    await loadEntries();
  };

  const handleReactivate = async (id: string) => {
    await updateDebugMemory(id, { status: "active" });
    await loadEntries();
  };

  const handleDelete = async (id: string) => {
    await deleteDebugMemory(id);
    await loadEntries();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-300">
        <h3 className="text-xs font-bold text-text-900 uppercase tracking-wider">
          God Mode Memory
        </h3>
        <div className="flex gap-1">
          <button
            onClick={() => setFilterStatus("active")}
            className={`text-[10px] px-2 py-0.5 rounded ${
              filterStatus === "active" ? "bg-sage/20 text-sage-dark" : "text-text-500"
            }`}
          >
            Active
          </button>
          <button
            onClick={() => setFilterStatus("")}
            className={`text-[10px] px-2 py-0.5 rounded ${
              filterStatus === "" ? "bg-sage/20 text-sage-dark" : "text-text-500"
            }`}
          >
            All
          </button>
        </div>
      </div>

      {/* Entries list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {entries.length === 0 && (
          <p className="text-xs text-text-500 text-center py-4">
            No entries yet. Add instructions below.
          </p>
        )}
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`rounded-lg border p-2 text-xs ${
              entry.status === "resolved"
                ? "border-surface-300 bg-surface-100 opacity-60"
                : "border-surface-300 bg-surface-50"
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  TYPE_BADGES[entry.type] || "bg-surface-200 text-text-600"
                }`}
              >
                {entry.type}
              </span>
              <span className="text-[10px] text-text-500 ml-auto">
                {new Date(entry.timestamp).toLocaleDateString()}
              </span>
            </div>
            <p className="text-text-800 leading-relaxed">{entry.content}</p>
            {entry.related_query && (
              <p className="text-[10px] text-text-500 mt-1 font-mono truncate">
                query: &quot;{entry.related_query}&quot;
              </p>
            )}
            {entry.conversation && entry.conversation.length > 0 && (
              <div className="mt-1.5">
                <button
                  onClick={() => toggleConversation(entry.id)}
                  className="text-[10px] text-sage hover:text-sage-dark flex items-center gap-1"
                >
                  <span className="inline-block transition-transform" style={{
                    transform: expandedConversations.has(entry.id) ? "rotate(90deg)" : "rotate(0deg)",
                  }}>&#9654;</span>
                  {entry.conversation.filter((c) => c.role !== "pipeline").length} messages
                </button>
                {expandedConversations.has(entry.id) && (
                  <div className="mt-1 space-y-1 border-l-2 border-surface-300 pl-2 max-h-48 overflow-y-auto">
                    {entry.conversation.map((item, idx) =>
                      item.role === "pipeline" ? (
                        <div key={idx} className="text-[10px] text-text-400 italic">
                          {item.content}
                        </div>
                      ) : (
                        <div key={idx} className="text-[10px]">
                          <span className={`font-bold ${item.role === "user" ? "text-gold-dark" : "text-sage-dark"}`}>
                            {item.role}:
                          </span>{" "}
                          <span className="text-text-700">{item.content.length > 200 ? item.content.slice(0, 200) + "…" : item.content}</span>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2 mt-1.5">
              {entry.status === "active" ? (
                <button
                  onClick={() => handleResolve(entry.id)}
                  className="text-[10px] text-sage hover:text-sage-dark"
                >
                  Resolve
                </button>
              ) : (
                <button
                  onClick={() => handleReactivate(entry.id)}
                  className="text-[10px] text-gold hover:text-gold-dark"
                >
                  Reactivate
                </button>
              )}
              <button
                onClick={() => handleDelete(entry.id)}
                className="text-[10px] text-red-400 hover:text-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add new entry */}
      <div className="border-t border-surface-300 px-3 py-2 space-y-2">
        <div className="flex gap-2">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="text-xs bg-surface-100 border border-surface-300 text-text-800 rounded px-2 py-1"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {currentQuery && (
            <label className="flex items-center gap-1 text-[10px] text-text-500">
              <input
                type="checkbox"
                checked={attachQuery}
                onChange={(e) => setAttachQuery(e.target.checked)}
                className="rounded"
              />
              Attach query
            </label>
          )}
          {hasConversation && (
            <label className="flex items-center gap-1 text-[10px] text-text-500">
              <input
                type="checkbox"
                checked={attachConversation}
                onChange={(e) => setAttachConversation(e.target.checked)}
                className="rounded"
              />
              Attach conversation
            </label>
          )}
        </div>
        <div className="flex gap-2">
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Add instruction or observation..."
            rows={2}
            className="flex-1 text-xs bg-surface-100 border border-surface-300 text-text-800 rounded-lg px-2 py-1.5 resize-none placeholder-text-500 focus:outline-none focus:ring-1 focus:ring-sage"
          />
          <button
            onClick={handleAdd}
            disabled={loading || !newContent.trim()}
            className="self-end px-3 py-1.5 text-xs bg-sage text-white rounded-lg hover:bg-sage-dark disabled:opacity-50 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
