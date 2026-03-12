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
  publishUserGuide,
  updatePublishedCopy,
  getLikeStatus,
  toggleLike,
  type Guide,
  type RawGuideData,
} from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import GuideChecklist from "@/components/GuideChecklist";
import GuideEditor from "@/components/GuideEditor";
import ExploreCard from "@/components/ExploreCard";
import StepReels from "@/components/StepReels";
import StepInlineChat from "@/components/StepInlineChat";
import PlaybookComments from "@/components/PlaybookComments";

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
  const { user } = useAuth();
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
  const [likeStatus, setLikeStatus] = useState<Record<string, { liked: boolean; count: number }>>({});
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showUpdatePublishedModal, setShowUpdatePublishedModal] = useState(false);
  const [updatePublishedDone, setUpdatePublishedDone] = useState(false);

  const village = typeof window !== "undefined" ? localStorage.getItem("gn_village") || "" : "";

  const fetchData = useCallback(async () => {
    try {
      const [wallet, all] = await Promise.all([
        getWalletGuides(village, language),
        getGuides(village, language),
      ]);
      setWalletGuides(wallet);
      setAllGuides(all);

      // Fetch like status for all guides in bulk
      const guideIds = Array.from(new Set([...wallet, ...all].map((g) => g.id)));
      if (guideIds.length > 0) {
        try {
          const statuses = await getLikeStatus("guide", guideIds);
          setLikeStatus(statuses);
        } catch {}
      }

      // Handle ?id=guideId for shareable links, or ?open=guideId from notifications
      const shareId = searchParams.get("id");
      const openId = searchParams.get("open");
      const targetId = shareId || openId;
      if (targetId) {
        const guide = wallet.find((g) => g.id === targetId) || all.find((g) => g.id === targetId);
        if (guide) {
          if (shareId) {
            // Shared link → open in peek (read-only preview) mode
            setPeekGuide(guide);
          } else {
            // Notification → open in expanded (wallet) mode
            setExpandedGuide(guide);
          }
        }
        // Clean up URL
        const params = new URLSearchParams(searchParams.toString());
        params.delete("id");
        params.delete("open");
        const qs = params.toString();
        window.history.replaceState({}, "", `/guides${qs ? `?${qs}` : ""}`);
      }

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
  }, [village, language, searchParams]);

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

  const handleTogglePublish = async (guide: Guide) => {
    if (!guide.is_published) {
      // Publishing — show confirmation modal
      setShowPublishModal(true);
      return;
    }
    // Unpublishing — also confirm
    setShowPublishModal(true);
  };

  const confirmPublishToggle = async () => {
    if (!expandedGuide) return;
    const newStatus = !expandedGuide.is_published;
    setShowPublishModal(false);
    try {
      await publishUserGuide(expandedGuide.id, newStatus);
      setExpandedGuide({
        ...expandedGuide,
        is_published: newStatus,
        published_copy_id: newStatus ? "pending" : null,
      });
      fetchData();
    } catch (e) {
      console.error("Failed to toggle publish:", e);
    }
  };

  const handleUpdatePublished = async () => {
    if (!expandedGuide) return;
    setShowUpdatePublishedModal(false);
    try {
      await updatePublishedCopy(expandedGuide.id);
      setUpdatePublishedDone(true);
      setTimeout(() => setUpdatePublishedDone(false), 2000);
    } catch (e) {
      console.error("Failed to update published copy:", e);
    }
  };

  const handleToggleLike = async (guideId: string) => {
    try {
      const { liked, count } = await toggleLike("guide", guideId);
      setLikeStatus((prev) => ({ ...prev, [guideId]: { liked, count } }));
    } catch {}
  };

  const [shareCopied, setShareCopied] = useState(false);
  const handleShareGuide = async (guide: Guide) => {
    const url = `${window.location.origin}/guides?id=${encodeURIComponent(guide.id)}`;
    const shareData = {
      title: guide.title,
      text: `Check out this playbook: ${guide.title}`,
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {}
  };

  // Expanded view
  if (expandedGuide) {
    const isOwnGuide = expandedGuide.wallet_category === "published" || expandedGuide.wallet_category === "private";

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
              {expandedGuide.published_copy_id && (
                <span className="shrink-0 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-green-100 text-green-700 rounded-full">
                  Published
                </span>
              )}
            </div>

            {/* Update published version */}
            {isOwnGuide && expandedGuide.published_copy_id && !editingGuide && (
              updatePublishedDone ? (
                <span className="shrink-0 text-[11px] text-green-600 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Updated
                </span>
              ) : (
                <button
                  onClick={() => setShowUpdatePublishedModal(true)}
                  className="shrink-0 px-2.5 py-1 text-[11px] font-medium text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-50 transition-colors"
                >
                  Update Published
                </button>
              )
            )}

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

            {/* Share button — for published guides */}
            {expandedGuide.is_published && !editingGuide && (
              <button
                onClick={() => handleShareGuide(expandedGuide)}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-surface-200 hover:bg-surface-300 active:bg-surface-400 transition-colors"
                aria-label="Share"
              >
                {shareCopied ? (
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-text-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                )}
              </button>
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

            {/* Private hint for own unpublished guides */}
            {isOwnGuide && !expandedGuide.is_published && !editingGuide && (
              <div className="mb-3 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200/60">
                <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  {t("guides.private.hint")}
                </p>
              </div>
            )}

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

            {/* Like button — on all published guides */}
            {(!isOwnGuide || expandedGuide.is_published) && (
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => handleToggleLike(expandedGuide.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
                    likeStatus[expandedGuide.id]?.liked
                      ? "bg-red-50 text-red-500"
                      : "bg-surface-100 text-text-500 hover:bg-surface-200"
                  }`}
                >
                  <svg className="w-4 h-4" fill={likeStatus[expandedGuide.id]?.liked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                  {(likeStatus[expandedGuide.id]?.count || 0) > 0 && (
                    <span>{likeStatus[expandedGuide.id]?.count}</span>
                  )}
                </button>
              </div>
            )}

            {/* Comments — active on all published guides; frozen on own unpublished with existing comments */}
            {(!isOwnGuide || expandedGuide.is_published) && !editingGuide && (
              <PlaybookComments
                guideId={expandedGuide.id}
                commentCount={((expandedGuide as unknown as Record<string, unknown>).comment_count as number) || 0}
              />
            )}
            {isOwnGuide && !expandedGuide.is_published && !editingGuide && (((expandedGuide as unknown as Record<string, unknown>).comment_count as number) || 0) > 0 && (
              <PlaybookComments
                guideId={expandedGuide.id}
                commentCount={((expandedGuide as unknown as Record<string, unknown>).comment_count as number) || 0}
                readOnly
              />
            )}

            {/* Bottom actions */}
            <div className="mt-6 pt-4 border-t border-surface-300 flex items-center gap-4 pb-8">
              {isOwnGuide && !editingGuide && (
                <button
                  onClick={() => handleTogglePublish(expandedGuide)}
                  className={`text-xs font-medium min-h-[44px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                    expandedGuide.is_published
                      ? "bg-sage/10 text-sage border border-sage/30"
                      : "bg-surface-200 text-text-600 hover:bg-surface-300"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {expandedGuide.is_published ? "Published" : t("guides.publish")}
                </button>
              )}
              <div className="flex-1" />
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

        {/* Update published version confirmation modal */}
        {showUpdatePublishedModal && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="mx-4 max-w-sm w-full bg-surface-50 rounded-2xl shadow-xl p-5 space-y-4 animate-scaleIn">
              <h2 className="text-base font-bold text-text-900">Update Published Version</h2>
              <p className="text-xs text-text-600 leading-relaxed">
                This will update the version the community sees with your latest edits. Are you sure?
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowUpdatePublishedModal(false)}
                  className="flex-1 py-2.5 min-h-[44px] rounded-xl text-xs font-medium bg-surface-200 text-text-600 hover:bg-surface-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdatePublished}
                  className="flex-1 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                >
                  Update
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Publish / Unpublish confirmation modal */}
        {showPublishModal && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="mx-4 max-w-sm w-full bg-surface-50 rounded-2xl shadow-xl p-5 space-y-4 animate-scaleIn">
              <h2 className="text-base font-bold text-text-900">
                {expandedGuide.is_published ? t("guides.unpublish.confirm.title") : t("guides.publish.confirm.title")}
              </h2>
              <p className="text-xs text-text-600 leading-relaxed">
                {expandedGuide.is_published ? t("guides.unpublish.confirm.description") : t("guides.publish.confirm.description")}
              </p>

              {!expandedGuide.is_published && (
                <ul className="space-y-2 text-[11px] text-text-700">
                  <li className="flex items-start gap-2">
                    <svg className="w-3.5 h-3.5 text-sage shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {t("guides.publish.confirm.shared")}
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    {t("guides.publish.confirm.noNotes")}
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-3.5 h-3.5 text-sage shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                    </svg>
                    {t("guides.publish.confirm.interact")}
                  </li>
                </ul>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowPublishModal(false)}
                  className="flex-1 py-2.5 min-h-[44px] rounded-xl text-xs font-medium bg-surface-200 text-text-600 hover:bg-surface-300 transition-colors"
                >
                  {expandedGuide.is_published ? t("guides.unpublish.confirm.cancel") : t("guides.publish.confirm.cancel")}
                </button>
                <button
                  onClick={confirmPublishToggle}
                  className="flex-1 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold bg-sage text-white hover:bg-sage-dark transition-colors"
                >
                  {expandedGuide.is_published ? t("guides.unpublish.confirm.ok") : t("guides.publish.confirm.ok")}
                </button>
              </div>
            </div>
          </div>
        )}
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
              onClick={() => handleShareGuide(peekGuide)}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-surface-200 hover:bg-surface-300 active:bg-surface-400 transition-colors"
              aria-label="Share"
            >
              {shareCopied ? (
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-text-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              )}
            </button>
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

            {/* Like button */}
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => handleToggleLike(peekGuide.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
                  likeStatus[peekGuide.id]?.liked
                    ? "bg-red-50 text-red-500"
                    : "bg-surface-100 text-text-500 hover:bg-surface-200"
                }`}
              >
                <svg className="w-4 h-4" fill={likeStatus[peekGuide.id]?.liked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                {(likeStatus[peekGuide.id]?.count || 0) > 0 && (
                  <span>{likeStatus[peekGuide.id]?.count}</span>
                )}
              </button>
            </div>

            {/* Comments */}
            <PlaybookComments
              guideId={peekGuide.id}
              commentCount={((peekGuide as unknown as Record<string, unknown>).comment_count as number) || 0}
            />

            {/* Save CTA */}
            <div className="mt-6 bg-surface-50 rounded-2xl border border-surface-300 px-4 py-5 space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <p className="text-[13px] font-semibold text-text-800">{t("guides.save.headline")}</p>
              </div>
              <p className="text-[12px] text-text-600 leading-relaxed">{t("guides.save.description")}</p>
              <ul className="space-y-1.5 text-[11px] text-text-600">
                <li className="flex items-center gap-2">
                  <span className="text-sage">&#10003;</span>
                  {t("guides.save.bullet.track")}
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-sage">&#10003;</span>
                  {t("guides.save.bullet.notes")}
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-sage">&#10003;</span>
                  {t("guides.save.bullet.reminders")}
                </li>
              </ul>
              <button
                onClick={() => {
                  handleFork(peekGuide.id);
                  setPeekGuide(null);
                  setPreviewIdx(0);
                  setPreviewChatIdx(null);
                }}
                className="w-full py-3 min-h-[44px] rounded-xl font-semibold text-sm bg-sage text-white hover:bg-sage-dark active:scale-[0.98] transition-colors"
              >
                {t("guides.save.cta")}
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
          /* Wallet View -- Sectioned Cards */
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
            <div className="space-y-5">
              {(["published", "private", "liked"] as const).map((cat) => {
                const items = walletGuides.filter((g) => g.wallet_category === cat);
                if (items.length === 0) return null;
                const labels = { published: "Published", private: "Private", liked: "Liked" };
                return (
                  <div key={cat}>
                    <h3 className="text-xs font-semibold text-text-500 uppercase tracking-wider mb-2">
                      {labels[cat]}
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {items.map((guide, i) => (
                        <ExploreCard
                          key={guide.id}
                          title={guide.title}
                          icon={guide.icon}
                          color={guide.color}
                          description={guide.description}
                          doneCount={guide.done_count}
                          totalCount={guide.total_count}
                          seasonLabel={guide.season_label}
                          badge={guide.published_copy_id ? "Published" : guide.wallet_category === "private" ? t("guides.custom") : undefined}
                          authorHandle={guide.author_handle}
                          likeCount={likeStatus[guide.id]?.count}
                          index={i}
                          onTap={() => handleCardClick(guide)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
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
                authorHandle={guide.author_handle}
                likeCount={likeStatus[guide.id]?.count}
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
