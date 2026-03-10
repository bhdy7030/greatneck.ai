"use client";

import { useLanguage } from "@/components/LanguageProvider";
import type { RawGuideData, BilingualText } from "@/lib/api";

const ICONS: Record<string, string> = {
  home: "\u{1F3E0}",
  snowflake: "\u{2744}\u{FE0F}",
  flower: "\u{1F338}",
  sun: "\u{2600}\u{FE0F}",
  leaf: "\u{1F342}",
  star: "\u{2B50}",
  briefcase: "\u{1F4BC}",
  heart: "\u{2764}\u{FE0F}",
  book: "\u{1F4D6}",
  tools: "\u{1F6E0}\u{FE0F}",
};

function loc(obj: BilingualText | string | undefined, lang: string): string {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  return obj[lang as "en" | "zh"] || obj.en || "";
}

interface GuidePreviewProps {
  guide: RawGuideData;
}

export default function GuidePreview({ guide }: GuidePreviewProps) {
  const { language } = useLanguage();
  const emoji = ICONS[guide.icon] || "\u{1F4CB}";

  return (
    <div className="rounded-2xl overflow-hidden bg-surface-50 border border-surface-200">
      {/* Hero */}
      <div
        className="p-5 text-white"
        style={{
          background: `linear-gradient(160deg, ${guide.color}ee 0%, ${guide.color}bb 50%, ${guide.color}88 100%)`,
        }}
      >
        <div className="flex items-start gap-3">
          <span className="text-4xl">{emoji}</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold leading-tight">
              {loc(guide.title, language)}
            </h2>
            <p className="text-xs text-white/80 mt-1">
              {loc(guide.description, language)}
            </p>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="p-4 space-y-3">
        <p className="text-[10px] font-semibold text-text-500 uppercase tracking-wider">
          {guide.steps.length} steps
        </p>
        {guide.steps.map((step, i) => (
          <div key={step.id || i} className="flex items-start gap-3">
            <span
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ backgroundColor: guide.color }}
            >
              {i + 1}
            </span>
            <div className="flex-1 min-w-0 pt-0.5">
              <p className="text-sm font-medium text-text-900 leading-snug">
                {loc(step.title, language)}
              </p>
              <p className="text-xs text-text-500 mt-0.5 line-clamp-2">
                {loc(step.description, language)}
              </p>
              {step.priority === "high" && (
                <span className="inline-block mt-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                  High priority
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
