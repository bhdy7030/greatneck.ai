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
  "landing.q.propane",
];

export default function Home() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [query, setQuery] = useState("");
  const [transitioning, setTransitioning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const stickysentinelRef = useRef<HTMLDivElement>(null);
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
    // Fetch playbooks for landing section (parallel)
    Promise.all([
      getGuides(stored, language),
      getWalletGuides(stored, language),
    ]).then(([guides, wallet]) => {
      setLandingGuides(guides.slice(0, 6));
      setWalletGuidesLanding(wallet.slice(0, 6));
      if (wallet.length > 0) setPlaybookTab("mine");
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
        // Done typing → hold briefly → collapse
        timers.push(setTimeout(() => {
          setTitleTyped(true);
          timers.push(setTimeout(() => {
            setTitleCollapsed(true);
          }, 800));
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

  // Detect when chat bar becomes pinned (sentinel scrolls out of view)
  useEffect(() => {
    const el = stickysentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setChatPinned(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 50% 30%, rgba(var(--color-sage), 0.04) 0%, transparent 60%), linear-gradient(to top, rgb(var(--color-surface-100)) 0%, rgba(var(--color-surface-100), 0.85) 35%, rgba(var(--color-surface-100), 0.4) 70%, transparent 100%)",
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
          <div className={`w-full backdrop-blur-md border border-surface-300/40 transition-all duration-500 ${
            titleCollapsed
              ? "px-4 py-3 rounded-none border-x-0 bg-surface-50/20"
              : "px-6 py-6 md:px-8 md:py-8 rounded-2xl bg-surface-50/30 shadow-lg shadow-surface-400/10"
          }`}>
            {/* Slogan */}
            <div className="text-center">
              <h1 className={`font-bold text-text-900 transition-all duration-500 tracking-tight ${
                titleCollapsed ? "text-lg md:text-xl" : "text-3xl md:text-[2.75rem] md:leading-tight"
              }`}>
                {titleTyped ? t("welcome.title") : heroTitle}
                {!titleTyped && <span className="animate-pulse text-sage">|</span>}
              </h1>
              <p
                className={`text-text-600 transition-all duration-500 ${
                  titleTyped ? "opacity-100" : "opacity-0"
                } ${titleCollapsed ? "text-xs md:text-sm mt-0.5" : "text-sm md:text-base mt-2"}`}
              >
                {t("welcome.subtitle")}
              </p>
            </div>

            {/* Village grid — collapses after selection */}
            <div
              className={`overflow-hidden transition-all duration-500 ease-in-out ${
                villageCollapsed ? "max-h-0 opacity-0 mt-0" : "max-h-[250px] opacity-100 mt-5"
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

          {/* Scroll hint arrow */}
          {showEvents && !titleCollapsed && (
            <div className="mt-4 animate-arrowBounce text-sage/50">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
          )}
        </div>

        {/* Sentinel — when this scrolls out, the chat bar is "pinned" */}
        <div ref={stickysentinelRef} className="h-0 w-full" />

        {/* Sticky chat bar — single instance, pins to top on scroll */}
        <div className="sticky top-0 z-20 w-full bg-surface-100/85 backdrop-blur-lg px-3 py-2">
          <div
            className={`flex items-center gap-2.5 bg-surface-50/90 backdrop-blur-md rounded-2xl transition-all duration-300 px-4 py-3 ${
              hasVillage
                ? "border-2 border-sage/30 shadow-lg shadow-sage/8 landing-chat-glow"
                : "border border-surface-300 opacity-60"
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
              className="flex-1 bg-transparent text-text-800 text-sm focus:outline-none placeholder-text-500 disabled:cursor-not-allowed"
              style={{ fontSize: "max(16px, 0.875rem)" }}
            />
            <button
              onClick={() => navigateToChat()}
              disabled={!hasVillage}
              className="flex-shrink-0 p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center bg-sage text-white rounded-xl hover:bg-sage-dark transition-all duration-200 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
              title="Start chatting"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>

          {/* Quick chips — visible when NOT pinned */}
          {showChips && !chatPinned && (
            <div className="relative mt-2">
              <div className="flex gap-2 overflow-x-auto scrollbar-hide py-0.5">
                {chipKeys.map((key, i) => (
                  <button
                    key={key}
                    onClick={() => navigateToChat(t(key))}
                    className="animate-chipBounceIn flex-shrink-0 text-xs bg-surface-50/70 backdrop-blur-sm text-text-700 px-3.5 py-2 rounded-xl border border-surface-300/50 hover:border-sage/40 hover:text-sage hover:bg-sage/5 transition-all duration-200 whitespace-nowrap hover:-translate-y-px"
                    style={{ animationDelay: `${i * 100}ms` }}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Date range tabs — visible when pinned and events exist */}
          {chatPinned && dateRangeCounts.all > 0 && (
            <div className="mt-2">
              <DateRangeTabs dateRange={dateRange} setDateRange={setDateRange} counts={dateRangeCounts} t={t} />
            </div>
          )}
        </div>

        {/* Playbooks — outside hero, always visible */}
        {(landingGuides.length > 0 || walletGuidesLanding.length > 0) && showChatBox && (
          <div className="w-full animate-fadeSlideUp backdrop-blur-md bg-surface-50/20 border-y border-surface-300/40 px-4 py-4">
            {/* Section header */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2.5">
                <h3 className="text-[11px] font-bold text-text-700 uppercase tracking-widest">
                  {t("nav.guides")}
                </h3>
                {walletGuidesLanding.length > 0 && (
                  <div className="flex items-center gap-0.5 text-[10px]">
                    <button
                      onClick={() => setPlaybookTab("mine")}
                      className={`px-2.5 py-1 rounded-full transition-all duration-200 ${
                        playbookTab === "mine"
                          ? "bg-sage/15 text-sage font-semibold"
                          : "text-text-400 hover:text-text-600"
                      }`}
                    >
                      {t("guides.tab.wallet")}
                    </button>
                    <button
                      onClick={() => setPlaybookTab("explore")}
                      className={`px-2.5 py-1 rounded-full transition-all duration-200 ${
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
                className="text-[10px] font-medium text-sage hover:text-sage-dark transition-colors"
              >
                {t("landing.playbooks.seeAll")} &rarr;
              </a>
            </div>
            {/* Fun subtitle */}
            <p className="text-[11px] text-text-500 mb-3">
              {playbookTab === "mine"
                ? t("landing.playbooks.subtitleMine")
                : t("landing.playbooks.subtitleExplore")}
            </p>
            {/* Cards row */}
            <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide">
              {(playbookTab === "mine" && walletGuidesLanding.length > 0
                ? walletGuidesLanding
                : landingGuides
              ).map((guide, i) => (
                <a
                  key={guide.id}
                  href={playbookTab === "mine" ? `/guides/?open=${guide.id}&tab=wallet` : `/guides/?id=${guide.id}&tab=browse`}
                  className="flex-shrink-0 w-[132px] aspect-[3/4] flex flex-col rounded-xl overflow-hidden cursor-pointer select-none group animate-miniCardIn bg-surface-50/70 backdrop-blur-sm border border-surface-300/40 hover:border-sage/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:shadow-sage/5"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  {/* Color accent strip */}
                  <div
                    className="h-[3px] w-full shrink-0"
                    style={{ backgroundColor: guide.color }}
                  />
                  {/* Icon */}
                  <div className="flex items-center justify-center pt-4 pb-2 shrink-0 transition-transform duration-300 group-hover:scale-110">
                    <OpenMojiIcon icon={guide.icon} size={44} />
                  </div>
                  {/* Title */}
                  <div className="px-2.5 flex-1">
                    <p className="text-[11px] font-semibold text-text-800 leading-snug line-clamp-3">
                      {guide.title}
                    </p>
                  </div>
                  {/* Author + Progress — pinned to bottom */}
                  <div className="px-2.5 pb-2.5 shrink-0 space-y-1.5">
                    {guide.author_handle && (
                      <p className="text-[9px] text-text-400 truncate">from @{guide.author_handle}</p>
                    )}
                    {guide.total_count > 0 && (
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1 bg-surface-300/40 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${((playbookTab === "mine" ? guide.done_count : 0) / guide.total_count) * 100}%`,
                              backgroundColor: guide.color,
                            }}
                          />
                        </div>
                        <span className="text-[8px] text-text-500 tabular-nums">
                          {playbookTab === "mine" ? `${guide.done_count}/${guide.total_count}` : `${guide.total_count} steps`}
                        </span>
                      </div>
                    )}
                  </div>
                </a>
              ))}
              {/* Create card */}
              <a
                href="/guides/create"
                className="flex-shrink-0 w-[132px] aspect-[3/4] relative rounded-xl overflow-hidden cursor-pointer select-none group border border-dashed border-surface-300/50 hover:border-sage/30 transition-all duration-300 hover:-translate-y-1 animate-miniCardIn flex flex-col items-center justify-center gap-2 bg-surface-50/30 backdrop-blur-sm"
                style={{ animationDelay: `${Math.min((landingGuides.length) * 80, 480)}ms` }}
              >
                <div className="w-8 h-8 rounded-full bg-surface-200/50 group-hover:bg-sage/10 flex items-center justify-center transition-all duration-200 group-hover:scale-110">
                  <svg className="w-4 h-4 text-text-400 group-hover:text-sage transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <p className="text-[10px] font-semibold text-text-400 group-hover:text-sage px-3 text-center leading-tight transition-colors">
                  {t("landing.playbooks.create")}
                </p>
              </a>
            </div>
          </div>
        )}

        {/* Events */}
        {showEvents && (
          <div className="w-full pb-12">
            <div className="w-full backdrop-blur-md bg-surface-50/20 border-y border-surface-300/40 px-4 py-4">
              <UpcomingEvents village={selectedVillage} dateRange={dateRange} setDateRange={setDateRange} onCountsChange={setDateRangeCounts} />
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="w-full py-8 text-center space-y-2">
          <p className="text-[11px] text-text-500 font-medium tracking-wide">Made with <span className="text-red-400/80">&#9829;</span> in Great Neck</p>
          <div className="flex items-center justify-center gap-3 text-[11px] text-text-400">
            <a
              href="mailto:contact@askmura.com"
              className="hover:text-sage transition-colors"
            >
              contact@askmura.com
            </a>
            <span className="text-surface-300">&#183;</span>
            <a href="/privacy/" className="hover:text-sage transition-colors">Privacy</a>
            <span className="text-surface-300">&#183;</span>
            <a href="/terms/" className="hover:text-sage transition-colors">Terms</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
