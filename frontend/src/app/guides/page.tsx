"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
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
import PlaybookPeekSheet from "@/components/PlaybookPeekSheet";

export default function GuidesPage() {
  return (
    <Suspense>
      <GuidesPageInner />
    </Suspense>
  );
}

function GuidesPageInner() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const [tab, setTab] = useState<"wallet" | "browse">("browse");
  const [walletGuides, setWalletGuides] = useState<Guide[]>([]);
  const [allGuides, setAllGuides] = useState<Guide[]>([]);
  const [expandedGuide, setExpandedGuide] = useState<Guide | null>(null);
  const [returnStepId, setReturnStepId] = useState<string | null>(null);
  const [peekGuide, setPeekGuide] = useState<Guide | null>(null);
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
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-4">
          {/* Back button */}
          <button
            onClick={() => {
              if (editingGuide) { handleEditDone(); return; }
              setExpandedGuide(null); setReturnStepId(null); fetchData();
            }}
            className="flex items-center gap-1 text-xs text-text-500 hover:text-sage mb-3 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {editingGuide ? t("guides.edit.done") : t("guides.backToWallet")}
          </button>

          {/* Guide header */}
          <div className="mb-4">
            <div
              className="h-1.5 rounded-full mb-3"
              style={{ backgroundColor: expandedGuide.color }}
            />
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h1 className="text-lg font-bold text-text-900 mb-1">
                  {expandedGuide.title}
                </h1>
                <p className="text-xs text-text-500">{expandedGuide.description}</p>
              </div>
              {isOwnGuide && !editingGuide && (
                <button
                  onClick={() => handleEditStart(expandedGuide.id)}
                  className="ml-3 px-3 py-1.5 text-xs font-medium text-sage border border-sage/30 rounded-lg hover:bg-sage/5 transition-colors min-h-[44px]"
                >
                  {t("guides.edit")}
                </button>
              )}
              {editingGuide && editSaved && (
                <span className="ml-3 text-xs text-green-600 flex items-center gap-1 min-h-[44px]">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {t("guides.edit.saved")}
                </span>
              )}
            </div>
          </div>

          {/* Edit mode or Checklist */}
          {editingGuide ? (
            <GuideEditor guide={editingGuide} onChange={handleEditChange} />
          ) : (
            <GuideChecklist
              guideId={expandedGuide.id}
              steps={expandedGuide.steps}
              color={expandedGuide.color}
              initialStepId={returnStepId}
            />
          )}

          {/* Bottom actions */}
          <div className="mt-6 pt-4 border-t border-surface-300 flex items-center gap-4">
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

      {/* Peek sheet */}
      {peekGuide && (
        <PlaybookPeekSheet
          guide={peekGuide}
          onClose={() => setPeekGuide(null)}
          onSave={handleSave}
          onFork={handleFork}
        />
      )}
    </div>
  );
}
