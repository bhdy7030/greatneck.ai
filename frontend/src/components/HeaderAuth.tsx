"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "./LanguageProvider";
import { useTheme } from "./ThemeProvider";
import InviteManager from "./InviteManager";
import NotificationBell from "./NotificationBell";
import HandleChanger from "./HandleChanger";

const themeSwatches: { key: string; color: string }[] = [
  { key: "nord",     color: "rgb(94,129,172)" },
  { key: "light",    color: "rgb(20,184,166)" },
  { key: "classic",  color: "rgb(130,155,113)" },
  { key: "sage",     color: "rgb(58,130,110)" },
  { key: "ocean",    color: "rgb(59,130,246)" },
  { key: "hamptons", color: "rgb(25,55,125)" },
  { key: "coral",    color: "rgb(255,90,95)" },
];

export default function HeaderAuth() {
  const router = useRouter();
  const { user, isLoading, login, loginWithApple, logout } = useAuth();
  const { t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const [showMenu, setShowMenu] = useState(false);
  const [showInviteManager, setShowInviteManager] = useState(false);
  const [showHandleChanger, setShowHandleChanger] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Nudge: show dot badge after 3+ chat sessions
  const [showNudge, setShowNudge] = useState(false);
  useEffect(() => {
    if (!user) return;
    const count = parseInt(localStorage.getItem("gn_chat_count") || "0", 10);
    const nudgeSeen = localStorage.getItem("gn_invite_nudge_seen");
    if (count >= 3 && !nudgeSeen) {
      setShowNudge(true);
    }
  }, [user]);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMenu]);

  if (isLoading) return null;

  if (!user) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setShowMenu((v) => !v)}
          className="hidden md:inline text-sm text-text-500 hover:text-text-800 transition-colors"
        >
          {t("auth.signIn")}
        </button>
        {/* Mobile: icon-only sign in */}
        <button
          onClick={() => setShowMenu((v) => !v)}
          className="md:hidden p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-500 hover:text-text-800 transition-colors"
          title={t("auth.signIn")}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </button>
        {showMenu && (
          <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-lg shadow-lg border border-surface-200 py-1 z-50">
            <button
              onClick={() => { setShowMenu(false); login(); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-700 hover:bg-surface-100 transition-colors"
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              {t("auth.signInGoogle")}
            </button>
            <button
              onClick={() => { setShowMenu(false); loginWithApple(); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-700 hover:bg-surface-100 transition-colors"
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
              </svg>
              {t("auth.signInApple")}
            </button>
            <div className="border-t border-surface-100 my-1" />
            <div className="px-3 py-2">
              <div className="text-xs text-text-400 mb-1.5">Theme</div>
              <div className="flex items-center gap-1.5">
                {themeSwatches.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setTheme(s.key as typeof theme)}
                    className={`w-5 h-5 rounded-full border-2 transition-transform ${
                      s.key === theme ? "border-text-700 scale-110" : "border-surface-300 hover:scale-110"
                    }`}
                    style={{ backgroundColor: s.color }}
                    title={t(`theme.${s.key}`)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function handleOpenInvites() {
    setShowMenu(false);
    setShowInviteManager(true);
    setShowNudge(false);
    localStorage.setItem("gn_invite_nudge_seen", "1");
  }

  return (
    <>
      <div className="flex items-center gap-1 md:gap-2 relative" ref={menuRef}>
        <NotificationBell />
        <button
          onClick={() => setShowMenu((v) => !v)}
          className="relative flex items-center gap-1 px-1.5 py-1 rounded-full hover:bg-surface-100 transition-colors"
        >
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
          <svg className={`w-3 h-3 text-text-400 transition-transform ${showMenu ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
          {showNudge && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-sage rounded-full border-2 border-white" />
          )}
        </button>
        {showMenu && (
          <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-lg shadow-lg border border-surface-200 py-1 z-50">
            {user.handle && (
              <div className="px-3 py-2 text-xs text-text-400 border-b border-surface-100">
                @{user.handle}
              </div>
            )}
            {user.handle && (
              <a
                href={`/profile/?h=${user.handle}`}
                onClick={() => setShowMenu(false)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-700 hover:bg-surface-100 transition-colors"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Edit Profile
              </a>
            )}
            {user.handle && (
              <button
                onClick={() => { setShowMenu(false); setShowHandleChanger(true); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-700 hover:bg-surface-100 transition-colors"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9" />
                </svg>
                Change Username
              </button>
            )}
            <button
              onClick={handleOpenInvites}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-700 hover:bg-surface-100 transition-colors"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              <span>{t("invite.friends")}</span>
              {showNudge && (
                <span className="ml-auto text-xs text-sage font-medium">
                  {t("invite.shareNeighbors")}
                </span>
              )}
            </button>
            {user.is_admin && (
              <button
                onClick={() => { setShowMenu(false); router.push("/admin"); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-700 hover:bg-surface-100 transition-colors"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Admin
              </button>
            )}
            {(user.is_admin || user.can_debug) && (
              <button
                onClick={() => { setShowMenu(false); router.push("/debug"); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-700 hover:bg-surface-100 transition-colors"
              >
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Debug
              </button>
            )}
            <div className="border-t border-surface-100 my-1" />
            <div className="px-3 py-2">
              <div className="text-xs text-text-400 mb-1.5">Theme</div>
              <div className="flex items-center gap-1.5">
                {themeSwatches.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setTheme(s.key as typeof theme)}
                    className={`w-5 h-5 rounded-full border-2 transition-transform ${
                      s.key === theme ? "border-text-700 scale-110" : "border-surface-300 hover:scale-110"
                    }`}
                    style={{ backgroundColor: s.color }}
                    title={t(`theme.${s.key}`)}
                  />
                ))}
              </div>
            </div>
            <div className="border-t border-surface-100 my-1" />
            <button
              onClick={() => { setShowMenu(false); logout(); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-text-700 hover:bg-surface-100 transition-colors"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {t("auth.signOut")}
            </button>
          </div>
        )}
      </div>
      {showInviteManager && createPortal(
        <InviteManager onClose={() => setShowInviteManager(false)} />,
        document.body
      )}
      {showHandleChanger && user.handle && createPortal(
        <HandleChanger
          currentHandle={user.handle}
          onComplete={(handle) => {
            setShowHandleChanger(false);
            if (typeof window !== "undefined") {
              const stored = localStorage.getItem("gn_user");
              if (stored) {
                const u = JSON.parse(stored);
                u.handle = handle;
                localStorage.setItem("gn_user", JSON.stringify(u));
              }
            }
            window.location.reload();
          }}
          onClose={() => setShowHandleChanger(false)}
        />,
        document.body
      )}
    </>
  );
}
