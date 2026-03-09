"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getUpcomingEvents, type UpcomingEvent } from "@/lib/api";
import { useLanguage } from "@/components/LanguageProvider";

const CATEGORY_KEYS = [
  "school", "student", "kids", "teens", "family", "art",
  "entertainment", "food", "festival", "health", "education",
  "community", "general",
] as const;

const CATEGORY_EMOJIS: Record<string, string> = {
  school: "🏫", student: "🎒", kids: "🧒", teens: "🧑‍💻",
  family: "👨‍👩‍👧", art: "🎨", entertainment: "🎭", food: "🍽",
  festival: "🎪", health: "💪", education: "📚", community: "🤝",
  general: "📌",
};

// Grouped categories for the 2x2 filter grid
const CATEGORY_GROUPS: { key: string; emoji: string; members: string[] }[] = [
  { key: "family", emoji: "👨‍👩‍👧", members: ["kids", "teens", "family"] },
  { key: "education", emoji: "📚", members: ["school", "student", "education"] },
  { key: "entertainment", emoji: "🎨", members: ["art", "entertainment", "festival", "food"] },
  { key: "community", emoji: "🤝", members: ["health", "community", "general"] },
];

const SOURCE_FILTER_KEYS = [
  { key: "library", emoji: "📖" },
  { key: "school", emoji: "🏫" },
  { key: "village", emoji: "🏘" },
  { key: "other", emoji: "📰" },
  { key: "parkdistrict", emoji: "🌳" },
] as const;

