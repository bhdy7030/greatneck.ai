"use client";

import { useState, useRef, useEffect } from "react";
import { useLanguage } from "./LanguageProvider";

const languages = [
  { code: "en" as const, label: "English" },
  { code: "zh" as const, label: "中文" },
];

export default function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = languages.find((l) => l.code === language) ?? languages[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs font-medium text-text-500 hover:text-text-800 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center gap-1"
        aria-label="Change language"
      >
        {current.code === "en" ? "EN" : "中文"}
        <svg className="w-3 h-3 text-text-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-32 bg-surface-50 border border-surface-300 rounded-xl shadow-lg py-1.5 z-50">
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => {
                setLanguage(lang.code);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors ${
                lang.code === language
                  ? "text-text-900 bg-surface-200"
                  : "text-text-700 hover:bg-surface-200"
              }`}
            >
              <span className="truncate">{lang.label}</span>
              {lang.code === language && (
                <svg className="w-3.5 h-3.5 ml-auto flex-shrink-0 text-sage" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
