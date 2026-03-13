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
import StepMarkdown from "@/components/StepMarkdown";
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
  const [showCommentsSheet, setShowCommentsSheet] = useState(false);
  const [showBottomActions, setShowBottomActions] = useState(false);
  const [showSaveSheet, setShowSaveSheet] = useState(false);

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
      const urlTab = searchParams.get("tab");
      if (targetId) {
        const walletGuide = wallet.find((g) => g.id === targetId);
        const guide = walletGuide || all.find((g) => g.id === targetId);
        if (guide) {
          // Restore tab from URL, or infer from guide location
          if (urlTab === "wallet" || urlTab === "browse") {
            setTab(urlTab);
          } else if (walletGuide) {
            setTab("wallet");
          }

          if (openId) {
            // Notification → open in expanded (wallet) mode
            setExpandedGuide(guide);
            // Clean up ?open= but keep ?id= style URL
            window.history.replaceState({}, "", `/guides?id=${guide.id}&tab=${urlTab || (walletGuide ? "wallet" : "browse")}`);
          } else if (walletGuide && urlTab === "wallet") {
            // Wallet guide opened from wallet tab → expanded mode
            setExpandedGuide(guide);
          } else {
            // Shared/browse link → peek (read-only preview) mode
            setPeekGuide(guide);
          }
        } else {
          // Guide not found — clean up URL
          window.history.replaceState({}, "", `/guides${urlTab ? `?tab=${urlTab}` : ""}`);
        }
      } else if (urlTab === "wallet" || urlTab === "browse") {
        setTab(urlTab);
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

  // Handle browser back/forward button
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get("id");
      const urlTab = params.get("tab");

      if (!id) {
        // No guide in URL — close any open guide
        setExpandedGuide(null);
        setPeekGuide(null);
        setPreviewIdx(0);
        setPreviewChatIdx(null);
        setShowCommentsSheet(false);
        setShowBottomActions(false);
        setShowSaveSheet(false);
        if (urlTab === "wallet" || urlTab === "browse") setTab(urlTab);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

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
    window.history.pushState({}, "", `/guides?id=${guide.id}&tab=${tab}`);
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

    const commentCount = ((expandedGuide as unknown as Record<string, unknown>).comment_count as number) || 0;
    const showComments = (!isOwnGuide || expandedGuide.is_published) || (isOwnGuide && !expandedGuide.is_published && commentCount > 0);
    const commentsReadOnly = isOwnGuide && !expandedGuide.is_published;

    return (
      <div className="fixed inset-0 z-50 bg-surface-50 flex flex-col animate-fullscreenSlideUp">
        {/* Fixed top bar — translucent, compact */}
        <div
          className="shrink-0 px-3 pt-[env(safe-area-inset-top)] bg-surface-50/90 backdrop-blur-md z-20"
          style={{ borderBottom: `1px solid ${expandedGuide.color}20` }}
        >
          <div className="flex items-center gap-2 max-w-2xl mx-auto py-2">
            {/* Close */}
            <button
              onClick={() => {
                if (editingGuide) { handleEditDone(); return; }
                setExpandedGuide(null); setReturnStepId(null); fetchData();
                window.history.pushState({}, "", `/guides?tab=${tab}`);
              }}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-200 active:bg-surface-300 transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5 text-text-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            {/* Title */}
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: expandedGuide.color }} />
              <h1 className="text-sm font-bold text-text-900 truncate">{expandedGuide.title}</h1>
            </div>

            {/* Top-right actions */}
            {isOwnGuide && expandedGuide.published_copy_id && !editingGuide && (
              updatePublishedDone ? (
                <span className="shrink-0 text-[11px] text-green-600 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </span>
              ) : (
                <button
                  onClick={() => setShowUpdatePublishedModal(true)}
                  className="shrink-0 px-2 py-1 text-[10px] font-medium text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-50"
                >
                  Sync Live
                </button>
              )
            )}
            {isOwnGuide && !editingGuide && (
              <button
                onClick={() => handleEditStart(expandedGuide.id)}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-200 transition-colors"
              >
                <svg className="w-4 h-4 text-text-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}
            {editingGuide && editSaved && (
              <span className="shrink-0 text-[11px] text-green-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </span>
            )}
            {expandedGuide.is_published && !editingGuide && (
              <button
                onClick={() => handleShareGuide(expandedGuide)}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-200 transition-colors"
                aria-label="Share"
              >
                {shareCopied ? (
                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-text-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                )}
              </button>
            )}
            {/* More menu (publish/delete) */}
            <button
              onClick={() => setShowBottomActions((v) => !v)}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-200 transition-colors"
            >
              <svg className="w-4 h-4 text-text-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
              </svg>
            </button>
          </div>
        </div>

        {/* Main content — immersive, fills viewport */}
        <div className="flex-1 min-h-0 flex flex-col">
          {editingGuide ? (
            <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4 max-w-2xl mx-auto w-full">
              <GuideEditor guide={editingGuide} onChange={handleEditChange} />
            </div>
          ) : (
            <>
              {/* Description — compact, above the steps */}
              {expandedGuide.description && (
                <div className="shrink-0 px-4 pt-2 pb-1 max-w-2xl mx-auto w-full">
                  <StepMarkdown content={expandedGuide.description} className="text-text-500" />
                </div>
              )}

              {/* Private hint */}
              {isOwnGuide && !expandedGuide.is_published && (
                <div className="shrink-0 mx-4 mb-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50/80 border border-amber-200/40 max-w-2xl">
                  <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <p className="text-[10px] text-amber-700">{t("guides.private.hint")}</p>
                </div>
              )}

              {/* Step reels — takes remaining space */}
              <div className="flex-1 min-h-0 max-w-2xl mx-auto w-full">
                <GuideChecklist
                  guideId={expandedGuide.id}
                  guideTitle={expandedGuide.title}
                  steps={expandedGuide.steps}
                  color={expandedGuide.color}
                  initialStepId={returnStepId}
                />
              </div>
            </>
          )}
        </div>

        {/* Bottom bar — like + comments toggle */}
        {!editingGuide && (
          <div
            className="shrink-0 pb-[env(safe-area-inset-bottom)] bg-surface-50/90 backdrop-blur-md border-t border-surface-200/60 z-20"
          >
            <div className="flex items-center gap-3 px-4 py-2 max-w-2xl mx-auto">
              {/* Like */}
              {(!isOwnGuide || expandedGuide.is_published) && (
                <button
                  onClick={() => handleToggleLike(expandedGuide.id)}
                  className={`flex items-center gap-1 text-sm transition-colors ${
                    likeStatus[expandedGuide.id]?.liked ? "text-red-500" : "text-text-400"
                  }`}
                >
                  <svg className="w-5 h-5" fill={likeStatus[expandedGuide.id]?.liked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                  {(likeStatus[expandedGuide.id]?.count || 0) > 0 && (
                    <span className="text-xs">{likeStatus[expandedGuide.id]?.count}</span>
                  )}
                </button>
              )}

              {/* Comments toggle */}
              {showComments && (
                <button
                  onClick={() => setShowCommentsSheet((v) => !v)}
                  className="flex items-center gap-1 text-text-400 transition-colors hover:text-text-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  {commentCount > 0 && <span className="text-xs">{commentCount}</span>}
                </button>
              )}

              <div className="flex-1" />

              {/* Publish status */}
              {isOwnGuide && (
                <button
                  onClick={() => handleTogglePublish(expandedGuide)}
                  className={`text-[11px] font-medium flex items-center gap-1 px-2.5 py-1 rounded-full transition-colors ${
                    expandedGuide.is_published
                      ? "bg-sage/10 text-sage"
                      : "bg-surface-200 text-text-500"
                  }`}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {expandedGuide.is_published ? "Published" : t("guides.publish")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Comments bottom sheet */}
        {showCommentsSheet && showComments && !editingGuide && (
          <div className="fixed inset-0 z-30" onClick={() => setShowCommentsSheet(false)}>
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/30" />
            {/* Sheet */}
            <div
              className="absolute bottom-0 left-0 right-0 bg-surface-50 rounded-t-2xl shadow-2xl flex flex-col animate-sheetSlideUp"
              style={{ maxHeight: "75vh" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag handle */}
              <div className="shrink-0 flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 rounded-full bg-surface-300" />
              </div>
              {/* Sheet content */}
              <div className="flex-1 overflow-y-auto px-4 pb-[env(safe-area-inset-bottom)]">
                <PlaybookComments
                  guideId={expandedGuide.id}
                  commentCount={commentCount}
                  readOnly={commentsReadOnly}
                />
              </div>
            </div>
          </div>
        )}

        {/* More actions sheet */}
        {showBottomActions && (
          <div className="fixed inset-0 z-30" onClick={() => setShowBottomActions(false)}>
            <div className="absolute inset-0 bg-black/30" />
            <div
              className="absolute bottom-0 left-0 right-0 bg-surface-50 rounded-t-2xl shadow-2xl animate-sheetSlideUp"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 rounded-full bg-surface-300" />
              </div>
              <div className="px-4 pb-8 space-y-1">
                {isOwnGuide && (
                  <button
                    onClick={() => { setShowBottomActions(false); handleTogglePublish(expandedGuide); }}
                    className="w-full min-h-[48px] flex items-center gap-3 px-3 rounded-xl hover:bg-surface-100 transition-colors"
                  >
                    <svg className="w-5 h-5 text-sage" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm text-text-700">
                      {expandedGuide.is_published ? t("guides.unpublish") || "Unpublish" : t("guides.publish")}
                    </span>
                  </button>
                )}
                {!isOwnGuide && (
                  <button
                    onClick={() => { setShowBottomActions(false); handleUnsave(expandedGuide.id); setExpandedGuide(null); }}
                    className="w-full min-h-[48px] flex items-center gap-3 px-3 rounded-xl hover:bg-surface-100 transition-colors"
                  >
                    <svg className="w-5 h-5 text-text-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <span className="text-sm text-text-700">{t("guides.removeFromWallet")}</span>
                  </button>
                )}
                {isOwnGuide && (
                  <button
                    onClick={() => { setShowBottomActions(false); handleDelete(expandedGuide.id); }}
                    className="w-full min-h-[48px] flex items-center gap-3 px-3 rounded-xl hover:bg-surface-100 transition-colors"
                  >
                    <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <span className="text-sm text-red-600">{t("guides.delete")}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Update published version confirmation modal */}
        {showUpdatePublishedModal && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="mx-4 max-w-sm w-full bg-surface-50 rounded-2xl shadow-xl p-5 space-y-4 animate-scaleIn">
              <h2 className="text-base font-bold text-text-900">Sync to Published Version</h2>
              <p className="text-xs text-text-600 leading-relaxed">
                Push your latest edits to the live version that the community sees. This replaces the published copy.
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
                  Sync Now
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
    const peekCommentCount = ((peekGuide as unknown as Record<string, unknown>).comment_count as number) || 0;

    return (
      <div className="fixed inset-0 z-50 bg-surface-50 flex flex-col animate-fullscreenSlideUp">
        {/* Fixed top bar — translucent */}
        <div
          className="shrink-0 px-3 pt-[env(safe-area-inset-top)] bg-surface-50/90 backdrop-blur-md z-20"
          style={{ borderBottom: `1px solid ${peekGuide.color}20` }}
        >
          <div className="flex items-center gap-2 max-w-2xl mx-auto py-2">
            <button
              onClick={() => { setPeekGuide(null); setPreviewIdx(0); setPreviewChatIdx(null); window.history.pushState({}, "", `/guides?tab=${tab}`); }}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-200 transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5 text-text-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: peekGuide.color }} />
              <h1 className="text-sm font-bold text-text-900 truncate">{peekGuide.title}</h1>
            </div>
            <button
              onClick={() => handleShareGuide(peekGuide)}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-200 transition-colors"
              aria-label="Share"
            >
              {shareCopied ? (
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-text-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Immersive content — fills viewport */}
        <div className="flex-1 min-h-0 flex flex-col">
          {peekGuide.description && (
            <div className="shrink-0 px-4 pt-2 pb-1 max-w-2xl mx-auto w-full">
              <StepMarkdown content={peekGuide.description} className="text-text-500" />
            </div>
          )}

          {/* Read-only step reels — fills remaining space */}
          <div className="flex-1 min-h-0 max-w-2xl mx-auto w-full">
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
                    <div className="bg-white rounded-xl px-3.5 py-3 border border-surface-200/60 shadow-sm">
                      <StepMarkdown content={s.description} />
                      {s.details && (
                        <StepMarkdown content={s.details} className="mt-2 text-text-600 text-[12px]" />
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

                    {previewChatIdx === i && s.chat_prompt && (
                      <div className="bg-white rounded-xl px-3.5 py-3 border border-surface-200/60 shadow-sm">
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
          </div>
        </div>

        {/* Fixed bottom bar — like, comments, save CTA */}
        <div className="shrink-0 pb-[env(safe-area-inset-bottom)] bg-surface-50/90 backdrop-blur-md border-t border-surface-200/60 z-20">
          <div className="flex items-center gap-3 px-4 py-2 max-w-2xl mx-auto">
            {/* Like */}
            <button
              onClick={() => handleToggleLike(peekGuide.id)}
              className={`flex items-center gap-1 text-sm transition-colors ${
                likeStatus[peekGuide.id]?.liked ? "text-red-500" : "text-text-400"
              }`}
            >
              <svg className="w-5 h-5" fill={likeStatus[peekGuide.id]?.liked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              {(likeStatus[peekGuide.id]?.count || 0) > 0 && (
                <span className="text-xs">{likeStatus[peekGuide.id]?.count}</span>
              )}
            </button>

            {/* Comments */}
            <button
              onClick={() => setShowCommentsSheet((v) => !v)}
              className="flex items-center gap-1 text-text-400 transition-colors hover:text-text-600"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {peekCommentCount > 0 && <span className="text-xs">{peekCommentCount}</span>}
            </button>

            <div className="flex-1" />

            {/* Save to wallet CTA */}
            <button
              onClick={() => setShowSaveSheet(true)}
              className="px-4 py-2 min-h-[36px] rounded-full font-semibold text-sm bg-sage text-white hover:bg-sage-dark active:scale-[0.98] transition-all"
            >
              {t("guides.save.cta")}
            </button>
          </div>
        </div>

        {/* Save confirmation bottom sheet */}
        {showSaveSheet && (
          <div className="fixed inset-0 z-30" onClick={() => setShowSaveSheet(false)}>
            <div className="absolute inset-0 bg-black/30" />
            <div
              className="absolute bottom-0 left-0 right-0 bg-surface-50 rounded-t-2xl shadow-2xl animate-sheetSlideUp"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 rounded-full bg-surface-300" />
              </div>
              <div className="px-5 pb-8 space-y-4">
                <h2 className="text-base font-bold text-text-900">{t("guides.save.headline")}</h2>
                <p className="text-xs text-text-600 leading-relaxed">{t("guides.save.description")}</p>
                <ul className="space-y-2.5 text-[12px] text-text-700">
                  <li className="flex items-start gap-2.5">
                    <svg className="w-4 h-4 text-sage shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {t("guides.save.bullet.track")}
                  </li>
                  <li className="flex items-start gap-2.5">
                    <svg className="w-4 h-4 text-sage shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {t("guides.save.bullet.notes")}
                  </li>
                  <li className="flex items-start gap-2.5">
                    <svg className="w-4 h-4 text-sage shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {t("guides.save.bullet.reminders")}
                  </li>
                </ul>
                <button
                  onClick={() => {
                    setShowSaveSheet(false);
                    handleFork(peekGuide.id);
                    setPeekGuide(null);
                    setPreviewIdx(0);
                    setPreviewChatIdx(null);
                  }}
                  className="w-full py-3 min-h-[48px] rounded-xl font-semibold text-sm bg-sage text-white hover:bg-sage-dark active:scale-[0.98] transition-all"
                >
                  {t("guides.save.cta")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Comments bottom sheet */}
        {showCommentsSheet && (
          <div className="fixed inset-0 z-30" onClick={() => setShowCommentsSheet(false)}>
            <div className="absolute inset-0 bg-black/30" />
            <div
              className="absolute bottom-0 left-0 right-0 bg-surface-50 rounded-t-2xl shadow-2xl flex flex-col animate-sheetSlideUp"
              style={{ maxHeight: "75vh" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 rounded-full bg-surface-300" />
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-[env(safe-area-inset-bottom)]">
                <PlaybookComments
                  guideId={peekGuide.id}
                  commentCount={peekCommentCount}
                />
              </div>
            </div>
          </div>
        )}
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
            onClick={() => { setTab("wallet"); window.history.replaceState({}, "", "/guides?tab=wallet"); }}
            className={`flex-1 text-sm font-medium py-2.5 min-h-[44px] rounded-md transition-colors ${
              tab === "wallet"
                ? "bg-surface-50 text-text-900 shadow-sm"
                : "text-text-500 hover:text-text-700"
            }`}
          >
            {t("guides.tab.wallet")}
          </button>
          <button
            onClick={() => { setTab("browse"); window.history.replaceState({}, "", "/guides?tab=browse"); }}
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
                onClick={() => { setTab("browse"); window.history.replaceState({}, "", "/guides?tab=browse"); }}
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
                onTap={() => { setPeekGuide(guide); window.history.pushState({}, "", `/guides?id=${guide.id}&tab=browse`); }}
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
