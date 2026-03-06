import {
  getToken,
  setToken,
  getRefreshToken,
  clearAuth,
  getSessionId,
  type AuthUser,
} from "@/lib/auth";

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8001";

function authHeaders(): Record<string, string> {
  const token = getToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

function sessionHeaders(): Record<string, string> {
  return { "X-Session-ID": getSessionId() };
}

// ── Tier / Usage types ──

export interface TierFeatures {
  web_search_mode: "off" | "limited" | "unlimited";
  fast_mode_forced: boolean;
  deep_mode_allowed: boolean;
  max_queries: number | null;
}

export interface UsageInfo {
  tier: "anonymous" | "free" | "free_promo" | "pro";
  features: TierFeatures;
  queries_used: number;
  queries_remaining: number | null;
  extended_trial?: boolean;
  promo_expires_at?: string;
}

/** SSE error with a machine-readable code */
export class TierError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ── Token refresh ──

let _refreshPromise: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    const refresh = getRefreshToken();
    if (!refresh) return false;
    try {
      const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      setToken(data.token);
      return true;
    } catch {
      return false;
    } finally {
      _refreshPromise = null;
    }
  })();
  return _refreshPromise;
}

/** Fetch with automatic 401 → refresh → retry. */
async function fetchWithRefresh(
  url: string,
  init: RequestInit
): Promise<Response> {
  let res = await fetch(url, init);
  if (res.status === 401 && getRefreshToken()) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      // Rebuild auth header
      const newInit = { ...init, headers: { ...init.headers, ...authHeaders() } };
      res = await fetch(url, newInit);
    }
  }
  return res;
}

// ── Conversation types ──

export interface Conversation {
  id: string;
  title: string;
  village: string;
  updated_at: string;
  message_count: number;
  preview: string;
}

