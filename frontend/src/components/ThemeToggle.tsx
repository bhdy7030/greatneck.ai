"use client";

import { useTheme } from "./ThemeProvider";
import { useLanguage } from "./LanguageProvider";

const icons: Record<string, JSX.Element> = {
  light: (
    // Sun
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 3v1m0 16v1m8.66-13.66l-.71.71M4.05 19.95l-.71.71M21 12h-1M4 12H3m16.66 7.66l-.71-.71M4.05 4.05l-.71-.71M16 12a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
  ),
  dark: (
    // Moon
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
      />
    </svg>
  ),
  classic: (
    // Leaf
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M5 3c7 0 14 4 14 12a5 5 0 01-5 5C7 20 3 13 3 6a3 3 0 012-3zm0 0c0 0 4 4 12 5"
      />
    </svg>
  ),
};

const labelKeys: Record<string, string> = {
  light: "theme.light",
  dark: "theme.dark",
  classic: "theme.classic",
};

export default function ThemeToggle() {
  const { theme, cycleTheme } = useTheme();
  const { t } = useLanguage();
  const label = t(labelKeys[theme]);

  return (
    <button
      onClick={cycleTheme}
      className="flex items-center gap-1.5 text-sm text-text-500 hover:text-text-800 transition-colors"
      title={`Theme: ${label}`}
      aria-label={`Switch theme (current: ${label})`}
    >
      {icons[theme]}
      <span className="hidden sm:inline text-xs">{label}</span>
    </button>
  );
}
