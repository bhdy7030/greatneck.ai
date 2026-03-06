"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import GreatNeckMap from "@/components/GreatNeckMap";
import VillageSelector from "@/components/VillageSelector";
import UpcomingEvents from "@/components/UpcomingEvents";
import { useLanguage } from "@/components/LanguageProvider";
import { getUpcomingEvents, type UpcomingEvent } from "@/lib/api";

const ANIMATED_QUESTIONS = [
  "Do I need a permit for a fence?",
  "When is the next library event?",
  "What are the parking rules overnight?",
  "Where can I sign my kid up for swim lessons?",
  "How do I report a pothole?",
  "Can I rent out my basement?",
  "What's the noise ordinance after 10pm?",
  "Are there senior programs nearby?",
];

const QUICK_CHIPS = [
  "How do I get a pool permit?",
  "When is spring break?",
  "Library activities this week?",
];

const CATEGORY_EMOJI: Record<string, string> = {
  school: "🏫", student: "🎒", kids: "🧒", teens: "🧑‍💻",
  family: "👨‍👩‍👧", art: "🎨", entertainment: "🎭", food: "🍽",
  festival: "🎪", health: "💪", education: "📚", community: "🤝",
  general: "📌",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export default function Home() {
  const router = useRouter();
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [transitioning, setTransitioning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stickyInputRef = useRef<HTMLInputElement>(null);
  const heroChatRef = useRef<HTMLDivElement>(null);
  const [chatPinned, setChatPinned] = useState(false);

  // Check if village is already selected
  const [hasVillage, setHasVillage] = useState(false);
  const [selectedVillage, setSelectedVillage] = useState("");
  const [showEvents, setShowEvents] = useState(false);
  const [showChatBox, setShowChatBox] = useState(false);
  const [showChips, setShowChips] = useState(false);
  const [previewEvents, setPreviewEvents] = useState<UpcomingEvent[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState("");
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("gn_village") || "";
    setHasVillage(!!stored);
    setSelectedVillage(stored);
    // Always show events and preview (even without village)
    setShowEvents(true);
    setShowPreview(true);
    getUpcomingEvents(stored || "", 3).then(setPreviewEvents).catch(() => {});
    if (stored) {
      setShowChatBox(true);
      setShowChips(true);
    }
  }, []);

  // Typing animation cycling through sample questions
  useEffect(() => {
    if (inputFocused || query) {
      setAnimatedPlaceholder("");
      return;
    }
    let qIdx = 0;
    let cIdx = 0;
    let phase: "typing" | "pausing" | "deleting" | "gap" = "typing";
    let timer: ReturnType<typeof setTimeout>;

    const step = () => {
      const q = ANIMATED_QUESTIONS[qIdx];
      if (phase === "typing") {
        cIdx++;
        setAnimatedPlaceholder(q.slice(0, cIdx));
        timer = setTimeout(step, cIdx >= q.length ? ((phase = "pausing"), 2000) : 60);
      } else if (phase === "pausing") {
        phase = "deleting";
        timer = setTimeout(step, 30);
      } else if (phase === "deleting") {
        cIdx--;
        setAnimatedPlaceholder(q.slice(0, cIdx));
        timer = setTimeout(step, cIdx <= 0 ? ((phase = "gap"), 400) : 30);
      } else {
        qIdx = (qIdx + 1) % ANIMATED_QUESTIONS.length;
        phase = "typing";
        timer = setTimeout(step, 60);
      }
    };

    timer = setTimeout(step, 500);
    return () => clearTimeout(timer);
  }, [inputFocused, query]);

  // Pin chat bar to top when hero input scrolls out of view
  useEffect(() => {
    const el = heroChatRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setChatPinned(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleVillageSelect = (village: string) => {
    setHasVillage(true);
    setSelectedVillage(village);
    // Staggered entrance: chat box → chips; events/preview already visible
    setTimeout(() => setShowChatBox(true), 200);
    setTimeout(() => setShowChips(true), 600);
    getUpcomingEvents(village, 3).then(setPreviewEvents).catch(() => {});
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
      className={`flex-1 relative overflow-y-auto transition-opacity duration-300 ${
        transitioning ? "opacity-0 scale-[1.02]" : "opacity-100"
      }`}
      style={{ transition: "opacity 0.3s ease, transform 0.3s ease" }}
    >
      {/* Map background — fixed behind scroll */}
      <div className="fixed inset-0 z-0">
        <GreatNeckMap />
        <div
          className="absolute inset-x-0 bottom-0 h-2/3 pointer-events-none"
          style={{
            background:
              "linear-gradient(to top, rgb(var(--color-surface-100)) 0%, rgba(var(--color-surface-100), 0.8) 40%, transparent 100%)",
          }}
        />
      </div>

      {/* Scrollable content */}
      <div className="relative z-10 flex flex-col items-center will-change-transform">
        {/* Hero section — fills viewport */}
        <div className="min-h-[100dvh] flex flex-col justify-center items-center w-full px-6 pb-8">
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

          {/* Chat input — in hero, centered */}
          <div ref={heroChatRef} className={`w-full max-w-2xl ${showChatBox ? "mt-2" : "mt-6"}`}>
            <div
              className={`flex items-center gap-2 bg-surface-50/80 backdrop-blur-sm rounded-xl border-2 transition-all duration-300 px-4 py-2.5 ${
                hasVillage
                  ? "border-sage/40 shadow-md shadow-sage/5 landing-chat-glow"
                  : "border-surface-300 opacity-60"
              } ${showChatBox ? "animate-fadeSlideUp" : ""}`}
            >
              <svg className="w-5 h-5 text-sage flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder={inputFocused || query ? "" : animatedPlaceholder}
                disabled={!hasVillage}
                className="flex-1 bg-transparent text-text-800 text-base md:text-sm focus:outline-none placeholder-text-500 disabled:cursor-not-allowed"
                style={{ fontSize: "max(16px, 0.875rem)" }}
              />
              <button
                onClick={() => navigateToChat()}
                disabled={!hasVillage}
                className="flex-shrink-0 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center bg-sage text-white rounded-lg hover:bg-sage-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Start chatting"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>

            {/* Quick chips */}
            {showChips && (
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                {QUICK_CHIPS.map((q, i) => (
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

          {/* Event preview — teaser cards to encourage scrolling */}
          {showPreview && previewEvents.length > 0 && (
            <div className="w-full max-w-2xl mt-4 animate-fadeSlideUp">
              <p className="text-xs font-semibold text-text-500 uppercase tracking-wider mb-2 px-1">
                {t("events.upcoming")}
              </p>
              <div className="space-y-1.5">
                {previewEvents.map((event) => (
                  <div
                    key={`preview-${event.source}-${event.id}`}
                    onClick={() => {
                      localStorage.setItem("gn_event_context", JSON.stringify(event));
                      localStorage.setItem("gn_fast_mode", "true");
                      router.push("/chat/");
                    }}
                    className="flex items-center gap-3 bg-surface-50 rounded-lg border border-surface-300/50 px-3 py-2 hover:border-sage/40 transition-colors group cursor-pointer"
                  >
                    <span className="text-base flex-shrink-0">
                      {CATEGORY_EMOJI[event.category] || "📌"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-text-800 truncate group-hover:text-sage transition-colors">
                        {event.title}
                      </h4>
                      <span className="text-xs text-text-500">
                        {shortDate(event.event_date)}
                        {event.event_time && ` · ${event.event_time}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {event.url && (
                        <a
                          href={event.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-text-400 hover:text-sage transition-colors"
                          title="Open source"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                      <svg className="w-3.5 h-3.5 text-text-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-text-400 text-center mt-2">
                Scroll down for all events ↓
              </p>
            </div>
          )}

          {/* Scroll hint arrow */}
          {showEvents && previewEvents.length === 0 && (
            <div className="mt-6 animate-arrowBounce text-text-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
          )}
        </div>

        {/* Pinned chat bar — appears when hero input scrolls away */}
        <div
          className={`sticky top-0 z-20 w-full px-6 py-2 bg-surface-100/90 backdrop-blur-md transition-all duration-200 ${
            chatPinned ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-full pointer-events-none"
          }`}
        >
          <div className="max-w-2xl mx-auto">
            <div
              className={`flex items-center gap-2 bg-surface-50/80 rounded-xl border-2 px-4 py-2.5 ${
                hasVillage ? "border-sage/40 shadow-md" : "border-surface-300 opacity-60"
              }`}
            >
              <svg className="w-5 h-5 text-sage flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <input
                ref={stickyInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder={inputFocused || query ? "" : animatedPlaceholder}
                disabled={!hasVillage}
                className="flex-1 bg-transparent text-text-800 text-sm focus:outline-none placeholder-text-500 disabled:cursor-not-allowed"
                style={{ fontSize: "max(16px, 0.875rem)" }}
              />
              <button
                onClick={() => navigateToChat()}
                disabled={!hasVillage}
                className="flex-shrink-0 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center bg-sage text-white rounded-lg hover:bg-sage-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Start chatting"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Events — full page feed */}
        {showEvents && (
          <div className="w-full px-6 pb-12">
            <UpcomingEvents village={selectedVillage} />
          </div>
        )}

        {/* Footer */}
        <div className="w-full py-6 text-center">
          <a
            href="mailto:contact@askmura.com"
            className="text-xs text-text-400 hover:text-sage transition-colors"
          >
            contact@askmura.com
          </a>
        </div>
      </div>
    </div>
  );
}
