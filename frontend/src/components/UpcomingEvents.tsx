"use client";

import { useEffect, useState } from "react";
import { getUpcomingEvents, type UpcomingEvent } from "@/lib/api";
import { useLanguage } from "@/components/LanguageProvider";

const CATEGORIES: { key: string; emoji: string; label: string }[] = [
  { key: "school", emoji: "🏫", label: "School" },
  { key: "student", emoji: "🎒", label: "Student" },
  { key: "kids", emoji: "🧒", label: "Kids" },
  { key: "teens", emoji: "🧑‍💻", label: "Teens" },
  { key: "family", emoji: "👨‍👩‍👧", label: "Family" },
  { key: "art", emoji: "🎨", label: "Art" },
  { key: "entertainment", emoji: "🎭", label: "Entertainment" },
  { key: "food", emoji: "🍽", label: "Food" },
  { key: "festival", emoji: "🎪", label: "Festival" },
  { key: "health", emoji: "💪", label: "Health" },
  { key: "education", emoji: "📚", label: "Education" },
  { key: "community", emoji: "🤝", label: "Community" },
  { key: "general", emoji: "📌", label: "Event" },
];

const CATEGORY_MAP: Record<string, { emoji: string; label: string }> = {};
for (const c of CATEGORIES) CATEGORY_MAP[c.key] = c;

const SOURCE_LABELS: Record<string, string> = {
  patch: "Patch",
  longisland: "LI Events",
  eventbrite: "Eventbrite",
  islandnow: "Island Now",
  library: "GN Library",
  school: "GN Schools",
  village: "Village",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (d.getTime() === today.getTime()) return "Today";
  if (d.getTime() === tomorrow.getTime()) return "Tomorrow";

  const weekday = WEEKDAYS[d.getDay()];
  const month = MONTHS[d.getMonth()];
  return `${weekday}, ${month} ${d.getDate()}`;
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

interface Props {
  village: string;
}

export default function UpcomingEvents({ village }: Props) {
  const { t } = useLanguage();
  const [events, setEvents] = useState<UpcomingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!village) {
      setEvents([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setActiveFilter(null);
    setSourceFilter(null);

    getUpcomingEvents(village, 30)
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
  }, [village]);

  if (loading) {
    return (
      <div className="w-full max-w-2xl mt-3 animate-fadeSlideUp">
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

  // Determine which categories and sources are actually present
  const presentCategories = new Set(events.map((e) => e.category));
  const availableFilters = CATEGORIES.filter((c) => presentCategories.has(c.key));

  const presentSources = new Set(events.map((e) => e.source));
  const SOURCE_FILTERS: { key: string; emoji: string; label: string }[] = [
    { key: "library", emoji: "📖", label: "Library" },
    { key: "school", emoji: "🏫", label: "Schools" },
    { key: "village", emoji: "🏘", label: "Village" },
    { key: "patch", emoji: "📰", label: "Patch" },
    { key: "longisland", emoji: "🏝", label: "Long Island" },
    { key: "eventbrite", emoji: "🎫", label: "Eventbrite" },
  ];
  const availableSources = SOURCE_FILTERS.filter((s) => presentSources.has(s.key));

  // Apply filters
  let filtered = events;
  if (activeFilter) filtered = filtered.filter((e) => e.category === activeFilter);
  if (sourceFilter) filtered = filtered.filter((e) => e.source === sourceFilter);

  // Group by date
  const grouped: Record<string, UpcomingEvent[]> = {};
  for (const event of filtered) {
    const label = formatDateLabel(event.event_date);
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(event);
  }

  return (
    <div className="w-full max-w-2xl mt-3 animate-fadeSlideUp">
      <h3 className="text-xs font-semibold text-text-500 uppercase tracking-wider mb-2 px-1">
        {t("events.upcoming")}
      </h3>

      {/* Filter chips */}
      {availableFilters.length > 1 && (
        <div className="flex flex-wrap gap-1.5 pb-2 px-0.5">
          <button
            onClick={() => setActiveFilter(null)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              activeFilter === null
                ? "bg-sage text-white border-sage"
                : "bg-surface-50/80 text-text-600 border-surface-300/60 hover:border-sage/40"
            }`}
          >
            All
          </button>
          {availableFilters.map((cat) => (
            <button
              key={cat.key}
              onClick={() =>
                setActiveFilter(activeFilter === cat.key ? null : cat.key)
              }
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                activeFilter === cat.key
                  ? "bg-sage text-white border-sage"
                  : "bg-surface-50/80 text-text-600 border-surface-300/60 hover:border-sage/40"
              }`}
            >
              {cat.emoji} {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Source filter chips */}
      {availableSources.length > 1 && (
        <div className="flex flex-wrap gap-1.5 pb-2 px-0.5">
          {availableSources.map((src) => (
            <button
              key={src.key}
              onClick={() =>
                setSourceFilter(sourceFilter === src.key ? null : src.key)
              }
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                sourceFilter === src.key
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
          No events in this category
        </p>
      ) : (
        <div className="space-y-1.5 max-h-[320px] overflow-y-auto scrollbar-hide pr-1">
          {Object.entries(grouped).map(([dateLabel, dateEvents]) => (
            <div key={dateLabel}>
              <div className="sticky top-0 z-10 bg-surface-100/90 backdrop-blur-sm py-1 px-1">
                <span className="text-xs font-semibold text-sage">
                  {dateLabel}
                </span>
              </div>

              <div className="space-y-1.5">
                {dateEvents.map((event) => {
                  const cat =
                    CATEGORY_MAP[event.category] || CATEGORY_MAP.general;
                  return (
                    <a
                      key={`${event.source}-${event.id}`}
                      href={event.url || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-surface-50/80 backdrop-blur-sm rounded-xl border border-surface-300/50 px-4 py-3 hover:border-sage/40 hover:shadow-md transition-all duration-200 group cursor-pointer"
                    >
                      {/* Top row */}
                      <div className="flex items-center gap-2 mb-1 text-xs">
                        {event.event_time && (
                          <span className="text-text-600 font-medium">
                            {event.event_time}
                          </span>
                        )}
                        <span className="text-text-500 bg-surface-200/80 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                          <span>{cat.emoji}</span>
                          {cat.label}
                        </span>
                        <span className="ml-auto text-text-400">
                          {SOURCE_LABELS[event.source] || event.source}
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
                    </a>
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
