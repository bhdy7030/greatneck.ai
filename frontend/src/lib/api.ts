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
  type: string; // "step" | "tool" | "response" | "error"
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
}

/**
 * Send a chat message via SSE stream. Calls onEvent for each pipeline step.
 */
export async function sendMessageStream(
  message: string,
  village: string,
  onEvent: (event: PipelineEvent) => void,
  imageBase64?: string,
  history?: { role: string; content: string }[]
): Promise<ChatResponse> {
  const res = await fetch(`${BASE_URL}/api/chat/stream`, {
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
          if (e instanceof Error && e.message !== "Pipeline error") {
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
