"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import PipelineSteps from "@/components/PipelineSteps";
import {
  sendMessageStream,
  type ChatMessage as ChatMessageType,
  type PipelineEvent,
} from "@/lib/api";

export default function ChatPage() {
  const router = useRouter();
  const [village, setVillage] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pipelineEvents, setPipelineEvents] = useState<PipelineEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load village from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("greatneck_village");
    if (!stored) {
      router.push("/");
      return;
    }
    setVillage(stored);
  }, [router]);

  // Auto-scroll to bottom on new messages or pipeline events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, pipelineEvents]);

  const handleSend = useCallback(
    async (text: string, imageBase64?: string) => {
      if (!village) return;

      const userMessage: ChatMessageType = {
        role: "user",
        content: text,
        image: imageBase64,
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);
      setPipelineEvents([]);

      // Build history for context (exclude images to keep payload small)
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
          history
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
          content: `Sorry, I encountered an error: ${errMsg}. Please try again.`,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [village, messages]
  );

  if (!village) {
    return null; // Will redirect
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Village badge */}
      <div className="flex-shrink-0 px-4 py-2 bg-surface-50 border-b border-surface-300">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-500">Village:</span>
            <span className="text-xs font-medium text-sage bg-sage/10 px-2 py-0.5 rounded-full">
              {village}
            </span>
          </div>
          <button
            onClick={() => {
              localStorage.removeItem("greatneck_village");
              router.push("/");
            }}
            className="text-xs text-text-500 hover:text-text-800 transition-colors"
          >
            Change village
          </button>
        </div>
      </div>

      {/* Messages container */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto">
          {messages.length === 0 && (
            <div className="text-center py-16">
              <svg
                className="w-16 h-16 text-surface-400 mx-auto mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              <h2 className="text-lg font-semibold text-text-700 mb-2">
                How can I help?
              </h2>
              <p className="text-sm text-text-500 max-w-sm mx-auto">
                Ask about village codes, permit requirements, garbage schedules,
                snow removal rules, or anything about {village}.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {[
                  "What are the garbage pickup days?",
                  "Do I need a permit for a fence?",
                  "What are the snow removal rules?",
                  "Village contact information",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => handleSend(q)}
                    className="text-xs bg-surface-200 text-text-600 px-3 py-2 rounded-lg hover:bg-surface-300 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatMessage key={i} message={msg} />
          ))}

          {/* Pipeline steps (shown while loading) */}
          {isLoading && pipelineEvents.length > 0 && (
            <div className="flex justify-start mb-4">
              <div className="max-w-[85%] md:max-w-[70%]">
                <PipelineSteps events={pipelineEvents} isComplete={false} />
              </div>
            </div>
          )}

          {/* Simple loading indicator (before any pipeline events) */}
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

          {/* Error banner */}
          {error && !isLoading && (
            <div className="text-center py-2">
              <span className="text-xs text-red-600 bg-red-50 px-3 py-1 rounded-full">
                {error}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 max-w-3xl mx-auto w-full">
        <ChatInput onSend={handleSend} disabled={isLoading} />
      </div>
    </div>
  );
}
