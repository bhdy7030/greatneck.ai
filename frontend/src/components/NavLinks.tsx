"use client";

import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";

export default function NavLinks() {
  const router = useRouter();
  const { t } = useLanguage();

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => router.push("/guides/")}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-white/80 hover:text-white transition-colors rounded-lg hover:bg-white/10"
        title={t("nav.guides")}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        <span className="text-xs font-medium hidden sm:inline">{t("nav.guides")}</span>
      </button>
      <button
        onClick={() => router.push("/chat/")}
        className="p-2 text-white bg-sage hover:bg-sage-dark rounded-full transition-colors"
        title={t("nav.ask")}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>
    </div>
  );
}