function parseLocalDate(dateStr: string): Date {
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateLabel(dateStr: string, t: (key: string) => string): string {
  const d = parseLocalDate(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (d.getTime() === today.getTime()) return t("events.date.today");
  if (d.getTime() === tomorrow.getTime()) return t("events.date.tomorrow");

  const weekday = t(`events.weekday.${d.getDay()}`);
  const month = t(`events.month.${d.getMonth()}`);
  return `${weekday}, ${month} ${d.getDate()}`;
}

/** Parse "7:00 PM" / "10:30 AM" → minutes since midnight, or null. */
function parseTimeToMinutes(timeStr: string): number | null {
  const m = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const period = m[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/** Is this event's time more than 1 hour in the past? */
function isEventPast(event: { event_date: string; event_time: string }): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDate = parseLocalDate(event.event_date);
  if (eventDate.getTime() !== today.getTime()) return false;
  if (!event.event_time) return false;
  const eventMin = parseTimeToMinutes(event.event_time);
  if (eventMin === null) return false;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return eventMin < nowMin - 60;
}

type DateRange = "today" | "tomorrow" | "weekend" | "all";

function filterByDateRange(events: UpcomingEvent[], range: DateRange): UpcomingEvent[] {
  if (range === "all") return events;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (range === "today") {
    return events.filter((e) => parseLocalDate(e.event_date).getTime() === today.getTime());
  }

  if (range === "tomorrow") {
    const tmrw = new Date(today);
    tmrw.setDate(tmrw.getDate() + 1);
    return events.filter((e) => parseLocalDate(e.event_date).getTime() === tmrw.getTime());
  }

  // weekend: this Saturday & Sunday
  const dayOfWeek = today.getDay(); // 0=Sun, 6=Sat
  const sat = new Date(today);
  sat.setDate(sat.getDate() + (6 - dayOfWeek));
  const sun = new Date(sat);
  sun.setDate(sun.getDate() + 1);
  return events.filter((e) => {
    const t = parseLocalDate(e.event_date).getTime();
    return t === sat.getTime() || t === sun.getTime();
  });
}

function SkeletonCard() {
  return (
    <div className="bg-surface-50/80 backdrop-blur-sm rounded-xl border border-surface-300/50 p-4 animate-pulse">
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="h-4 bg-surface-300/50 rounded w-16" />
          <div className="h-4 bg-surface-300/50 rounded w-20" />
        </div>
        <div className="h-4 bg-surface-300/50 rounded w-5/6" />
        <div className="h-3 bg-surface-300/50 rounded w-full" />
      </div>
    </div>
  );
}

export type { DateRange };

export function DateRangeTabs({
  dateRange,
  setDateRange,
  counts,
  t,
}: {
  dateRange: DateRange;
  setDateRange: (r: DateRange) => void;
  counts: Record<DateRange, number>;
  t: (key: string) => string;
}) {
  return (
    <div className="flex gap-1 px-0.5">
      {(["all", "today", "tomorrow", "weekend"] as DateRange[]).map((range) => (
        <button
          key={range}
          onClick={() => setDateRange(range)}
          className={`text-xs px-3 py-2 rounded-lg font-medium transition-all flex items-center gap-1 ${
            dateRange === range
              ? "bg-sage text-white shadow-sm"
              : "text-text-500 hover:bg-surface-200/80"
          }`}
        >
          {t(`events.range.${range}`)}
          {counts[range] > 0 && (
            <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold tabular-nums ${
              dateRange === range
                ? "bg-white/25 text-white"
                : "bg-surface-300/50 text-text-500"
            }`}>
              {counts[range]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

interface Props {
  village: string;
  dateRange: DateRange;
  setDateRange: (r: DateRange) => void;
  onCountsChange?: (counts: Record<DateRange, number>) => void;
}

export default function UpcomingEvents({ village, dateRange, setDateRange, onCountsChange }: Props) {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [sourceFilters, setSourceFilters] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setActiveFilter(null);
    setSourceFilters(new Set());
    setDateRange("all");

    getUpcomingEvents(village || "", 30, language)
      .then((data) => {
        if (!cancelled) setEvents(data);
      })
      .catch((err) => {
        console.warn("Failed to fetch events:", err);
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [village, language]);

  // Compute date range counts
  const dateRangeCounts = useMemo<Record<DateRange, number>>(() => ({
    all: events.length,
    today: filterByDateRange(events, "today").length,
    tomorrow: filterByDateRange(events, "tomorrow").length,
    weekend: filterByDateRange(events, "weekend").length,
  }), [events]);

  // Report counts to parent for sticky tabs
  useEffect(() => {
    onCountsChange?.(dateRangeCounts);
  }, [dateRangeCounts, onCountsChange]);

  if (loading) {
    return (
      <div className="w-full max-w-2xl mx-auto mt-3 animate-fadeSlideUp">
        <h3 className="text-xs font-semibold text-text-500 uppercase tracking-wider mb-2 px-1">
          {t("events.upcoming")}
        </h3>
        <div className="space-y-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return null;
  }

  // Determine which category groups and sources are actually present
  const presentCategories = new Set(events.map((e) => e.category));
  const availableGroups = CATEGORY_GROUPS
    .filter((g) => g.members.some((m) => presentCategories.has(m)))
    .map((g) => ({ ...g, label: t(`events.cat.${g.key}`) }));

  const presentSources = new Set(events.map((e) => e.source));
  const namedSources: Set<string> = new Set(SOURCE_FILTER_KEYS.filter((s) => s.key !== "other").map((s) => s.key));
  const hasOther = events.some((e) => !namedSources.has(e.source));
  const availableSources = SOURCE_FILTER_KEYS
    .filter((s) => s.key === "other" ? hasOther : presentSources.has(s.key))
    .map((s) => ({ ...s, label: t(`events.filter.${s.key}`) }));

  // Resolve active filter to its member categories
  const activeGroup = activeFilter
    ? CATEGORY_GROUPS.find((g) => g.key === activeFilter)
    : null;
  const activeMembers = activeGroup ? new Set(activeGroup.members) : null;

  // Apply filters
  let filtered = filterByDateRange(events, dateRange);
  if (activeMembers) filtered = filtered.filter((e) => activeMembers.has(e.category));
  if (sourceFilters.size > 0) {
    filtered = filtered.filter((e) =>
      sourceFilters.has(e.source) || (sourceFilters.has("other") && !namedSources.has(e.source))
    );
  }

  // Group by date
  const grouped: Record<string, UpcomingEvent[]> = {};
  for (const event of filtered) {
    const label = formatDateLabel(event.event_date, t);
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(event);
  }

  return (
    <div className="w-full max-w-2xl mx-auto mt-3 animate-fadeSlideUp">
      <h3 className="text-xs font-semibold text-text-500 uppercase tracking-wider mb-2 px-1">
        {t("events.upcoming")}
      </h3>

      {/* Date range tabs (inline, always visible here) */}
      <div className="mb-2">
        <DateRangeTabs dateRange={dateRange} setDateRange={setDateRange} counts={dateRangeCounts} t={t} />
      </div>

      {/* Category grid */}
      {availableGroups.length > 1 && (
        <div className="grid grid-cols-2 gap-1.5 mb-2.5 px-0.5">
          {availableGroups.map((group) => {
            const memberSet = new Set(group.members);
            const count = filterByDateRange(events, dateRange).filter(
              (e) => memberSet.has(e.category)
            ).length;
            const isActive = activeFilter === group.key;
            return (
              <button
                key={group.key}
                onClick={() =>
                  setActiveFilter(isActive ? null : group.key)
                }
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl border transition-all text-left ${
                  isActive
                    ? "bg-sage/10 border-sage/50 shadow-sm"
                    : "bg-surface-50/80 border-surface-300/40 hover:border-sage/30"
                }`}
              >
                <span className="text-base leading-none">{group.emoji}</span>
                <span className={`text-xs font-medium truncate ${
                  isActive ? "text-sage" : "text-text-600"
                }`}>
                  {group.label}
                </span>
                <span className={`ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold tabular-nums ${
                  isActive
                    ? "bg-sage/20 text-sage"
                    : "bg-surface-300/50 text-text-500"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Source filter chips */}
      {availableSources.length > 1 && (
        <div className="flex flex-wrap gap-1.5 pb-2 px-0.5">
          {availableSources.map((src) => (
            <button
              key={src.key}
              onClick={() => {
                setSourceFilters((prev) => {
                  const next = new Set(prev);
                  if (next.has(src.key)) next.delete(src.key);
                  else next.add(src.key);
                  return next;
                });
              }}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                sourceFilters.has(src.key)
                  ? "bg-gold text-white border-gold"
                  : "bg-surface-50/80 text-text-600 border-surface-300/60 hover:border-gold/40"
              }`}
            >
              {src.emoji} {src.label}
            </button>
          ))}
        </div>
      )}

      {/* Events feed */}
      {filtered.length === 0 ? (
        <p className="text-xs text-text-500 text-center py-4">
          {t("events.noEvents")}
        </p>
      ) : (
        <div className="space-y-1.5 pr-1">
          {Object.entries(grouped).map(([dateLabel, dateEvents]) => (
            <div key={dateLabel}>
              <div className="sticky top-0 z-10 bg-surface-100/90 backdrop-blur-sm py-1 px-1">
                <span className="text-xs font-semibold text-sage">
                  {dateLabel}
                </span>
              </div>

              <div className="space-y-1.5">
                {dateEvents.map((event, idx) => {
                  const past = isEventPast(event);
                  const prevPast = idx > 0 ? isEventPast(dateEvents[idx - 1]) : false;
                  const showNowLine = !past && (idx === 0 ? false : prevPast);
                  const catEmoji = CATEGORY_EMOJIS[event.category] || CATEGORY_EMOJIS.general;
                  const catLabel = t(`events.cat.${event.category in CATEGORY_EMOJIS ? event.category : "general"}`);
                  const handleEventClick = () => {
                    localStorage.setItem("gn_event_context", JSON.stringify(event));
                    localStorage.setItem("gn_fast_mode", "true");
                    router.push("/chat/");
                  };
                  return (
                    <div key={`${event.source}-${event.id}`}>
                      {showNowLine && (
                        <div className="flex items-center gap-2 py-1.5 px-1">
                          <div className="w-2 h-2 rounded-full bg-red-400 shadow-sm shadow-red-400/50" />
                          <div className="flex-1 h-px bg-red-400/40" />
                          <span className="text-[10px] font-medium text-red-400 uppercase tracking-wider">
                            {t("events.now")}
                          </span>
                          <div className="flex-1 h-px bg-red-400/40" />
                        </div>
                      )}
                      <div
                        onClick={handleEventClick}
                        className={`block bg-surface-50 rounded-xl border border-surface-300/50 px-4 py-3 hover:border-sage/40 hover:shadow-md transition-all duration-200 group cursor-pointer ${
                          past ? "opacity-40" : ""
                        }`}
                      >
                      {/* Top row */}
                      <div className="flex items-center gap-2 mb-1 text-xs">
                        {event.event_time && (
                          <span className="text-text-600 font-medium">
                            {event.event_time}
                          </span>
                        )}
                        <span className="text-text-500 bg-surface-200/80 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                          <span>{catEmoji}</span>
                          {catLabel}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5 text-text-400">
                          {t(`events.src.${event.source}`)}
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
                        </span>
                      </div>

                      {/* Title */}
                      <h4 className="text-sm font-semibold text-text-800 group-hover:text-sage transition-colors leading-snug">
                        {event.title}
                      </h4>

                      {/* Description */}
                      {event.description && (
                        <p className="text-xs text-text-600 line-clamp-2 leading-relaxed mt-0.5">
                          {event.description}
                        </p>
                      )}

                      {/* Venue */}
                      {event.venue && (
                        <div className="flex items-center gap-1 mt-1">
                          <svg
                            className="w-3 h-3 text-text-500 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                          </svg>
                          <span className="text-xs text-text-500 truncate">
                            {event.venue}
                          </span>
                        </div>
                      )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
