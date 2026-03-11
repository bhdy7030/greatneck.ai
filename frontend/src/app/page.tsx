"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import GreatNeckMap from "@/components/GreatNeckMap";
import VillageSelector from "@/components/VillageSelector";
import UpcomingEvents, { DateRangeTabs, type DateRange } from "@/components/UpcomingEvents";
import { useLanguage } from "@/components/LanguageProvider";
import { getGuides, getWalletGuides, type Guide } from "@/lib/api";
import OpenMojiIcon from "@/components/OpenMojiIcon";

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

  // Pick random chips from the animated questions pool (stable per mount)
  const chipKeys = useMemo(() => {
    const shuffled = [...ANIMATED_QUESTION_KEYS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 6);
  }, []);

  // Check if village is already selected
  const [hasVillage, setHasVillage] = useState(false);
  const [selectedVillage, setSelectedVillage] = useState("");
  const [showEvents, setShowEvents] = useState(false);
  const [showChatBox, setShowChatBox] = useState(false);
  const [showChips, setShowChips] = useState(false);
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState("");
  const [inputFocused, setInputFocused] = useState(false);

  // Playbooks for landing section
  const [landingGuides, setLandingGuides] = useState<Guide[]>([]);
  const [walletGuidesLanding, setWalletGuidesLanding] = useState<Guide[]>([]);
  const [playbookTab, setPlaybookTab] = useState<"mine" | "explore">("explore");

  // Hero title typing animation
  const [heroTitle, setHeroTitle] = useState("");
  const [showSubtitle, setShowSubtitle] = useState(false);
  const [titleCollapsed, setTitleCollapsed] = useState(false);
  const [titleTyped, setTitleTyped] = useState(false);
  const [villageCollapsed, setVillageCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("gn_village") || "";
    setHasVillage(!!stored);
    setSelectedVillage(stored);
    setShowEvents(true);
    if (stored) {
      setShowChatBox(true);
      setShowChips(true);
      setVillageCollapsed(true);
      setTitleCollapsed(true);
      setTitleTyped(true);
    }
    // Fetch playbooks for landing section
    getGuides(stored, language).then((guides) => {
      setLandingGuides(guides.slice(0, 6));
    }).catch(() => {});
    getWalletGuides(stored, language).then((guides) => {
      setWalletGuidesLanding(guides.slice(0, 6));
      if (guides.length > 0) setPlaybookTab("mine");
    }).catch(() => {});
  }, [language]);

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
    // Staggered entrance: chat box → chips → collapse village grid + title
    setTimeout(() => setShowChatBox(true), 200);
    setTimeout(() => setShowChips(true), 600);
    setTimeout(() => {
      setVillageCollapsed(true);
      setTitleCollapsed(true);
    }, 800);
  };

  const navigateToChat = (text?: string) => {
    setTransitioning(true);
    const q = (text || query).trim();
    if (q) {
      localStorage.setItem("gn_draft", q);
    }
    // Short delay for exit animation to be visible, then navigate
    setTimeout(() => {
      router.push("/chat/");
    }, 150);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && query.trim()) {
      e.preventDefault();
      navigateToChat();
    }
  };

  return (
    <div
      className={`flex-1 relative overflow-y-auto ${
        transitioning ? "opacity-0 -translate-y-2 scale-[1.01]" : "opacity-100 translate-y-0 scale-100"
      }`}
      style={{ transition: "opacity 0.25s ease, transform 0.25s ease" }}
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
      <div className="relative z-10 flex flex-col items-center will-change-transform w-full max-w-xl mx-auto">
        {/* Hero section — fills viewport, shrinks after title collapse */}
        <div className={`flex flex-col items-center w-full transition-all duration-700 ${
          titleCollapsed ? "min-h-0 pt-2 pb-0" : "min-h-[100dvh] justify-center pb-8 px-3"
        }`}>
          {/* Frosted card — slogan always visible, village grid collapses inside */}
          <div className={`w-full bg-surface-50/10 backdrop-blur-sm border-y border-surface-300/50 transition-all duration-500 ${
            titleCollapsed ? "px-4 py-3" : "px-6 py-5 md:px-8 md:py-6"
          }`}>
            {/* Slogan */}
            <div className="text-center">
              <h1 className={`font-bold text-text-800 transition-all duration-500 ${
                titleCollapsed ? "text-lg md:text-xl" : "text-2xl md:text-4xl"
              }`}>
                {titleTyped ? t("welcome.title") : heroTitle}
                {!titleTyped && <span className="animate-pulse">|</span>}
              </h1>
              <p
                className={`text-text-500 transition-all duration-500 ${
                  showSubtitle ? "opacity-100" : "opacity-0"
                } ${titleCollapsed ? "text-xs md:text-sm" : "text-sm md:text-base"}`}
              >
                {t("welcome.subtitle")}
              </p>
            </div>

            {/* Village grid — collapses after selection */}
            <div
              className={`overflow-hidden transition-all duration-500 ease-in-out ${
                villageCollapsed ? "max-h-0 opacity-0 mt-0" : "max-h-[250px] opacity-100 mt-4"
              }`}
            >
              <VillageSelector
                onSelect={handleVillageSelect}
                onChangeRequest={() => setTitleCollapsed(false)}
              />
            </div>

            {/* Village banner — inline when grid is collapsed */}
            <div
              className={`overflow-hidden transition-all duration-500 ease-in-out ${
                villageCollapsed && hasVillage ? "max-h-12 opacity-100 mt-2" : "max-h-0 opacity-0 mt-0"
              }`}
            >
              <button
                onClick={() => {
                  setVillageCollapsed(false);
                  setTitleCollapsed(false);
                }}
                className="w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg hover:bg-surface-300/20 transition-all duration-200 group"
              >
                <svg className="w-3.5 h-3.5 text-sage" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-xs font-semibold text-text-700">{selectedVillage}</span>
                <svg className="w-3 h-3 text-text-400 group-hover:text-sage transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Chat input — in hero, centered */}
          <div ref={heroChatRef} className={`w-full px-3 ${showChatBox ? "mt-2" : "mt-6"}`}>
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

            {/* Quick chips — single scrollable row */}
            {showChips && (
              <div className="relative mt-2">
                <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                  {chipKeys.map((key, i) => (
                    <button
                      key={key}
                      onClick={() => navigateToChat(t(key))}
                      className="animate-chipBounceIn flex-shrink-0 text-xs bg-surface-50/80 backdrop-blur-sm text-text-600 px-3 py-1.5 rounded-full border border-surface-300/60 hover:border-sage/40 hover:text-sage transition-colors whitespace-nowrap"
                      style={{ animationDelay: `${i * 100}ms` }}
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* Scroll hint arrow */}
          {showEvents && !titleCollapsed && (
            <div className="mt-3 animate-arrowBounce text-text-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
          )}
        </div>

        {/* Playbooks — outside hero, always visible */}
        {(landingGuides.length > 0 || walletGuidesLanding.length > 0) && showChatBox && (
          <div className="w-full animate-fadeSlideUp bg-surface-50/10 backdrop-blur-sm border-y border-surface-300/50 px-4 py-3">
            {/* Section header */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-text-500 uppercase tracking-wider">
                  {t("nav.guides")}
                </h3>
                {walletGuidesLanding.length > 0 && (
                  <div className="flex items-center gap-0.5 text-[10px]">
                    <button
                      onClick={() => setPlaybookTab("mine")}
                      className={`px-2 py-0.5 rounded-full transition-colors ${
                        playbookTab === "mine"
                          ? "bg-sage/15 text-sage font-semibold"
                          : "text-text-400 hover:text-text-600"
                      }`}
                    >
                      {t("guides.tab.wallet")}
                    </button>
                    <button
                      onClick={() => setPlaybookTab("explore")}
                      className={`px-2 py-0.5 rounded-full transition-colors ${
                        playbookTab === "explore"
                          ? "bg-sage/15 text-sage font-semibold"
                          : "text-text-400 hover:text-text-600"
                      }`}
                    >
                      {t("guides.tab.browse")}
                    </button>
                  </div>
                )}
              </div>
              <a
                href={playbookTab === "mine" ? "/guides/?tab=wallet" : "/guides/"}
                className="text-[10px] text-sage hover:text-sage-dark transition-colors"
              >
                {t("landing.playbooks.seeAll")} &rarr;
              </a>
            </div>
            {/* Fun subtitle */}
            <p className="text-[11px] text-text-500 mb-2">
              {playbookTab === "mine"
                ? t("landing.playbooks.subtitleMine")
                : t("landing.playbooks.subtitleExplore")}
            </p>
            {/* Cards row */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {(playbookTab === "mine" && walletGuidesLanding.length > 0
                ? walletGuidesLanding
                : landingGuides
              ).map((guide, i) => (
                <a
                  key={guide.id}
                  href={playbookTab === "mine" ? "/guides/?tab=wallet" : "/guides/"}
                  className="flex-shrink-0 w-[96px] aspect-[3/4] flex flex-col rounded-lg overflow-hidden cursor-pointer select-none group animate-miniCardIn bg-surface-50/60 border border-surface-300/50 hover:border-surface-400 transition-all duration-200 hover:-translate-y-0.5"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  {/* Color accent strip */}
                  <div
                    className="h-[3px] w-full shrink-0"
                    style={{ backgroundColor: guide.color }}
                  />
                  {/* Icon */}
                  <div className="flex items-center justify-center pt-3 pb-1 shrink-0 transition-transform duration-200 group-hover:scale-110">
                    <OpenMojiIcon icon={guide.icon} size={32} />
                  </div>
                  {/* Title */}
                  <div className="px-2 flex-1">
                    <p className="text-[9px] font-semibold text-text-700 leading-tight line-clamp-3">
                      {guide.title}
                    </p>
                  </div>
                  {/* Progress — pinned to bottom */}
                  {guide.total_count > 0 && (
                    <div className="px-2 pb-1.5 shrink-0 flex items-center gap-1">
                      <div className="flex-1 h-1 bg-surface-300/50 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${((playbookTab === "mine" ? guide.done_count : 0) / guide.total_count) * 100}%`,
                            backgroundColor: guide.color,
                          }}
                        />
                      </div>
                      <span className="text-[7px] text-text-500 tabular-nums">
                        {playbookTab === "mine" ? `${guide.done_count}/${guide.total_count}` : `${guide.total_count} steps`}
                      </span>
                    </div>
                  )}
                </a>
              ))}
              {/* Create card */}
              <a
                href="/guides/create"
                className="flex-shrink-0 w-[96px] aspect-[3/4] relative rounded-lg overflow-hidden cursor-pointer select-none group border border-dashed border-surface-300/60 hover:border-sage/40 transition-all duration-200 hover:-translate-y-0.5 animate-miniCardIn flex flex-col items-center justify-center gap-1.5"
                style={{ animationDelay: `${Math.min((landingGuides.length) * 80, 480)}ms` }}
              >
                <div className="w-7 h-7 rounded-full bg-surface-200/60 group-hover:bg-sage/10 flex items-center justify-center transition-colors duration-200">
                  <svg className="w-3.5 h-3.5 text-text-500 group-hover:text-sage transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <p className="text-[9px] font-semibold text-text-500 group-hover:text-sage px-2 text-center leading-tight transition-colors">
                  {t("landing.playbooks.create")}
                </p>
              </a>
            </div>
          </div>
        )}

        {/* Pinned chat bar — appears when hero input scrolls away */}
        <div
          className={`sticky top-0 z-20 w-full bg-surface-100/90 backdrop-blur-md transition-all duration-200 ${
            chatPinned ? "opacity-100 px-4 py-2" : "opacity-0 max-h-0 overflow-hidden pointer-events-none"
          }`}
        >
          <div className="w-full">
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

        {/* Events — frosted card */}
        {showEvents && (
          <div className="w-full pb-12">
            <div className="w-full bg-surface-50/10 backdrop-blur-sm border-y border-surface-300/50 px-4 py-3">
              <UpcomingEvents village={selectedVillage} dateRange={dateRange} setDateRange={setDateRange} onCountsChange={setDateRangeCounts} />
            </div>
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
