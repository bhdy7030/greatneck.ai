"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useLanguage } from "@/components/LanguageProvider";
import { extendTrial } from "@/lib/api";

interface Props {
  code: "trial_exhausted" | "must_sign_in";
  onClose: () => void;
}

export default function UsageLimitModal({ code, onClose }: Props) {
  const { login, loginWithApple, refreshUsage } = useAuth();
  const { t } = useLanguage();
  const [extending, setExtending] = useState(false);

  const handleExtend = async () => {
    setExtending(true);
    try {
      await extendTrial();
      await refreshUsage();
      onClose();
    } catch {
      // fallback
    } finally {
      setExtending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 p-6">
        <h3 className="text-lg font-semibold text-text-800 mb-2">
          {code === "trial_exhausted"
            ? t("tier.trialExhaustedTitle")
            : t("tier.mustSignInTitle")}
        </h3>
        <p className="text-sm text-text-600 mb-6">
          {code === "trial_exhausted"
            ? t("tier.trialExhaustedDesc")
            : t("tier.mustSignInDesc")}
        </p>

        <div className="flex flex-col gap-2">
          {code === "trial_exhausted" && (
            <button
              onClick={handleExtend}
              disabled={extending}
              className="w-full px-4 py-2.5 bg-sage text-white rounded-lg font-medium hover:bg-sage-dark transition-colors disabled:opacity-50"
            >
              {extending ? "..." : t("tier.getMoreQueries")}
            </button>
          )}

          <button
            onClick={login}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-surface-300 text-text-700 rounded-lg font-medium hover:bg-surface-100 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {t("tier.signInGoogle")}
          </button>

          <button
            onClick={loginWithApple}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-black text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
            </svg>
            {t("tier.signInApple")}
          </button>

          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm text-text-400 hover:text-text-600 transition-colors"
          >
            {t("tier.dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
