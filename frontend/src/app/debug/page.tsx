"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import DebugPipeline from "@/components/DebugPipeline";
import DebugMemoryPanel from "@/components/DebugMemoryPanel";
import {
  sendMessageStream,
  type ChatMessage as ChatMessageType,
  type PipelineEvent,
} from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";

const VILLAGES = [
  "Great Neck",
  "Great Neck Estates",
  "Great Neck Plaza",
  "Kensington",
  "Kings Point",
  "Thomaston",
];

export default function DebugPage() {
  const { user, isLoading: authLoading } = useAuth();
  const canDebug = user?.is_admin || user?.can_debug;

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-text-500">Loading...</p>
      </div>
    );
  }

  if (!canDebug) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-text-700 mb-2">Access Denied</h2>
          <p className="text-sm text-text-500">You need debug permissions to view this page.</p>
        </div>
      </div>
    );
  }

  return <DebugContent />;
}

function DebugContent() {
  const [village, setVillage] = useState("Great Neck");
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pipelineEvents, setPipelineEvents] = useState<PipelineEvent[]>([]);
  const [lastQuery, setLastQuery] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, pipelineEvents]);

  const handleSend = useCallback(
    async (text: string, imageBase64?: string) => {
      const userMessage: ChatMessageType = {
        role: "user",
        content: text,
        image: imageBase64,
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);
      setPipelineEvents([]);
      setLastQuery(text);

      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        const response = await sendMessageStream(
          text,
          village,
          (event) => {
            setPipelineEvents((prev) => [...prev, event]);
          },
          imageBase64,
          history,
          true // debug mode
        );

        const assistantMessage: ChatMessageType = {
          role: "assistant",
          content: response.response,
          sources: response.sources,
          agent: response.agent_used,
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : "Something went wrong";
        setError(errMsg);

        const errorMessage: ChatMessageType = {
          role: "assistant",
          content: `Error: ${errMsg}`,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [village, messages]
  );

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left panel — Chat + Debug Pipeline */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Village selector bar */}
        <div className="flex-shrink-0 px-4 py-2 bg-surface-50 border-b border-surface-300">
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gold uppercase tracking-wider font-bold">
              God Mode
            </span>
            <select
              value={village}
              onChange={(e) => setVillage(e.target.value)}
              className="text-xs bg-surface-100 border border-surface-300 text-text-800 rounded px-2 py-1"
            >
              {VILLAGES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-text-500">
              debug=true | full pipeline visibility
            </span>
          </div>
        </div>

        {/* Messages + pipeline */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          <div className="max-w-3xl mx-auto">
            {messages.length === 0 && (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">&#x1f9d0;</div>
                <h2 className="text-lg font-semibold text-text-700 mb-2">
                  Debug / God Mode
                </h2>
                <p className="text-sm text-text-500 max-w-md mx-auto">
                  Chat here to test queries. Full pipeline data is shown inline.
                  Use the memory panel on the right to save instructions that
                  will be injected into agent prompts.
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <ChatMessage key={i} message={msg} />
            ))}

            {/* Debug pipeline (always expanded) */}
            {pipelineEvents.length > 0 && (
              <div className="flex justify-start mb-4">
                <div className="w-full max-w-[95%]">
                  <DebugPipeline events={pipelineEvents} isComplete={!isLoading} />
                </div>
              </div>
            )}

            {/* Loading indicator */}
            {isLoading && pipelineEvents.length === 0 && (
              <div className="flex justify-start mb-4">
                <div className="bg-surface-50 border border-surface-300 rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-text-500 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-2 h-2 bg-text-500 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-2 h-2 bg-text-500 rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                    <span className="text-xs text-text-500">Connecting...</span>
                  </div>
                </div>
              </div>
            )}

            {error && !isLoading && (
              <div className="text-center py-2">
                <span className="text-xs text-red-600 bg-red-50 px-3 py-1 rounded-full">
                  {error}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="flex-shrink-0 max-w-3xl mx-auto w-full">
          <ChatInput onSend={handleSend} disabled={isLoading} />
        </div>
      </div>

      {/* Right panel — Debug Memory */}
      <div className="w-80 flex-shrink-0 border-l border-surface-300 bg-surface-100 flex flex-col">
        <DebugMemoryPanel currentQuery={lastQuery} messages={messages} pipelineEvents={pipelineEvents} />
      </div>
    </div>
  );
}
