"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageProvider";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import PipelineSteps from "@/components/PipelineSteps";
import ConversationSidebar from "@/components/ConversationSidebar";
import UsageLimitModal from "@/components/UsageLimitModal";
import {
  sendMessageStream,
  getConversation,
  createConversation,
  TierError,
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
  const { user, features, usage, refreshUsage, tier } = useAuth();
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tierModal, setTierModal] = useState<"trial_exhausted" | "must_sign_in" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const draftSentRef = useRef(false);
  const [returnGuideId, setReturnGuideId] = useState<string | null>(null);

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

  // Auto-send draft or event context from landing page
  useEffect(() => {
    if (draftSentRef.current || !village) return;

    // Check for event context first (click on event card)
    const eventJson = localStorage.getItem("gn_event_context");
    if (eventJson) {
      localStorage.removeItem("gn_event_context");
      draftSentRef.current = true;
      try {
        const event = JSON.parse(eventJson);
        const parts = [`Tell me about this event: ${event.title}`];
        if (event.event_date) parts.push(`Date: ${event.event_date}${event.event_time ? " " + event.event_time : ""}`);
        if (event.venue) parts.push(`Venue: ${event.venue}`);
        if (event.url) parts.push(`Source: ${event.url}`);
        if (event.source_id) parts.push(`Event ID: ${event.source_id}`);
        else if (event.id) parts.push(`Event ID: ${event.id}`);
        const msg = parts.join("\n");
        setTimeout(() => handleSend(msg), 100);
      } catch {
        // Ignore bad JSON
      }
      return;
    }

    // Check for guide return link
    const returnGuide = localStorage.getItem("gn_return_guide");
    if (returnGuide) {
      localStorage.removeItem("gn_return_guide");
      setReturnGuideId(returnGuide);
    }

    // Check for text draft (typed query from landing page)
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

  // Auto-scroll: while loading, follow bottom; when response arrives, scroll to its start
  const lastMessageCountRef = useRef(0);
  useEffect(() => {
    if (!scrollRef.current) return;
    const messageCount = messages.length;
    const justAdded = messageCount > lastMessageCountRef.current;
    lastMessageCountRef.current = messageCount;

    if (justAdded && messageCount > 0 && messages[messageCount - 1].role === "assistant") {
      // New assistant message — scroll to the start of it
      const container = scrollRef.current;
      const allMsgEls = container.querySelectorAll("[data-msg-idx]");
      const lastMsgEl = allMsgEls[allMsgEls.length - 1] as HTMLElement | undefined;
      if (lastMsgEl) {
        // Scroll so the top of the response is near the top of the viewport
        const containerRect = container.getBoundingClientRect();
        const msgRect = lastMsgEl.getBoundingClientRect();
        const offset = msgRect.top - containerRect.top + container.scrollTop - 16;
        container.scrollTo({ top: offset, behavior: "smooth" });
        return;
      }
    }
    // Default: scroll to bottom (loading states, user messages, pipeline events)
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
    async (text: string, imageBase64?: string, imageMime?: string) => {
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
          fastMode,
          imageMime
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
        // Refresh usage counters
        refreshUsage();
        // Track chat count for invite nudge
        const chatCount = parseInt(localStorage.getItem("gn_chat_count") || "0", 10);
        localStorage.setItem("gn_chat_count", String(chatCount + 1));
      } catch (err) {
        if (err instanceof TierError) {
          setTierModal(err.code as "trial_exhausted" | "must_sign_in");
          // Remove the user message we optimistically added
          setMessages((prev) => prev.slice(0, -1));
          setIsLoading(false);
          return;
        }
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
    [village, messages, conversationId, user, webSearchMode, language, fastMode, features, refreshUsage]
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
        mobileOpen={sidebarOpen}
        onMobileToggle={() => setSidebarOpen(!sidebarOpen)}
      />

      {/* Chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Village badge */}
        <div className="flex-shrink-0 px-3 md:px-4 py-1.5 md:py-2 bg-surface-50 border-b border-surface-300">
          <div className="max-w-3xl mx-auto flex items-center gap-2 md:gap-3">
            {/* Mobile sidebar toggle */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden p-1 -ml-1 text-text-600 hover:text-text-800 transition-colors"
              aria-label="Toggle chat history"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d={sidebarOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
              </svg>
            </button>

            {/* Village badge — tap to change */}
            <button
              onClick={() => {
                localStorage.removeItem("gn_village");
                router.push("/");
              }}
              className="flex items-center gap-1 text-xs font-medium text-sage bg-sage/10 px-2 py-0.5 rounded-full hover:bg-sage/20 transition-colors flex-shrink-0"
              title={t("chat.changeVillage")}
            >
              {village}
              <svg className="w-3 h-3 text-sage/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Separator */}
            <div className="w-px h-4 bg-surface-300 hidden md:block" />

            {/* Web search: toggle on/off + ∞ option */}
            <div className="flex items-center gap-1 ml-auto md:ml-0">
              <button
                onClick={() => {
                  const next = webSearchMode === "off" ? "limited" : "off";
                  setWebSearchMode(next);
                  localStorage.setItem("gn_web_search_mode", next);
                }}
                className="flex items-center gap-1 cursor-pointer"
                title={webSearchMode === "off" ? "Enable web search" : "Disable web search"}
              >
                <svg className={`w-3.5 h-3.5 flex-shrink-0 transition-colors ${webSearchMode === "off" ? "text-text-400" : "text-sage"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
                </svg>
                <div className={`w-7 h-4 rounded-full transition-colors relative ${webSearchMode === "off" ? "bg-surface-400" : "bg-sage"}`}>
                  <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${webSearchMode === "off" ? "left-0.5" : "left-3.5"}`} />
                </div>
              </button>
              {webSearchMode !== "off" && (
                <button
                  onClick={() => {
                    if (features?.web_search_mode !== "unlimited" && webSearchMode !== "unlimited") return;
                    const next = webSearchMode === "unlimited" ? "limited" : "unlimited";
                    setWebSearchMode(next);
                    localStorage.setItem("gn_web_search_mode", next);
                  }}
                  className={`text-[11px] px-1.5 py-0.5 min-h-[24px] rounded-full transition-all ${
                    features?.web_search_mode !== "unlimited" && webSearchMode !== "unlimited"
                      ? "bg-surface-200 text-text-300 cursor-not-allowed"
                      : webSearchMode === "unlimited"
                        ? "bg-gold text-white shadow-sm shadow-gold/30"
                        : "bg-surface-200 text-gold/60 hover:text-gold hover:bg-gold/10"
                  }`}
                  title={
                    features?.web_search_mode !== "unlimited"
                      ? t("tier.unlimitedSearchLocked")
                      : webSearchMode === "unlimited"
                        ? "Switch to limited (up to 5)"
                        : "Unlimited — deeper web search"
                  }
                >
                  ∞
                </button>
              )}
            </div>

            {/* Speed: bolt toggle */}
            <button
              onClick={() => {
                if (features?.fast_mode_forced) return;
                const next = !fastMode;
                setFastMode(next);
                localStorage.setItem("gn_fast_mode", String(next));
              }}
              className={`flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 min-h-[24px] rounded-full transition-colors ${
                features?.fast_mode_forced
                  ? "bg-surface-300 text-text-400 cursor-not-allowed"
                  : fastMode
                    ? "bg-amber-500 text-white"
                    : "bg-sage text-white"
              }`}
              title={
                features?.fast_mode_forced
                  ? t("tier.deepLocked")
                  : fastMode
                    ? "Fast mode (Sonnet)"
                    : "Deep mode (Opus)"
              }
            >
              {fastMode || features?.fast_mode_forced ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              )}
              {fastMode || features?.fast_mode_forced ? "Fast" : "Deep"}
            </button>
          </div>
        </div>

        {/* Messages container */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto">
            {/* Back to playbook banner */}
            {returnGuideId && (
              <div className="mb-4 flex items-center gap-2 bg-sage/10 border border-sage/20 rounded-lg px-3 py-2">
                <button
                  onClick={() => {
                    localStorage.setItem("gn_return_guide", returnGuideId);
                    router.push("/guides");
                  }}
                  className="flex items-center gap-1 text-xs font-medium text-sage hover:text-sage-dark transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  {t("guides.chat.backToPlaybook")}
                </button>
                <button
                  onClick={() => setReturnGuideId(null)}
                  className="ml-auto text-text-500 hover:text-text-700 p-0.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
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
              <div key={i} data-msg-idx={i}>
                <ChatMessage message={msg} />
              </div>
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

      {/* Tier limit modal */}
      {tierModal && (
        <UsageLimitModal
          code={tierModal}
          onClose={() => setTierModal(null)}
        />
      )}
    </div>
  );
}
