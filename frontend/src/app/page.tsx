"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import GreatNeckMap from "@/components/GreatNeckMap";
import VillageSelector from "@/components/VillageSelector";
import UpcomingEvents, { DateRangeTabs, type DateRange } from "@/components/UpcomingEvents";
import { useLanguage } from "@/components/LanguageProvider";

const ANIMATED_QUESTION_KEYS = [
  "landing.q.fence",
  "landing.q.library",
  "landing.q.parking",
  "landing.q.swim",
  "landing.q.pothole",
  "landing.q.basement",
  "landing.q.noise",
  "landing.q.senior",
  "landing.q.trash",
  "landing.q.restaurants",
  "landing.q.school",
  "landing.q.tax",
  "landing.q.park",
  "landing.q.dog",
  "landing.q.pool",
  "landing.q.weekend",
  "landing.q.ice",
  "landing.q.recycle",
  "landing.q.camp",
  "landing.q.waterpark",
  "landing.q.poolfee",
];

export default function Home() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [query, setQuery] = useState("");
  const [transitioning, setTransitioning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stickyInputRef = useRef<HTMLInputElement>(null);
  const heroChatRef = useRef<HTMLDivElement>(null);
  const [chatPinned, setChatPinned] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [dateRangeCounts, setDateRangeCounts] = useState<Record<DateRange, number>>({ all: 0, today: 0, tomorrow: 0, weekend: 0 });

  // Pick 3 random chips from the animated questions pool (stable per mount)
  const chipKeys = useMemo(() => {
    const shuffled = [...ANIMATED_QUESTION_KEYS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3);
  }, []);

  // Check if village is already selected
  const [hasVillage, setHasVillage] = useState(false);
  const [selectedVillage, setSelectedVillage] = useState("");
  const [showEvents, setShowEvents] = useState(false);
  const [showChatBox, setShowChatBox] = useState(false);
  const [showChips, setShowChips] = useState(false);
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState("");
  const [inputFocused, setInputFocused] = useState(false);

  // Hero title typing animation
  const [heroTitle, setHeroTitle] = useState("");
  const [showSubtitle, setShowSubtitle] = useState(false);
  const [titleCollapsed, setTitleCollapsed] = useState(false);
  const [titleTyped, setTitleTyped] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("gn_village") || "";
    setHasVillage(!!stored);
    setSelectedVillage(stored);
    setShowEvents(true);
    if (stored) {
      setShowChatBox(true);
      setShowChips(true);
    }
  }, []);

  // Title typing animation — starts on mount, restarts on language change
  useEffect(() => {
    const fullTitle = t("welcome.title");

    // On language switch after initial animation, just snap to full title
    if (titleTyped) {
      setHeroTitle(fullTitle);
      return;
    }

    let i = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const typeNext = () => {
      i++;
      setHeroTitle(fullTitle.slice(0, i));
      if (i < fullTitle.length) {
        timers.push(setTimeout(typeNext, 80));
      } else {
        // Done typing → show subtitle → hold 1s → collapse
        timers.push(setTimeout(() => {
          setShowSubtitle(true);
          setTitleTyped(true);
          timers.push(setTimeout(() => {
            setTitleCollapsed(true);
          }, 1000));
        }, 300));
      }
    };

    timers.push(setTimeout(typeNext, 100));
    return () => timers.forEach(clearTimeout);
  }, [language]); // eslint-disable-line react-hooks/exhaustive-deps

  // Typing animation cycling through sample questions
  const animatedQuestions = ANIMATED_QUESTION_KEYS.map((k) => t(k));
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
      const q = animatedQuestions[qIdx];
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
        qIdx = (qIdx + 1) % animatedQuestions.length;
        phase = "typing";
        timer = setTimeout(step, 60);
      }
    };

    timer = setTimeout(step, 500);
    return () => clearTimeout(timer);
  }, [inputFocused, query, language]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Staggered entrance: chat box → chips
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
        {/* Hero section — fills viewport, shrinks after title collapse */}
        <div className={`flex flex-col justify-center items-center w-full px-6 pb-8 transition-all duration-700 ${
          titleCollapsed ? "min-h-0 pt-8" : "min-h-[100dvh]"
        }`}>
          {/* Frosted card */}
          <div className="bg-surface-50/10 backdrop-blur-sm rounded-2xl p-6 md:p-8 max-w-2xl w-full shadow-lg border border-surface-300/50">
            {/* Collapsible title area */}
            <div
              className={`overflow-hidden transition-all duration-700 ease-in-out ${
                titleCollapsed ? "max-h-0 opacity-0 mb-0" : "max-h-40 opacity-100 mb-5"
              }`}
            >
              <div className="text-center">
                <h1 className="text-2xl md:text-4xl font-bold text-text-800 mb-1">
                  {titleTyped ? t("welcome.title") : heroTitle}
                  {!titleTyped && <span className="animate-pulse">|</span>}
                </h1>
                <p
                  className={`text-text-500 text-sm md:text-base transition-opacity duration-500 ${
                    showSubtitle ? "opacity-100" : "opacity-0"
                  }`}
                >
                  {t("welcome.subtitle")}
                </p>
              </div>
            </div>

            <VillageSelector
              onSelect={handleVillageSelect}
              onChangeRequest={() => setTitleCollapsed(false)}
            />
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
                {chipKeys.map((key, i) => (
                  <button
                    key={key}
                    onClick={() => navigateToChat(t(key))}
                    className="animate-chipBounceIn text-xs bg-surface-50/80 backdrop-blur-sm text-text-600 px-3 py-2 rounded-full border border-surface-300/60 hover:border-sage/40 hover:text-sage transition-colors"
                    style={{ animationDelay: `${i * 150}ms` }}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Scroll hint arrow */}
          {showEvents && !titleCollapsed && (
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
            {dateRangeCounts.all > 0 && (
              <div className="mt-2">
                <DateRangeTabs dateRange={dateRange} setDateRange={setDateRange} counts={dateRangeCounts} t={t} />
              </div>
            )}
          </div>
        </div>

        {/* Events — full page feed */}
        {showEvents && (
          <div className="w-full px-6 pb-12">
            <UpcomingEvents village={selectedVillage} dateRange={dateRange} setDateRange={setDateRange} onCountsChange={setDateRangeCounts} />
          </div>
        )}

        {/* Footer */}
        <footer className="w-full py-6 text-center space-y-1">
          <p className="text-xs text-text-400">Made with <span className="text-red-400">♥</span> in Great Neck</p>
          <div className="flex items-center justify-center gap-3 text-xs text-text-400">
            <a
              href="mailto:contact@askmura.com"
              className="hover:text-sage transition-colors"
            >
              contact@askmura.com
            </a>
            <span>·</span>
            <a href="/privacy/" className="hover:text-sage transition-colors">Privacy</a>
            <span>·</span>
            <a href="/terms/" className="hover:text-sage transition-colors">Terms</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
