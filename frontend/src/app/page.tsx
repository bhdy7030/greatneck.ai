"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import GreatNeckMap from "@/components/GreatNeckMap";
import VillageSelector from "@/components/VillageSelector";
import { useLanguage } from "@/components/LanguageProvider";

const SAMPLE_QUESTIONS = [
  "What permits do I need for a deck?",
  "When is bulk trash pickup?",
  "Can I run a business from home?",
];

export default function Home() {
  const router = useRouter();
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [transitioning, setTransitioning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Check if village is already selected
  const [hasVillage, setHasVillage] = useState(false);
  const [showChatBox, setShowChatBox] = useState(false);
  const [typedPlaceholder, setTypedPlaceholder] = useState("");
  const [showChips, setShowChips] = useState(false);

  useEffect(() => {
    const stored = !!localStorage.getItem("gn_village");
    setHasVillage(stored);
    if (stored) {
      setShowChatBox(true);
      setShowChips(true);
    }
  }, []);

  // Typing animation for placeholder
  useEffect(() => {
    if (!showChatBox || query) return;
    const sampleText = SAMPLE_QUESTIONS[0];
    let i = 0;
    setTypedPlaceholder("");
    const interval = setInterval(() => {
      i++;
      setTypedPlaceholder(sampleText.slice(0, i));
      if (i >= sampleText.length) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, [showChatBox, query]);

  const handleVillageSelect = (village: string) => {
    setHasVillage(true);
    // Staggered entrance: chat box first, then chips
    setTimeout(() => setShowChatBox(true), 200);
    setTimeout(() => setShowChips(true), 600);
  };

  const navigateToChat = (text?: string) => {
    setTransitioning(true);
    const q = (text || query).trim();
    setTimeout(() => {
      if (q) {
        localStorage.setItem("gn_draft", q);
      }
      router.push("/chat/");
    }, 300);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && query.trim()) {
      e.preventDefault();
      navigateToChat();
    }
  };

  return (
    <div
      className={`flex-1 relative overflow-hidden transition-opacity duration-300 ${
        transitioning ? "opacity-0 scale-[1.02]" : "opacity-100"
      }`}
      style={{ transition: "opacity 0.3s ease, transform 0.3s ease" }}
    >
      {/* Map background */}
      <GreatNeckMap />

      {/* Gradient overlay */}
      <div
        className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none"
        style={{
          background:
            "linear-gradient(to top, rgb(var(--color-surface-100)) 0%, rgba(var(--color-surface-100), 0.8) 40%, transparent 100%)",
        }}
      />

      {/* Content centered */}
      <div className="relative z-10 flex flex-col h-full justify-center items-center px-6">
        {/* Frosted card */}
        <div className="bg-surface-50/10 backdrop-blur-sm rounded-2xl p-6 md:p-8 max-w-2xl w-full shadow-lg border border-surface-300/50">
          <div className="text-center mb-5">
            <h1 className="text-2xl md:text-4xl font-bold text-text-800 mb-1">
              {t("welcome.title")}
            </h1>
            <p className="text-text-500 text-sm md:text-base">
              {t("welcome.subtitle")}
            </p>
          </div>

          <VillageSelector onSelect={handleVillageSelect} />
        </div>

        {/* Chat input at bottom */}
        <div className={`w-full max-w-2xl ${showChatBox ? "mt-2" : "mt-6"}`}>
          <div
            className={`flex items-center gap-2 bg-surface-50/80 backdrop-blur-sm rounded-xl border-2 transition-all duration-300 px-4 py-2.5 ${
              hasVillage
                ? "border-sage/40 shadow-md shadow-sage/5 landing-chat-glow"
                : "border-surface-300 opacity-60"
            } ${showChatBox ? "animate-fadeSlideUp" : ""}`}
          >
            <svg
              className="w-5 h-5 text-sage flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onFocus={() => {
                if (!hasVillage) return;
              }}
              placeholder={
                hasVillage
                  ? (query ? t("input.placeholder") : typedPlaceholder || t("input.placeholder"))
                  : "Select a village first..."
              }
              disabled={!hasVillage}
              className="flex-1 bg-transparent text-text-800 text-sm focus:outline-none placeholder-text-500 disabled:cursor-not-allowed"
            />
            <button
              onClick={() => navigateToChat()}
              disabled={!hasVillage}
              className="flex-shrink-0 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center bg-sage text-white rounded-lg hover:bg-sage-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Start chatting"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14 5l7 7m0 0l-7 7m7-7H3"
                />
              </svg>
            </button>
          </div>

          {/* Suggestion chips */}
          {showChips && (
            <div className="flex flex-wrap justify-center gap-2 mt-3">
              {SAMPLE_QUESTIONS.map((q, i) => (
                <button
                  key={q}
                  onClick={() => navigateToChat(q)}
                  className="animate-chipBounceIn text-xs bg-surface-50/80 backdrop-blur-sm text-text-600 px-3 py-2 rounded-full border border-surface-300/60 hover:border-sage/40 hover:text-sage transition-colors"
                  style={{ animationDelay: `${i * 150}ms` }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
