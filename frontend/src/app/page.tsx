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

  const chipKeys = useMemo(() => {
    const shuffled = [...ANIMATED_QUESTION_KEYS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 6);
  }, []);

  const [hasVillage, setHasVillage] = useState(false);
  const [selectedVillage, setSelectedVillage] = useState("");
  const [showEvents, setShowEvents] = useState(false);
  const [showChatBox, setShowChatBox] = useState(false);
  const [showChips, setShowChips] = useState(false);
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState("");
  const [inputFocused, setInputFocused] = useState(false);

  const [landingGuides, setLandingGuides] = useState<Guide[]>([]);
  const [walletGuidesLanding, setWalletGuidesLanding] = useState<Guide[]>([]);
  const [playbookTab, setPlaybookTab] = useState<"mine" | "explore">("explore");

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
    Promise.all([
      getGuides(stored, language),
      getWalletGuides(stored, language),
    ]).then(([guides, wallet]) => {
      setLandingGuides(guides.slice(0, 6));
      setWalletGuidesLanding(wallet.slice(0, 6));
      if (wallet.length > 0) setPlaybookTab("mine");
    }).catch(() => {});
  }, [language]);

  useEffect(() => {
    const fullTitle = t("welcome.title");
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
    setTimeout(() => setShowChatBox(true), 200);
    setTimeout(() => setShowChips(true), 600);
    setTimeout(() => {
      setVillageCollapsed(true);
      setTitleCollapsed(true);
    }, 800);
  };

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
    if (q) localStorage.setItem("gn_draft", q);
    setTimeout(() => router.push("/chat/"), 150);
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
      {/* Background — subtle map texture + ambient glow */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-surface-100" />
        <div className="absolute inset-0 opacity-[0.035] pointer-events-none">
          <GreatNeckMap />
        </div>
        <div className="absolute top-[-8%] left-[15%] w-[65vw] h-[55vh] bg-sage/[0.07] rounded-full blur-[130px] pointer-events-none" />
        <div className="absolute bottom-[8%] right-[8%] w-[45vw] h-[40vh] bg-gold/[0.05] rounded-full blur-[110px] pointer-events-none" />
      </div>

      {/* Scrollable content */}
      <div className="relative z-10 flex flex-col items-center will-change-transform w-full max-w-2xl mx-auto">

        {/* ── Hero section ── */}
        <div className={`flex flex-col items-center w-full transition-all duration-700 ${
          titleCollapsed ? "min-h-0 pt-2 pb-0" : "min-h-[100dvh] justify-center pb-16 px-6"
        }`}>
          {/* Title + village grid — hidden after collapse */}
          <div className={`w-full text-center transition-all duration-500 ${titleCollapsed ? "hidden" : ""}`}>
            <h1 className="font-semibold text-text-900 tracking-tight text-4xl md:text-[3.25rem] md:leading-[1.1]">
              {titleTyped ? t("welcome.title") : heroTitle}
              {!titleTyped && <span className="animate-pulse text-sage">|</span>}
            </h1>
            <p className={`text-text-500 font-light mt-3 text-base md:text-lg transition-opacity duration-500 ${titleTyped ? "opacity-100" : "opacity-0"}`}>
              {t("welcome.subtitle")}
            </p>

            {/* Village grid */}
            <div className={`overflow-hidden transition-all duration-500 ease-in-out ${
              villageCollapsed ? "max-h-0 opacity-0 mt-0" : "max-h-[280px] opacity-100 mt-8"
            }`}>
              <VillageSelector
                onSelect={handleVillageSelect}
                onChangeRequest={() => setTitleCollapsed(false)}
              />
            </div>
          </div>

          {/* Scroll hint */}
          {showEvents && !titleCollapsed && titleTyped && (
            <div className="mt-8 animate-arrowBounce text-sage/40">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
          )}
        </div>

        {/* Sentinel — detects when chat bar becomes pinned */}
        <div ref={stickysentinelRef} className="h-0 w-full" />

        {/* ── Sticky chat bar ── */}
        <div className={`sticky top-0 z-20 w-full px-4 py-3 transition-all duration-200 ${
          chatPinned ? "bg-surface-100/92 backdrop-blur-xl border-b border-surface-200/60" : ""
        }`}>
          {/* Card-style input (Claude/Gemini aesthetic) */}
          <div className={`flex flex-col bg-surface-50 rounded-2xl border border-surface-300/50 overflow-hidden transition-all duration-300 ${
            hasVillage
              ? "shadow-lg shadow-surface-400/10 landing-chat-glow"
              : "opacity-60 shadow-md shadow-surface-400/8"
          } ${showChatBox ? "animate-fadeSlideUp" : ""}`}>
            {/* Input row */}
            <div className="flex items-center gap-3 px-4 py-3.5">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder={inputFocused || query ? "" : (animatedPlaceholder || "Ask anything about Great Neck…")}
                disabled={!hasVillage}
                className="flex-1 bg-transparent text-text-800 focus:outline-none placeholder-text-400 disabled:cursor-not-allowed"
                style={{ fontSize: "max(16px, 0.9375rem)" }}
              />
            </div>

            {/* Toolbar row — village context + send */}
            <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
              <div className="flex items-center gap-1">
              {/* Camera — multimodal conversation */}
              {hasVillage && (
                <button
                  onClick={() => { localStorage.setItem("gn_multimodal", "1"); navigateToChat(); }}
                  className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-surface-200/60 transition-colors text-text-400 hover:text-text-700"
                  title="Start with an image"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              )}
              {hasVillage ? (
                <button
                  onClick={() => { setVillageCollapsed(false); setTitleCollapsed(false); }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-surface-200/60 transition-colors group"
                >
                  <svg className="w-3.5 h-3.5 text-sage" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-xs font-medium text-text-600 group-hover:text-sage transition-colors">{selectedVillage}</span>
                  <svg className="w-3 h-3 text-text-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              ) : (
                <span className="text-xs text-text-400 px-2.5 italic">Select your village above to get started</span>
              )}
              </div>
              <button
                onClick={() => navigateToChat()}
                disabled={!hasVillage}
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-sage text-white rounded-xl hover:bg-sage-dark transition-all duration-200 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Ask"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </div>

          {/* Quick chips — when not pinned and village is selected */}
          {showChips && !chatPinned && (
            <div className="mt-3">
              <div className="flex gap-2 overflow-x-auto scrollbar-hide py-0.5">
                {chipKeys.map((key, i) => (
                  <button
                    key={key}
                    onClick={() => navigateToChat(t(key))}
                    className="animate-chipBounceIn flex-shrink-0 text-[13px] bg-surface-50/80 backdrop-blur-sm text-text-600 px-3.5 py-2 rounded-xl border border-surface-300/50 hover:border-sage/40 hover:text-sage hover:bg-sage/5 transition-all duration-200 whitespace-nowrap hover:-translate-y-px"
                    style={{ animationDelay: `${i * 100}ms` }}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Date range tabs — when pinned and events exist */}
          {chatPinned && dateRangeCounts.all > 0 && (
            <div className="mt-2">
              <DateRangeTabs dateRange={dateRange} setDateRange={setDateRange} counts={dateRangeCounts} t={t} />
            </div>
          )}
        </div>

        {/* ── Playbooks ── */}
        {(landingGuides.length > 0 || walletGuidesLanding.length > 0) && showChatBox && (
          <div className="w-full animate-fadeSlideUp bg-surface-50/40 backdrop-blur-md border-y border-surface-200/60 px-4 py-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2.5">
                <h3 className="text-[11px] font-bold text-text-600 uppercase tracking-widest">
                  {t("nav.guides")}
                </h3>
                {walletGuidesLanding.length > 0 && (
                  <div className="flex items-center gap-0.5 text-[10px]">
                    <button
                      onClick={() => setPlaybookTab("mine")}
                      className={`px-2.5 py-1 rounded-full transition-all duration-200 ${
                        playbookTab === "mine" ? "bg-sage/15 text-sage font-semibold" : "text-text-400 hover:text-text-600"
                      }`}
                    >
                      {t("guides.tab.wallet")}
                    </button>
                    <button
                      onClick={() => setPlaybookTab("explore")}
                      className={`px-2.5 py-1 rounded-full transition-all duration-200 ${
                        playbookTab === "explore" ? "bg-sage/15 text-sage font-semibold" : "text-text-400 hover:text-text-600"
                      }`}
                    >
                      {t("guides.tab.browse")}
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => router.push(playbookTab === "mine" ? "/guides/?tab=wallet" : "/guides/")}
                className="text-[10px] font-medium text-sage hover:text-sage-dark transition-colors"
              >
                {t("landing.playbooks.seeAll")} →
              </button>
            </div>
            <p className="text-[11px] text-text-400 mb-3">
              {playbookTab === "mine" ? t("landing.playbooks.subtitleMine") : t("landing.playbooks.subtitleExplore")}
            </p>
            <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide">
              {(playbookTab === "mine" && walletGuidesLanding.length > 0 ? walletGuidesLanding : landingGuides).map((guide, i) => (
                <div
                  key={guide.id}
                  onClick={() => router.push(playbookTab === "mine" ? `/guides/?open=${guide.id}&tab=wallet` : `/guides/?id=${guide.id}&tab=browse`)}
                  className="flex-shrink-0 w-[132px] aspect-[3/4] flex flex-col rounded-xl overflow-hidden cursor-pointer select-none group animate-miniCardIn bg-surface-50/80 backdrop-blur-sm border border-surface-300/40 hover:border-sage/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:shadow-sage/5"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="h-[3px] w-full shrink-0" style={{ backgroundColor: guide.color }} />
                  <div className="flex items-center justify-center pt-4 pb-2 shrink-0 transition-transform duration-300 group-hover:scale-110">
                    <OpenMojiIcon icon={guide.icon} size={44} />
                  </div>
                  <div className="px-2.5 flex-1">
                    <p className="text-[11px] font-semibold text-text-800 leading-snug line-clamp-3">{guide.title}</p>
                  </div>
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
                </div>
              ))}
              <div
                onClick={() => router.push("/guides/create")}
                className="flex-shrink-0 w-[132px] aspect-[3/4] relative rounded-xl overflow-hidden cursor-pointer select-none group border border-dashed border-surface-300/50 hover:border-sage/30 transition-all duration-300 hover:-translate-y-1 animate-miniCardIn flex flex-col items-center justify-center gap-2 bg-surface-50/30 backdrop-blur-sm"
                style={{ animationDelay: `${Math.min(landingGuides.length * 80, 480)}ms` }}
              >
                <div className="w-8 h-8 rounded-full bg-surface-200/50 group-hover:bg-sage/10 flex items-center justify-center transition-all duration-200 group-hover:scale-110">
                  <svg className="w-4 h-4 text-text-400 group-hover:text-sage transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <p className="text-[10px] font-semibold text-text-400 group-hover:text-sage px-3 text-center leading-tight transition-colors">
                  {t("landing.playbooks.create")}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Events ── */}
        {showEvents && (
          <div className="w-full pb-12">
            <div className="w-full bg-surface-50/30 backdrop-blur-md border-y border-surface-200/60 px-4 py-5">
              <UpcomingEvents village={selectedVillage} dateRange={dateRange} setDateRange={setDateRange} onCountsChange={setDateRangeCounts} />
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <footer className="w-full py-8 text-center space-y-2">
          <p className="text-[11px] text-text-500 font-medium tracking-wide">Made with <span className="text-red-400/80">&#9829;</span> in Great Neck</p>
          <div className="flex items-center justify-center gap-3 text-[11px] text-text-400">
            <a href="mailto:contact@askmura.com" className="hover:text-sage transition-colors">contact@askmura.com</a>
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
