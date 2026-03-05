"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import translations from "@/lib/translations";

type Language = "en" | "zh";

interface LanguageContextValue {
  language: Language;
  setLanguage: (l: Language) => void;
  toggleLanguage: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

const STORAGE_KEY = "gn_language";
const LANGUAGES: Language[] = ["en", "zh"];

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Language | null;
    if (stored && LANGUAGES.includes(stored)) {
      setLanguageState(stored);
    }
  }, []);

  const setLanguage = useCallback((l: Language) => {
    setLanguageState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => {
      const next = prev === "en" ? "zh" : "en";
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const entry = translations[key];
      const str = entry?.[language] ?? entry?.en ?? key;
      if (!params) return str;
      return Object.entries(params).reduce(
        (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
        str,
      );
    },
    [language],
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
