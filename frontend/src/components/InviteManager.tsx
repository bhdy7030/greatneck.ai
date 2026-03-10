"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { generateInvite, getMyInvites, type InviteInfo } from "@/lib/api";

export default function InviteManager({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const [invites, setInvites] = useState<InviteInfo[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loadInvites();
  }, []);

  async function loadInvites() {
    try {
      const data = await getMyInvites();
      setInvites(data.invites);
      setRemaining(data.remaining);
      setLimit(data.limit);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    try {
      await generateInvite();
      await loadInvites();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate");
    } finally {
      setGenerating(false);
    }
  }

  function copyToClipboard(text: string, code: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    });
  }

  const inviteUrl = (code: string) =>
    `${window.location.origin}/?invite=${code}`;

  async function handleShare(code: string) {
    const url = inviteUrl(code);
    const shareData = {
      title: "greatneck.ai",
      text: t("invite.shareText").replace("{code}", code),
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // user cancelled or share failed — fall back to copy
        copyToClipboard(url, `share-${code}`);
      }
    } else {
      copyToClipboard(url, `share-${code}`);
    }
  }

  const canGenerate = remaining === null || remaining > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-900">
            {t("invite.friends")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-text-400 hover:text-text-700 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Remaining count */}
        <p className="text-sm text-text-500 mb-4">
          {limit !== null
            ? t("invite.remaining")
                .replace("{n}", String(remaining ?? 0))
                .replace("{total}", String(limit))
            : t("invite.unlimited")}
        </p>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={!canGenerate || generating}
          className="w-full py-2.5 bg-sage text-white rounded-xl font-medium hover:bg-sage/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-4"
        >
          {generating ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </span>
          ) : (
            t("invite.generate")
          )}
        </button>

        {error && (
          <p className="text-red-500 text-sm mb-4">{error}</p>
        )}

        {/* Invite list */}
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-sage border-t-transparent rounded-full animate-spin" />
          </div>
        ) : invites.length === 0 ? (
          <p className="text-sm text-text-400 text-center py-4">
            {t("invite.noInvites")}
          </p>
        ) : (
          <div className="space-y-3">
            {invites.map((inv) => (
              <div
                key={inv.code}
                className="border border-surface-200 rounded-xl p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <code className="text-lg font-mono font-bold tracking-wider text-text-800">
                    {inv.code}
                  </code>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      inv.redeemed
                        ? "bg-surface-100 text-text-400"
                        : "bg-green-50 text-green-700"
                    }`}
                  >
                    {inv.redeemed ? t("invite.redeemed") : t("invite.available")}
                  </span>
                </div>
                {!inv.redeemed && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => copyToClipboard(inv.code, inv.code)}
                      className="flex-1 py-1.5 text-xs border border-surface-300 rounded-lg hover:bg-surface-50 transition-colors"
                    >
                      {copiedCode === inv.code
                        ? t("invite.copied")
                        : t("invite.copyCode")}
                    </button>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          inviteUrl(inv.code),
                          `link-${inv.code}`
                        )
                      }
                      className="flex-1 py-1.5 text-xs border border-surface-300 rounded-lg hover:bg-surface-50 transition-colors"
                    >
                      {copiedCode === `link-${inv.code}`
                        ? t("invite.copied")
                        : t("invite.copyLink")}
                    </button>
                    <button
                      onClick={() => handleShare(inv.code)}
                      className="flex-1 py-1.5 text-xs border border-surface-300 rounded-lg hover:bg-surface-50 transition-colors flex items-center justify-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                      {copiedCode === `share-${inv.code}`
                        ? t("invite.copied")
                        : t("invite.share")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
