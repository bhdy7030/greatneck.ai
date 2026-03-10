"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "./LanguageProvider";
import { getGuides, type Guide } from "@/lib/api";

export default function GuidesTeaser() {
  const { language, t } = useLanguage();
  const [guides, setGuides] = useState<Guide[]>([]);

  useEffect(() => {
    const village = localStorage.getItem("gn_village") || "";
    getGuides(village, language)
      .then((all) => {
        // Show max 2: seasonal first, then onboarding
        const sorted = [...all].sort((a, b) => {
          if (a.type === "seasonal" && b.type !== "seasonal") return -1;
          if (a.type !== "seasonal" && b.type === "seasonal") return 1;
          return 0;
        });
        setGuides(sorted.slice(0, 2));
      })
      .catch(() => {});
  }, [language]);

  if (guides.length === 0) return null;

  const ICONS: Record<string, string> = {
    home: "\u{1F3E0}", snowflake: "\u{2744}\u{FE0F}", flower: "\u{1F338}", sun: "\u{2600}\u{FE0F}", leaf: "\u{1F342}",
  };

  return (
    <div className="max-w-2xl mx-auto mb-8">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-xs font-semibold text-text-700 uppercase tracking-wider">
          {t("guides.teaserTitle")}
        </h3>
        <a href="/guides/" className="text-[10px] text-sage hover:text-sage-dark transition-colors">
          {t("guides.viewAll")} →
        </a>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {guides.map((guide) => (
          <a
            key={guide.id}
            href="/guides/"
            className="flex items-center gap-3 bg-surface-50/80 backdrop-blur-sm border border-surface-300/60 rounded-lg px-3 py-2.5 hover:border-sage/40 transition-colors"
          >
            <span className="text-lg">{ICONS[guide.icon] || "\u{1F4CB}"}</span>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-semibold text-text-900 truncate">{guide.title}</h4>
              <p className="text-[10px] text-text-500 truncate">{guide.description}</p>
            </div>
            <svg className="w-4 h-4 text-text-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
        ))}
      </div>
    </div>
  );
}
