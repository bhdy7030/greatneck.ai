"use client";

import { useState, useRef, useEffect } from "react";
import { useTheme } from "./ThemeProvider";
import { useLanguage } from "./LanguageProvider";

/** Swatch colors for each theme (CSS rgb values for the primary accent) */
const swatches: Record<string, string> = {
  light:    "rgb(20,184,166)",    // teal
  classic:  "rgb(130,155,113)",   // olive
  ocean:    "rgb(59,130,246)",    // blue
  hamptons: "rgb(25,55,125)",     // navy
  coral:    "rgb(255,90,95)",     // coral
  nord:     "rgb(94,129,172)",    // steel blue
  sage:     "rgb(58,130,110)",    // muted green
};

const labelKeys: Record<string, string> = {
  light:    "theme.light",
  classic:  "theme.classic",
  ocean:    "theme.ocean",
  hamptons: "theme.hamptons",
  coral:    "theme.coral",
  nord:     "theme.nord",
  sage:     "theme.sage",
};

const themeOrder = ["light", "classic", "ocean", "hamptons", "coral", "nord", "sage"];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* Trigger button — shows current theme swatch */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm text-text-500 hover:text-text-800 transition-colors"
        title={t(labelKeys[theme])}
        aria-label={`Theme: ${t(labelKeys[theme])}`}
      >
        <span
          className="w-4 h-4 rounded-full border border-surface-400"
          style={{ backgroundColor: swatches[theme] }}
        />
        <span className="hidden sm:inline text-xs">{t(labelKeys[theme])}</span>
        <svg className="w-3 h-3 text-text-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-40 bg-surface-50 border border-surface-300 rounded-xl shadow-lg py-1.5 z-50">
          {themeOrder.map((t_key) => (
            <button
              key={t_key}
              onClick={() => {
                setTheme(t_key as typeof theme);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors ${
                t_key === theme
                  ? "text-text-900 bg-surface-200"
                  : "text-text-700 hover:bg-surface-200"
              }`}
            >
              <span
                className="w-3.5 h-3.5 rounded-full flex-shrink-0 border border-surface-400"
                style={{ backgroundColor: swatches[t_key] }}
              />
              <span className="truncate">{t(labelKeys[t_key])}</span>
              {t_key === theme && (
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
