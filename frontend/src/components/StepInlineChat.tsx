"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { useLanguage } from "./LanguageProvider";
import { sendMessageStream, type PipelineEvent } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface StepInlineChatProps {
  chatPrompt: string;
  stepTitle: string;
  guideTitle?: string;
  stepDescription?: string;
  stepDetails?: string;
  guideId: string;
  stepId: string;
  onContinueInChat: () => void;
}

export default function StepInlineChat({
  chatPrompt,
  stepTitle,
  guideTitle,
  stepDescription,
  stepDetails,
  guideId,
  stepId,
  onContinueInChat,
}: StepInlineChatProps) {
  const { t, language } = useLanguage();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const village =
    typeof window !== "undefined"
      ? localStorage.getItem("gn_village") || ""
      : "";

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;

      const userMsg: Message = { role: "user", content: text.trim() };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setStreaming(true);
      setStreamText("");

      const contextParts = [`You are answering a question about "${stepTitle}"${guideTitle ? ` from the playbook "${guideTitle}"` : ""} for a Great Neck resident.`];
      if (stepDescription) contextParts.push(`Step overview: ${stepDescription}`);
      if (stepDetails) contextParts.push(`Step details:\n${stepDetails}`);
      contextParts.push("Keep answers concise: 2-3 sentences max, under 120 words. Be specific and actionable.");
      const systemHint = `[${contextParts.join(" ")}]`;

      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let full = "";
      try {
        await sendMessageStream(
          `${systemHint}\n\n${text.trim()}`,
          village,
          (event: PipelineEvent) => {
            if (event.type === "response" && event.response) {
              full = event.response;
              setStreamText(full);
            }
          },
          undefined,
          history,
          false,
          undefined,
          false,
          language,
          true,
          undefined,
          (token) => {
            full += token;
            setStreamText(full);
          },
        );
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: full },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: t("guides.chat.error"),
          },
        ]);
      } finally {
        setStreaming(false);
        setStreamText("");
      }
    },
    [streaming, messages, village, language, stepTitle, t]
  );

  // Auto-scroll on new messages or streaming
  useEffect(() => {
    scrollToBottom();
  }, [messages, streamText, scrollToBottom]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleContinue = () => {
    // Pass full inline chat history + guide return info
    localStorage.setItem(
      "gn_return_guide",
      JSON.stringify({ guideId, stepId })
    );
    // Store entire conversation so full chat can seed it
    if (messages.length > 0) {
      localStorage.setItem("gn_inline_messages", JSON.stringify(messages));
    }
    // Clear draft — full chat will use inline messages instead
    localStorage.removeItem("gn_draft");
    onContinueInChat();
  };

  return (
    <div className="bg-sage/5 border border-sage/20 rounded-xl mt-2 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">✨</span>
          <span className="text-[11px] font-semibold text-text-700">
            {t("guides.chat.title")}
          </span>
        </div>
        <span className="text-[9px] text-text-500">{stepTitle}</span>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="px-3 overflow-y-auto space-y-2"
        style={{ maxHeight: "200px" }}
      >
        {messages.length === 0 && !streaming && (
          <p className="text-[11px] text-text-500 py-2">
            {t("guides.chat.placeholder")}
          </p>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === "user" ? (
              <div className="flex justify-end">
                <div className="bg-sage/15 text-text-800 text-xs px-2.5 py-1.5 rounded-xl rounded-br-sm max-w-[85%]">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div className="text-xs text-text-700 leading-relaxed prose prose-xs max-w-none [&_p]:my-0.5 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_li]:my-0">
                <ReactMarkdown
                  components={{
                    table: () => null,
                    pre: ({ children }) => <span>{children}</span>,
                    code: ({ children }) => (
                      <span className="font-mono text-[11px]">{children}</span>
                    ),
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        ))}

        {/* Streaming response */}
        {streaming && streamText && (
          <div className="text-xs text-text-700 leading-relaxed prose prose-xs max-w-none [&_p]:my-0.5">
            <ReactMarkdown
              components={{
                table: () => null,
                pre: ({ children }) => <span>{children}</span>,
                code: ({ children }) => (
                  <span className="font-mono text-[11px]">{children}</span>
                ),
              }}
            >
              {streamText}
            </ReactMarkdown>
          </div>
        )}

        {/* Loading dots */}
        {streaming && !streamText && (
          <div className="flex items-center gap-1 py-1">
            <span className="typing-dot w-1.5 h-1.5 rounded-full bg-sage" />
            <span className="typing-dot w-1.5 h-1.5 rounded-full bg-sage" />
            <span className="typing-dot w-1.5 h-1.5 rounded-full bg-sage" />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-2 flex gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
          placeholder={t("guides.chat.inputPlaceholder")}
          disabled={streaming}
          className="flex-1 text-xs px-2.5 py-2 min-h-[36px] border border-surface-300 rounded-lg bg-white focus:outline-none focus:border-sage disabled:opacity-50"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || streaming}
          className="px-2.5 py-2 min-h-[36px] min-w-[36px] rounded-lg bg-sage text-white text-xs font-medium hover:bg-sage-dark transition-colors disabled:opacity-40 flex items-center justify-center"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 12h14M12 5l7 7-7 7"
            />
          </svg>
        </button>
      </div>

      {/* Continue in full chat */}
      {messages.length > 0 && !streaming && (
        <div className="px-3 pb-2.5">
          <button
            onClick={handleContinue}
            className="text-[11px] text-sage hover:text-sage-dark font-medium transition-colors"
          >
            {t("guides.chat.continue")}
          </button>
        </div>
      )}
    </div>
  );
}
