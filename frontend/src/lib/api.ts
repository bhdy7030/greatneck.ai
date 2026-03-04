const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  image?: string; // base64 encoded
  sources?: SourceRef[];
  agent?: string;
}

export interface SourceRef {
  text: string;
  source: string;
  section?: string;
  url?: string;
  distance?: number;
}

export interface ChatResponse {
  response: string;
  sources: SourceRef[];
  agent_used: string;
}

export interface Village {
  name: string;
  slug: string;
}

export interface SourceDoc {
  village: string;
  source: string;
  category: string;
  chunk_count: number;
}

export interface KnowledgeStats {
  collections: string[];
  total_documents: number;
  per_collection: Record<string, number>;
}

/**
 * Send a chat message to the backend.
 */
export async function sendMessage(
  message: string,
  village: string,
  imageBase64?: string,
  history?: { role: string; content: string }[]
): Promise<ChatResponse> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      village,
      image_base64: imageBase64 || null,
      history: history || [],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Chat request failed: ${res.status} ${err}`);
  }

  return res.json();
}

/** Pipeline event emitted by the streaming endpoint */
export interface PipelineEvent {
  type: string; // "step" | "tool" | "response" | "error" | "debug"
  stage?: string;
  status?: string;
  label?: string;
  detail?: string;
  tool?: string;
  args?: Record<string, string>;
  preview?: string;
  has_results?: boolean;
  retry?: boolean;
  plan?: {
    steps: { tool: string; query: string }[];
    web_fallbacks: string[];
    model: string;
  };
  // response event fields
  response?: string;
  sources?: SourceRef[];
  agent_used?: string;
  message?: string; // error
  // debug event fields
  data?: Record<string, unknown>;
}

export interface ConversationItem {
  role: "user" | "assistant" | "pipeline";
  content: string;
  sources?: SourceRef[];
  agent?: string;
  events?: PipelineEvent[];
}

export interface DebugMemoryEntry {
  id: string;
  timestamp: string;
  type: "rag_quality" | "agent_workflow" | "query_pattern" | "instruction";
  content: string;
  related_query: string;
  tags: string[];
  status: "active" | "resolved";
  conversation?: ConversationItem[];
}

/**
 * Send a chat message via SSE stream. Calls onEvent for each pipeline step.
 */
export async function sendMessageStream(
  message: string,
  village: string,
  onEvent: (event: PipelineEvent) => void,
  imageBase64?: string,
  history?: { role: string; content: string }[],
  debug?: boolean
): Promise<ChatResponse> {
  const res = await fetch(`${BASE_URL}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      village,
      image_base64: imageBase64 || null,
      history: history || [],
      debug: debug || false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Chat request failed: ${res.status} ${err}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse: ChatResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let currentEventType = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEventType = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          const event: PipelineEvent = { type: currentEventType, ...data };
          onEvent(event);

          if (currentEventType === "response") {
            finalResponse = {
              response: data.response || "",
              sources: data.sources || [],
              agent_used: data.agent_used || "",
            };
          }
          if (currentEventType === "error") {
            throw new Error(data.message || "Pipeline error");
          }
        } catch (e) {
          // Re-throw pipeline/API errors; only swallow JSON parse failures
          if (e instanceof SyntaxError) {
            console.warn("Failed to parse SSE data:", line, e);
          } else {
            throw e;
          }
        }
      }
    }
  }

  if (!finalResponse) {
    throw new Error("Stream ended without a response");
  }
  return finalResponse;
}

/**
 * Get list of supported villages.
 */
export async function getVillages(): Promise<Village[]> {
  const res = await fetch(`${BASE_URL}/api/villages`);
  if (!res.ok) {
    throw new Error(`Failed to fetch villages: ${res.status}`);
  }
  return res.json();
}

/**
 * Upload a document to the knowledge base.
 */
export async function uploadDocument(
  content: string,
  source: string,
  village: string,
  category: string
): Promise<{ status: string; chunks: number }> {
  const res = await fetch(`${BASE_URL}/api/admin/documents/json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, source, village, category }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload failed: ${res.status} ${err}`);
  }

  return res.json();
}

/**
 * Get all sources in the knowledge base.
 */
export async function getSources(): Promise<SourceDoc[]> {
  const res = await fetch(`${BASE_URL}/api/admin/sources`);
  if (!res.ok) {
    throw new Error(`Failed to fetch sources: ${res.status}`);
  }
  return res.json();
}

/**
 * Delete all documents for a village.
 */
export async function deleteSource(village: string): Promise<{ status: string }> {
  const res = await fetch(
    `${BASE_URL}/api/admin/sources/${encodeURIComponent(village)}`,
    { method: "DELETE" }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Delete failed: ${res.status} ${err}`);
  }
  return res.json();
}

/**
 * Get knowledge base stats.
 */
export async function getKnowledgeStats(): Promise<KnowledgeStats> {
  const res = await fetch(`${BASE_URL}/api/admin/stats`);
  if (!res.ok) {
    throw new Error(`Failed to fetch stats: ${res.status}`);
  }
  return res.json();
}

// ── Debug Memory API ──

export async function getDebugMemory(
  type?: string,
  status?: string
): Promise<DebugMemoryEntry[]> {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (status) params.set("status", status);
  const qs = params.toString();
  const res = await fetch(`${BASE_URL}/api/debug/memory${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`Failed to fetch debug memory: ${res.status}`);
  return res.json();
}

export async function addDebugMemory(entry: {
  type: string;
  content: string;
  related_query?: string;
  tags?: string[];
  conversation?: ConversationItem[];
}): Promise<DebugMemoryEntry> {
  const res = await fetch(`${BASE_URL}/api/debug/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error(`Failed to add debug entry: ${res.status}`);
  return res.json();
}

export async function updateDebugMemory(
  id: string,
  update: { content?: string; status?: string; tags?: string[] }
): Promise<DebugMemoryEntry> {
  const res = await fetch(`${BASE_URL}/api/debug/memory/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error(`Failed to update debug entry: ${res.status}`);
  return res.json();
}

export async function deleteDebugMemory(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/debug/memory/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete debug entry: ${res.status}`);
}
