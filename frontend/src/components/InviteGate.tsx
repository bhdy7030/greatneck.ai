"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageProvider";
import {
  getInviteCode,
  setInviteCode,
  getSessionId,
} from "@/lib/auth";
import { checkInviteStatus, redeemInviteCode } from "@/lib/api";

export default function InviteGate({ children }: { children: ReactNode }) {
  const { user, isLoading, login, loginWithApple } = useAuth();
  const { t } = useLanguage();
  const [checking, setChecking] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isLoading) return;

    // Logged-in user with is_invited or is_admin → pass through
    if (user && (user.is_invited || user.is_admin)) {
      setHasAccess(true);
      setChecking(false);
      return;
    }

    // Any logged-in user who got here via OAuth → pass through
    // (they'll get is_invited set by AuthProvider's linkInviteToAccount)
    if (user) {
      setHasAccess(true);
      setChecking(false);
      return;
    }

    // Check for stored invite code
    const stored = getInviteCode();
    if (stored) {
      setHasAccess(true);
      setChecking(false);
      return;
    }

    // Check for ?invite=CODE in URL
    const params = new URLSearchParams(window.location.search);
    const urlCode = params.get("invite");
    if (urlCode) {
      // Clean URL first
      params.delete("invite");
      const qs = params.toString();
      const newUrl =
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      window.history.replaceState({}, "", newUrl);
      handleRedeem(urlCode.trim().toUpperCase());
      return;
    }

    // Check with server if invite is required
    checkInviteStatus()
      .then((status) => {
        if (!status.required || status.has_invite) {
          setHasAccess(true);
        }
      })
      .catch(() => {
        // Server unreachable → fail-open (frontend gate, not security)
        setHasAccess(true);
      })
      .finally(() => setChecking(false));
  }, [isLoading, user]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRedeem(codeToRedeem: string) {
    setSubmitting(true);
    setError("");
    try {
      const sessionId = getSessionId();
      await redeemInviteCode(codeToRedeem, sessionId);
      setInviteCode(codeToRedeem);
      setHasAccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Invalid invite code";
      if (msg.includes("already used") || msg.includes("410")) {
        // Code was already redeemed (e.g. returning via OAuth callback) — just grant access
        setInviteCode(codeToRedeem);
        setHasAccess(true);
      } else {
        setError(t("invite.invalid"));
      }
    } finally {
      setSubmitting(false);
      setChecking(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    handleRedeem(trimmed);
  }

  if (isLoading || checking) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-sage border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (hasAccess) {
    return <>{children}</>;
  }

  // Show invite gate
  return (
    <div className="flex-1 flex items-center justify-center p-4 bg-surface-50">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-lg border border-surface-200 p-8 text-center">
          {/* Logo */}
          <div className="mb-6">
            <svg
              className="w-10 h-10 mx-auto text-sage"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 9h.01M15 9h.01M9 13h.01M15 13h.01"
              />
            </svg>
            <h1 className="text-xl font-bold text-text-900 mt-3">
              greatneck.ai
            </h1>
          </div>

          <h2 className="text-lg font-semibold text-text-800 mb-1">
            {t("invite.title")}
          </h2>
          <p className="text-sm text-text-500 mb-6">
            {t("invite.subtitle")}
          </p>

          {/* Code input */}
          <form onSubmit={handleSubmit} className="mb-4">
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setError("");
              }}
              placeholder={t("invite.placeholder")}
              className="w-full px-4 py-3 border border-surface-300 rounded-xl text-center text-lg font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-sage/50 focus:border-sage transition-colors"
              maxLength={8}
              autoFocus
              disabled={submitting}
            />
            {error && (
              <p className="text-red-500 text-sm mt-2">{error}</p>
            )}
            <button
              type="submit"
              disabled={!code.trim() || submitting}
              className="w-full mt-3 py-3 bg-sage text-white rounded-xl font-medium hover:bg-sage/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </span>
              ) : (
                t("invite.enter")
              )}
            </button>
          </form>

          <p className="text-xs text-text-400 mb-6">
            {t("invite.needInvite")}
          </p>

          {/* Sign in section for existing members */}
          <div className="border-t border-surface-200 pt-5">
            <p className="text-sm text-text-500 mb-3">
              {t("invite.alreadyMember")}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={login}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-surface-300 rounded-xl text-sm text-text-700 hover:bg-surface-100 transition-colors"
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
                onClick={loginWithApple}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-surface-300 rounded-xl text-sm text-text-700 hover:bg-surface-100 transition-colors"
              >
                <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
                {t("auth.signInApple")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
