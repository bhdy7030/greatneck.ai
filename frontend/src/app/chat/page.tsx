"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageProvider";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import PipelineSteps from "@/components/PipelineSteps";
import ConversationSidebar from "@/components/ConversationSidebar";
import {
  sendMessageStream,
  getConversation,
  createConversation,
  type ChatMessage as ChatMessageType,
  type PipelineEvent,
  type WebSearchMode,
} from "@/lib/api";

export default function ChatPage() {
  return (
    <Suspense>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { language, t } = useLanguage();

  const [village, setVillage] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pipelineEvents, setPipelineEvents] = useState<PipelineEvent[]>([]);
  const pipelineEventsRef = useRef<PipelineEvent[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [webSearchMode, setWebSearchMode] = useState<WebSearchMode>("limited");
  const [fastMode, setFastMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const draftSentRef = useRef(false);

  // Load village and web search mode from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("gn_village");
    if (!stored) {
      router.push("/");
      return;
    }
    setVillage(stored);
    const storedMode = localStorage.getItem("gn_web_search_mode");
    if (storedMode === "off" || storedMode === "limited" || storedMode === "unlimited") {
      setWebSearchMode(storedMode);
    }
    const storedFast = localStorage.getItem("gn_fast_mode");
    if (storedFast === "true") setFastMode(true);
  }, [router]);

  // Auto-send draft from landing page
  useEffect(() => {
    if (draftSentRef.current || !village) return;
    const draft = localStorage.getItem("gn_draft");
    if (draft) {
      localStorage.removeItem("gn_draft");
      draftSentRef.current = true;
      // Small delay to let the page fully render
      setTimeout(() => handleSend(draft), 100);
    }
  }, [village]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load conversation from URL ?id=
  useEffect(() => {
    const id = searchParams.get("id");
    if (id && user && id !== conversationId) {
      loadConversation(id);
    }
  }, [searchParams, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadConversation = async (id: string) => {
    try {
      const convo = await getConversation(id);
      setConversationId(convo.id);
      setMessages(
        convo.messages.map((m) => ({
          role: m.role,
          content: m.content,
          image: m.image_base64 || undefined,
          sources: m.sources,
          agent: m.agent_used || undefined,
        }))
      );
      if (convo.village) {
        setVillage(convo.village);
        localStorage.setItem("gn_village", convo.village);
      }
    } catch {
      // Conversation not found — reset
      setConversationId(null);
    }
  };

  // Auto-scroll to bottom on new messages or pipeline events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, pipelineEvents]);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setPipelineEvents([]);
    setError(null);
    // Update URL without reload
    const params = new URLSearchParams(window.location.search);
    params.delete("id");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : "")
    );
  }, []);

  const handleSelectConversation = useCallback(
    (id: string) => {
      if (id === conversationId) return;
      loadConversation(id);
      // Update URL
      const params = new URLSearchParams(window.location.search);
      params.set("id", String(id));
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}?${params.toString()}`
      );
    },
    [conversationId] // eslint-disable-line react-hooks/exhaustive-deps
  );

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
      pipelineEventsRef.current = [];

      // Build history for context (exclude images to keep payload small)
      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // If logged in and no active conversation, create one
      let activeConvoId = conversationId;
      if (user && !activeConvoId) {
        try {
          const convo = await createConversation(village);
          activeConvoId = convo.id;
          setConversationId(convo.id);
          // Update URL
          window.history.replaceState(
            {},
            "",
            `${window.location.pathname}?id=${convo.id}`
          );
        } catch {
          // Fall through — send without persistence
        }
      }

      try {
        const response = await sendMessageStream(
          text,
          village,
          (event) => {
            pipelineEventsRef.current = [...pipelineEventsRef.current, event];
            setPipelineEvents((prev) => [...prev, event]);
          },
          imageBase64,
          history,
          false,
          activeConvoId || undefined,
          webSearchMode,
          language,
          fastMode
        );

        // Update conversation_id from response if we didn't have one
        if (response.conversation_id && !activeConvoId) {
          setConversationId(response.conversation_id);
          window.history.replaceState(
            {},
            "",
            `${window.location.pathname}?id=${response.conversation_id}`
          );
        }

        const assistantMessage: ChatMessageType = {
          role: "assistant",
          content: response.response,
          sources: response.sources,
          agent: response.agent_used,
          pipelineEvents: [...pipelineEventsRef.current],
        };

        setMessages((prev) => [...prev, assistantMessage]);
        // Trigger sidebar refresh to show new/updated conversation
        setSidebarRefresh((n) => n + 1);
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
    [village, messages, conversationId, user, webSearchMode, language, fastMode]
  );

  if (!village) {
    return null; // Will redirect
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <ConversationSidebar
        activeId={conversationId}
        onSelect={handleSelectConversation}
        onNewChat={handleNewChat}
        refreshKey={sidebarRefresh}
      />

      {/* Chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Village badge */}
        <div className="flex-shrink-0 px-3 md:px-4 py-2 bg-surface-50 border-b border-surface-300">
          <div className="max-w-3xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-1.5 md:gap-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-500 hidden md:inline">{t("chat.village")}</span>
              <span className="text-xs font-medium text-sage bg-sage/10 px-2 py-0.5 rounded-full">
                {village}
              </span>
            </div>
            <div className="flex items-center flex-wrap gap-2 md:gap-3">
              <div className="flex items-center gap-1">
                <span className="text-xs text-text-500 hidden md:inline">{t("chat.searchWeb")}</span>
                {/* Mobile: globe icon */}
                <svg className="w-3.5 h-3.5 text-text-500 md:hidden flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
                </svg>
                {(["off", "limited", "unlimited"] as WebSearchMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setWebSearchMode(mode);
                      localStorage.setItem("gn_web_search_mode", mode);
                    }}
                    className={`text-xs px-2 py-1 min-h-[28px] md:min-h-0 md:py-0.5 rounded-full transition-colors ${
                      webSearchMode === mode
                        ? "bg-sage text-white"
                        : "bg-surface-200 text-text-500 hover:bg-surface-300"
                    }`}
                  >
                    {mode === "off" ? t("chat.webOff") : mode === "limited" ? t("chat.webLimited") : t("chat.webUnlimited")}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-text-500 hidden md:inline">Speed</span>
                {/* Mobile: bolt icon */}
                <svg className="w-3.5 h-3.5 text-text-500 md:hidden flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {(["full", "fast"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      const isFast = mode === "fast";
                      setFastMode(isFast);
                      localStorage.setItem("gn_fast_mode", String(isFast));
                    }}
                    className={`text-xs px-2 py-1 min-h-[28px] md:min-h-0 md:py-0.5 rounded-full transition-colors ${
                      (mode === "fast") === fastMode
                        ? "bg-sage text-white"
                        : "bg-surface-200 text-text-500 hover:bg-surface-300"
                    }`}
                  >
                    {mode === "full" ? "Full" : "Fast"}
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  localStorage.removeItem("gn_village");
                  router.push("/");
                }}
                className="text-xs text-text-500 hover:text-text-800 transition-colors ml-auto md:ml-0"
              >
                {t("chat.changeVillage")}
              </button>
            </div>
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
                  {t("chat.howCanIHelp")}
                </h2>
                <p className="text-sm text-text-500 max-w-sm mx-auto">
                  {t("chat.emptySub", { village })}
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {[
                    t("chat.q1"),
                    t("chat.q2"),
                    t("chat.q3"),
                    t("chat.q4"),
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
                <div className="max-w-[92%] md:max-w-[70%]">
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
                    <span className="text-xs text-text-500">{t("chat.connecting")}</span>
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
    </div>
  );
}
