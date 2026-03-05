"use client";

import { useLanguage } from "./LanguageProvider";

export default function LanguageToggle() {
  const { language, toggleLanguage } = useLanguage();

  return (
    <button
      onClick={toggleLanguage}
      className="flex items-center gap-1 text-sm text-text-500 hover:text-text-800 transition-colors"
      title={language === "en" ? "Switch to Chinese" : "切换为英文"}
      aria-label={language === "en" ? "Switch to Chinese" : "Switch to English"}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
        />
      </svg>
      <span className="hidden sm:inline text-xs">
        {language === "en" ? "中文" : "EN"}
      </span>
    </button>
  );
}