export interface ConversationDetail {
  id: string;
  user_id: number;
  title: string;
  village: string;
  created_at: string;
  updated_at: string;
  messages: {
    id: number;
    role: "user" | "assistant";
    content: string;
    image_base64?: string;
    sources?: SourceRef[];
    agent_used?: string;
    created_at: string;
  }[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  image?: string; // base64 encoded
  sources?: SourceRef[];
  agent?: string;
  pipelineEvents?: PipelineEvent[];
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
  conversation_id?: string | null;
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
export type WebSearchMode = "off" | "limited" | "unlimited";

export async function sendMessage(
  message: string,
  village: string,
  imageBase64?: string,
  history?: { role: string; content: string }[],
  conversationId?: string,
  webSearchMode?: WebSearchMode,
  language?: string,
  fastMode?: boolean
): Promise<ChatResponse> {
  const res = await fetchWithRefresh(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(), ...sessionHeaders() },
    body: JSON.stringify({
      message,
      village,
      image_base64: imageBase64 || null,
      history: history || [],
      conversation_id: conversationId || null,
      web_search_mode: webSearchMode || "limited",
      fast_mode: fastMode || false,
      language: language || "en",
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
  debug?: boolean,
  conversationId?: string,
  webSearchMode?: WebSearchMode,
  language?: string,
  fastMode?: boolean
): Promise<ChatResponse> {
  const res = await fetchWithRefresh(`${BASE_URL}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(), ...sessionHeaders() },
    body: JSON.stringify({
      message,
      village,
      image_base64: imageBase64 || null,
      history: history || [],
      debug: debug || false,
      conversation_id: conversationId || null,
      web_search_mode: webSearchMode || "limited",
      fast_mode: fastMode || false,
      language: language || "en",
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

  let currentEventType = "";

  const processLines = (lines: string[]) => {
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
              conversation_id: data.conversation_id || null,
            };
          }
          if (currentEventType === "error") {
            if (data.code) {
              throw new TierError(data.code, data.message || "Usage limit reached");
            }
            throw new Error(data.message || "Pipeline error");
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            console.warn("Failed to parse SSE data:", line, e);
          } else {
            throw e;
          }
        }
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    processLines(lines);
  }

  // Flush remaining buffer after stream ends
  if (buffer.trim()) {
    processLines(buffer.split("\n"));
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
    headers: { "Content-Type": "application/json", ...authHeaders() },
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
  const res = await fetch(`${BASE_URL}/api/admin/sources`, {
    headers: authHeaders(),
  });
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
    { method: "DELETE", headers: authHeaders() }
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
  const res = await fetch(`${BASE_URL}/api/admin/stats`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch stats: ${res.status}`);
  }
  return res.json();
}

// ── Model Config API ──

export interface ModelConfig {
  provider: "claude" | "gemini";
  models: Record<string, string>;
}

export async function getModelConfig(): Promise<ModelConfig> {
  const res = await fetch(`${BASE_URL}/api/admin/models`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch model config: ${res.status}`);
  return res.json();
}

export async function updateModelConfig(
  update: { provider?: string; fast_mode?: boolean }
): Promise<ModelConfig> {
  const res = await fetch(`${BASE_URL}/api/admin/models`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error(`Failed to update model config: ${res.status}`);
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
  const res = await fetch(`${BASE_URL}/api/debug/memory${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
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
    headers: { "Content-Type": "application/json", ...authHeaders() },
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
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(update),
  });
  if (!res.ok) throw new Error(`Failed to update debug entry: ${res.status}`);
  return res.json();
}

export async function deleteDebugMemory(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/debug/memory/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to delete debug entry: ${res.status}`);
}

// ── Events API ──

export interface UpcomingEvent {
  id: number;
  title: string;
  description: string;
  event_date: string;
  event_time: string;
  end_date: string | null;
  location: string;
  venue: string;
  url: string;
  image_url: string;
  category: string;
  scope: string;
  village: string;
  source: string;
}

export async function getUpcomingEvents(
  village: string = "",
  limit: number = 8
): Promise<UpcomingEvent[]> {
  const params = new URLSearchParams();
  if (village) params.set("village", village);
  params.set("limit", String(limit));
  const res = await fetch(`${BASE_URL}/api/events?${params}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch events: ${res.status}`);
  return res.json();
}

// ── Auth API ──

export async function fetchCurrentUser(): Promise<AuthUser> {
  const res = await fetchWithRefresh(`${BASE_URL}/api/auth/me`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Not authenticated: ${res.status}`);
  return res.json();
}

export async function logoutServer(): Promise<void> {
  const refresh = getRefreshToken();
  if (refresh) {
    await fetch(`${BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    }).catch(() => {});
  }
  clearAuth();
}

// ── Tier / Usage API ──

export async function getUsageInfo(): Promise<UsageInfo> {
  const res = await fetch(`${BASE_URL}/api/chat/usage`, {
    headers: { ...authHeaders(), ...sessionHeaders() },
  });
  if (!res.ok) throw new Error(`Failed to fetch usage: ${res.status}`);
  return res.json();
}

export async function extendTrial(): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${BASE_URL}/api/chat/extend-trial`, {
    method: "POST",
    headers: { ...sessionHeaders() },
  });
  if (!res.ok) throw new Error(`Failed to extend trial: ${res.status}`);
  return res.json();
}

// ── Conversations API ──

export async function listConversations(): Promise<Conversation[]> {
  const res = await fetch(`${BASE_URL}/api/conversations`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to list conversations: ${res.status}`);
  return res.json();
}

export async function createConversation(
  village: string
): Promise<ConversationDetail> {
  const res = await fetch(`${BASE_URL}/api/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ village }),
  });
  if (!res.ok) throw new Error(`Failed to create conversation: ${res.status}`);
  return res.json();
}

export async function getConversation(
  id: string
): Promise<ConversationDetail> {
  const res = await fetch(`${BASE_URL}/api/conversations/${id}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to get conversation: ${res.status}`);
  return res.json();
}

export async function renameConversation(
  id: string,
  title: string
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/conversations/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`Failed to rename conversation: ${res.status}`);
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/conversations/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok)
    throw new Error(`Failed to delete conversation: ${res.status}`);
}

// ── User Management API (admin only) ──

export interface UserInfo {
  id: number;
  email: string;
  name: string;
  is_admin: boolean;
  can_debug: boolean;
  tier: string;
  raw_tier: string;
  promo_expires_at: string | null;
  last_login_at: string;
}

export async function listUsers(): Promise<UserInfo[]> {
  const res = await fetch(`${BASE_URL}/api/auth/users`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to list users: ${res.status}`);
  return res.json();
}

export async function updateUserPermissions(
  userId: number,
  permissions: { is_admin?: number; can_debug?: number }
): Promise<UserInfo> {
  const res = await fetch(`${BASE_URL}/api/auth/users/${userId}/permissions`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(permissions),
  });
  if (!res.ok) throw new Error(`Failed to update permissions: ${res.status}`);
  return res.json();
}

export async function updateUserTier(
  userId: number,
  tier: "free" | "pro"
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/auth/users/${userId}/tier`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ tier }),
  });
  if (!res.ok) throw new Error(`Failed to update tier: ${res.status}`);
}

export async function updateUserPromo(
  userId: number,
  days: number
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/auth/users/${userId}/promo`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ days }),
  });
  if (!res.ok) throw new Error(`Failed to update promo: ${res.status}`);
}
