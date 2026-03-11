"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import {
  getGuides,
  getWalletGuides,
  saveGuide,
  unsaveGuide,
  forkGuide,
  getUserGuide,
  saveUserGuide,
  deleteUserGuide,
  type Guide,
  type RawGuideData,
} from "@/lib/api";
import GuideChecklist from "@/components/GuideChecklist";
import GuideEditor from "@/components/GuideEditor";
import ExploreCard from "@/components/ExploreCard";
import StepReels from "@/components/StepReels";
import StepInlineChat from "@/components/StepInlineChat";

export default function GuidesPage() {
  return (
    <Suspense>
      <GuidesPageInner />
    </Suspense>
  );
}

function GuidesPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { language, t } = useLanguage();
  const [tab, setTab] = useState<"wallet" | "browse">(() =>
    searchParams.get("tab") === "wallet" ? "wallet" : "browse"
  );
  const [walletGuides, setWalletGuides] = useState<Guide[]>([]);
  const [allGuides, setAllGuides] = useState<Guide[]>([]);
  const [expandedGuide, setExpandedGuide] = useState<Guide | null>(null);
  const [returnStepId, setReturnStepId] = useState<string | null>(null);
  const [peekGuide, setPeekGuide] = useState<Guide | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [previewChatIdx, setPreviewChatIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingGuide, setEditingGuide] = useState<RawGuideData | null>(null);
  const [editingGuideId, setEditingGuideId] = useState<string | null>(null);
  const [editSaved, setEditSaved] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const village = typeof window !== "undefined" ? localStorage.getItem("gn_village") || "" : "";

  const fetchData = useCallback(async () => {
    try {
      const [wallet, all] = await Promise.all([
        getWalletGuides(village, language),
        getGuides(village, language),
      ]);
      setWalletGuides(wallet);
      setAllGuides(all);

      // Auto-expand to guide+step if returning from chat
      const returnJson = localStorage.getItem("gn_return_guide");
      if (returnJson) {
        localStorage.removeItem("gn_return_guide");
        try {
          const { guideId, stepId } = JSON.parse(returnJson);
          const guide = wallet.find((g) => g.id === guideId) || all.find((g) => g.id === guideId);
          if (guide) {
            setExpandedGuide(guide);
            setTab("wallet");
            if (stepId) setReturnStepId(stepId);
          }
        } catch {
          // ignore bad JSON
        }
      }
    } catch (e) {
      console.error("Failed to load guides:", e);
    } finally {
      setLoading(false);
    }
  }, [village, language]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSave = async (guideId: string) => {
    // Optimistic
    setAllGuides((prev) =>
      prev.map((g) => (g.id === guideId ? { ...g, saved: true } : g))
    );
    setPeekGuide((prev) =>
      prev?.id === guideId ? { ...prev, saved: true } : prev
    );
    try {
      await saveGuide(guideId);
      await fetchData();
    } catch {
      setAllGuides((prev) =>
        prev.map((g) => (g.id === guideId ? { ...g, saved: false } : g))
      );
      setPeekGuide((prev) =>
        prev?.id === guideId ? { ...prev, saved: false } : prev
      );
    }
  };

  const handleUnsave = async (guideId: string) => {
    setAllGuides((prev) =>
      prev.map((g) => (g.id === guideId ? { ...g, saved: false } : g))
    );
    setWalletGuides((prev) => prev.filter((g) => g.id !== guideId));
    setPeekGuide((prev) =>
      prev?.id === guideId ? { ...prev, saved: false } : prev
    );
    try {
      await unsaveGuide(guideId);
      await fetchData();
    } catch {
      await fetchData();
    }
  };

  const handleCardClick = (guide: Guide) => {
    setExpandedGuide(guide);
    setEditingGuide(null);
    setEditingGuideId(null);
  };

  const handleFork = async (guideId: string) => {
    try {
      const { id } = await forkGuide(guideId);
      setPeekGuide(null);
      await fetchData();
      setTab("wallet");
    } catch (e) {
      console.error("Failed to fork guide:", e);
    }
  };

  const handleEditStart = async (guideId: string) => {
    try {
      const ug = await getUserGuide(guideId);
      setEditingGuide(ug.guide_data);
      setEditingGuideId(guideId);
    } catch (e) {
      console.error("Failed to load guide for editing:", e);
    }
  };

  const handleEditChange = useCallback(
    (updated: RawGuideData) => {
      setEditingGuide(updated);
      setEditSaved(false);
      // Debounced auto-save
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        if (editingGuideId) {
          try {
            await saveUserGuide(editingGuideId, updated);
            setEditSaved(true);
          } catch (e) {
            console.error("Auto-save failed:", e);
          }
        }
      }, 800);
    },
    [editingGuideId]
  );

  const handleEditDone = () => {
    setEditingGuide(null);
    setEditingGuideId(null);
    setExpandedGuide(null);
    fetchData();
  };

  const handleDelete = async (guideId: string) => {
    if (!confirm(t("guides.delete.confirm"))) return;
    try {
      await deleteUserGuide(guideId);
      setExpandedGuide(null);
      setEditingGuide(null);
      fetchData();
    } catch (e) {
      console.error("Failed to delete guide:", e);
    }
  };

  // Expanded view
  if (expandedGuide) {
    const isOwnGuide = expandedGuide.id.startsWith("ug-");

    return (
      <div className="fixed inset-0 z-50 bg-surface-100 flex flex-col animate-fullscreenSlideUp">
        {/* Compact top bar: back + title + actions */}
        <div
          className="shrink-0 px-3 py-2 border-b border-surface-200 bg-surface-100/95 backdrop-blur-sm"
          style={{ borderBottomColor: expandedGuide.color + "40" }}
        >
          <div className="flex items-center gap-2 max-w-2xl mx-auto">
            {/* Color accent + title */}
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: expandedGuide.color }} />
              <h1 className="text-sm font-bold text-text-900 truncate">{expandedGuide.title}</h1>
            </div>

            {/* Actions */}
            {isOwnGuide && !editingGuide && (
              <button
                onClick={() => handleEditStart(expandedGuide.id)}
                className="shrink-0 px-2.5 py-1 text-[11px] font-medium text-sage border border-sage/30 rounded-lg hover:bg-sage/5 transition-colors"
              >
                {t("guides.edit")}
              </button>
            )}
            {editingGuide && editSaved && (
              <span className="shrink-0 text-[11px] text-green-600 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {t("guides.edit.saved")}
              </span>
            )}

            {/* Close button */}
            <button
              onClick={() => {
                if (editingGuide) { handleEditDone(); return; }
                setExpandedGuide(null); setReturnStepId(null); fetchData();
              }}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-surface-200 hover:bg-surface-300 active:bg-surface-400 transition-colors"
              aria-label="Close"
            >
              <svg className="w-4 h-4 text-text-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 pt-3 pb-4">
            {/* Guide description */}
            <p className="text-xs text-text-500 mb-3">{expandedGuide.description}</p>

            {/* Edit mode or Checklist */}
            {editingGuide ? (
              <GuideEditor guide={editingGuide} onChange={handleEditChange} />
            ) : (
              <GuideChecklist
                guideId={expandedGuide.id}
                guideTitle={expandedGuide.title}
                steps={expandedGuide.steps}
                color={expandedGuide.color}
                initialStepId={returnStepId}
              />
            )}

            {/* Bottom actions */}
            <div className="mt-6 pt-4 border-t border-surface-300 flex items-center gap-4 pb-8">
              {!isOwnGuide && (
                <button
                  onClick={() => { handleUnsave(expandedGuide.id); setExpandedGuide(null); }}
                  className="text-xs text-text-500 hover:text-red-500 transition-colors min-h-[44px] flex items-center"
                >
                  {t("guides.removeFromWallet")}
                </button>
              )}
              {isOwnGuide && (
                <button
                  onClick={() => handleDelete(expandedGuide.id)}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors min-h-[44px] flex items-center"
                >
                  {t("guides.delete")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Preview view — read-only fullscreen for explore playbooks
  if (peekGuide) {
    const step = peekGuide.steps[previewIdx];

    return (
      <div className="fixed inset-0 z-50 bg-surface-100 flex flex-col animate-fullscreenSlideUp">
        {/* Compact top bar: back + title */}
        <div
          className="shrink-0 px-3 py-2 border-b border-surface-200 bg-surface-100/95 backdrop-blur-sm"
          style={{ borderBottomColor: peekGuide.color + "40" }}
        >
          <div className="flex items-center gap-2 max-w-2xl mx-auto">
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <div className="w-1 h-5 rounded-full shrink-0" style={{ backgroundColor: peekGuide.color }} />
              <h1 className="text-sm font-bold text-text-900 truncate">{peekGuide.title}</h1>
            </div>
            <button
              onClick={() => { setPeekGuide(null); setPreviewIdx(0); setPreviewChatIdx(null); }}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-surface-200 hover:bg-surface-300 active:bg-surface-400 transition-colors"
              aria-label="Close"
            >
              <svg className="w-4 h-4 text-text-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 pt-3 pb-4">
            {/* Guide description */}
            <p className="text-xs text-text-500 mb-3">{peekGuide.description}</p>

            {/* Read-only step reels */}
            <StepReels
              steps={peekGuide.steps}
              activeIdx={previewIdx}
              color={peekGuide.color}
              mode="fit"
              onNav={setPreviewIdx}
              renderContent={(i) => {
                const s = peekGuide.steps[i];
                return (
                  <div className="space-y-2.5">
                    {/* Description + Details */}
                    <div className="bg-surface-100/60 rounded-xl px-3.5 py-3 border border-surface-200">
                      <p className="text-xs text-text-700 leading-relaxed">{s.description}</p>
                      {s.details && (
                        <div className="text-text-600 whitespace-pre-line text-[11px] mt-2 leading-relaxed">
                          {s.details}
                        </div>
                      )}
                      {s.links.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-surface-200">
                          {s.links.map((link, j) => (
                            <a
                              key={j}
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] text-sage hover:text-sage-dark bg-sage/10 px-2 py-1 rounded-full"
                            >
                              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                              {link.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Inline chat */}
                    {previewChatIdx === i && s.chat_prompt && (
                      <div className="bg-surface-100/60 rounded-xl px-3.5 py-3 border border-surface-200">
                        <StepInlineChat
                          chatPrompt={s.chat_prompt}
                          stepTitle={s.title}
                          guideTitle={peekGuide.title}
                          stepDescription={s.description}
                          stepDetails={s.details}
                          guideId={peekGuide.id}
                          stepId={s.id}
                          onContinueInChat={() => {
                            localStorage.setItem("gn_draft", s.chat_prompt);
                            router.push("/chat/");
                          }}
                        />
                      </div>
                    )}

                    {/* Chat with AI button */}
                    {s.chat_prompt && (
                      <button
                        onClick={() => setPreviewChatIdx(previewChatIdx === i ? null : i)}
                        className="w-full min-h-[44px] text-[12px] font-medium rounded-xl bg-surface-100/60 border border-surface-200 text-text-600 hover:bg-surface-200 flex items-center justify-center gap-2 transition-colors"
                      >
                        <span>✨</span>
                        Chat with AI about this
                      </button>
                    )}
                  </div>
                );
              }}
            />

            {/* Save CTA */}
            <div className="mt-6 bg-surface-50 rounded-2xl border border-surface-300 px-4 py-5 text-center space-y-3">
              <p className="text-[13px] text-text-700 leading-relaxed">
                Like what you see? <strong>Grab your own copy</strong> — check off steps, add notes, skip what doesn&apos;t apply. Your playbook, your rules.
              </p>
              <button
                onClick={() => {
                  handleFork(peekGuide.id);
                  setPeekGuide(null);
                  setPreviewIdx(0);
                  setPreviewChatIdx(null);
                }}
                className="w-full py-3 min-h-[44px] rounded-xl font-semibold text-sm bg-sage text-white hover:bg-sage-dark active:scale-[0.98] transition-colors"
              >
                Save to My Playbooks
              </button>
            </div>

            <div className="h-8" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold text-text-900">{t("guides.title")}</h1>
            <p className="text-xs text-text-500">{t("guides.subtitle")}</p>
          </div>
          <button
            onClick={() => router.push("/guides/create")}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-sage rounded-lg hover:bg-sage-dark transition-colors min-h-[44px]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t("guides.create")}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-surface-200 rounded-lg p-0.5">
          <button
            onClick={() => setTab("wallet")}
            className={`flex-1 text-sm font-medium py-2.5 min-h-[44px] rounded-md transition-colors ${
              tab === "wallet"
                ? "bg-surface-50 text-text-900 shadow-sm"
                : "text-text-500 hover:text-text-700"
            }`}
          >
            {t("guides.tab.wallet")}
          </button>
          <button
            onClick={() => setTab("browse")}
            className={`flex-1 text-sm font-medium py-2.5 min-h-[44px] rounded-md transition-colors ${
              tab === "browse"
                ? "bg-surface-50 text-text-900 shadow-sm"
                : "text-text-500 hover:text-text-700"
            }`}
          >
            {t("guides.tab.browse")}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-sage border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tab === "wallet" ? (
          /* Wallet View -- Stacked Cards */
          walletGuides.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-text-500 mb-2">{t("guides.empty")}</p>
              <button
                onClick={() => setTab("browse")}
                className="text-xs text-sage hover:text-sage-dark transition-colors"
              >
                {t("guides.browseCta")}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {walletGuides.map((guide, i) => (
                <ExploreCard
                  key={guide.id}
                  title={guide.title}
                  icon={guide.icon}
                  color={guide.color}
                  description={guide.description}
                  doneCount={guide.done_count}
                  totalCount={guide.total_count}
                  seasonLabel={guide.season_label}
                  badge={guide.is_custom ? t("guides.custom") : undefined}
                  index={i}
                  onTap={() => handleCardClick(guide)}
                />
              ))}
            </div>
          )
        ) : (
          /* Catalog View -- 2-Column Card Grid */
          <div className="grid grid-cols-2 gap-3">
            {allGuides.map((guide, i) => (
              <ExploreCard
                key={guide.id}
                title={guide.title}
                icon={guide.icon}
                color={guide.color}
                description={guide.description}
                totalCount={guide.total_count}
                seasonLabel={guide.season_label}
                saved={guide.saved}
                badge={guide.is_community ? t("guides.community") : undefined}
                index={i}
                onTap={() => setPeekGuide(guide)}
              />
            ))}
          </div>
        )}

        {/* Back to home link */}
        <div className="mt-6 text-center">
          <a
            href="/"
            className="text-xs text-text-500 hover:text-sage transition-colors"
          >
            {t("guides.backHome")}
          </a>
        </div>
      </div>

    </div>
  );
}
