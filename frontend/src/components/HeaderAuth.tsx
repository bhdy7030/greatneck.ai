"use client";

import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "./LanguageProvider";

export default function HeaderAuth() {
  const { user, isLoading, login, logout } = useAuth();
  const { t } = useLanguage();

  if (isLoading) return null;

  if (!user) {
    return (
      <>
        <button
          onClick={login}
          className="hidden md:inline text-sm text-text-500 hover:text-text-800 transition-colors"
        >
          {t("auth.signIn")}
        </button>
        {/* Mobile: icon-only sign in */}
        <button
          onClick={login}
          className="md:hidden p-2 text-text-500 hover:text-text-800 transition-colors"
          title={t("auth.signIn")}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </button>
      </>
    );
  }

  return (
    <div className="flex items-center gap-1 md:gap-2">
      {user.avatar_url ? (
        <img
          src={user.avatar_url}
          alt=""
          className="w-6 h-6 rounded-full"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="w-6 h-6 rounded-full bg-sage/20 flex items-center justify-center text-xs font-medium text-sage">
          {user.name?.[0] || "?"}
        </div>
      )}
      <button
        onClick={logout}
        className="hidden md:inline text-xs text-text-400 hover:text-text-700 transition-colors"
        title={t("auth.signOut")}
      >
        {t("auth.signOut")}
      </button>
      {/* Mobile: icon-only logout */}
      <button
        onClick={logout}
        className="md:hidden p-1 text-text-400 hover:text-text-700 transition-colors"
        title={t("auth.signOut")}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>
    </div>
  );
}
