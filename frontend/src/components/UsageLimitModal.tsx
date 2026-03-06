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
  const { login, refreshUsage } = useAuth();
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
            className="w-full px-4 py-2.5 bg-white border border-surface-300 text-text-700 rounded-lg font-medium hover:bg-surface-100 transition-colors"
          >
            {t("tier.signInUnlimited")}
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
