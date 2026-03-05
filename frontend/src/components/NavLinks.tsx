"use client";

import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "./LanguageProvider";

export default function NavLinks() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const isAdmin = user?.is_admin ?? false;
  const canDebug = isAdmin || (user?.can_debug ?? false);

  return (
    <>
      <a
        href="/chat/"
        className="hidden md:inline text-sm text-text-500 hover:text-text-800 transition-colors"
      >
        {t("nav.chat")}
      </a>
      {/* Mobile: icon-only chat link */}
      <a
        href="/chat/"
        className="md:hidden p-2 text-text-500 hover:text-text-800 transition-colors"
        title={t("nav.chat")}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </a>
      {isAdmin && (
        <>
          <a
            href="/admin/"
            className="hidden md:inline text-sm text-text-500 hover:text-text-800 transition-colors"
          >
            Admin
          </a>
          <a
            href="/admin/"
            className="md:hidden p-2 text-text-500 hover:text-text-800 transition-colors"
            title="Admin"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </a>
        </>
      )}
      {canDebug && (
        <>
          <a
            href="/debug/"
            className="hidden md:inline text-sm text-gold hover:text-gold-dark transition-colors"
          >
            Debug
          </a>
          <a
            href="/debug/"
            className="md:hidden p-2 text-gold hover:text-gold-dark transition-colors"
            title="Debug"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </a>
        </>
      )}
    </>
  );
}
