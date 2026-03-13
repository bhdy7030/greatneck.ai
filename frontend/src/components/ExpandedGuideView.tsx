"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import GuideChecklist from "@/components/GuideChecklist";
import GuideEditor from "@/components/GuideEditor";
import StepMarkdown from "@/components/StepMarkdown";
import PlaybookComments from "@/components/PlaybookComments";
import BottomSheet from "@/components/BottomSheet";
import { type Guide, type RawGuideData } from "@/lib/api";

interface ExpandedGuideViewProps {
  guide: Guide;
  tab: "wallet" | "browse";
  editingGuide: RawGuideData | null;
  editingGuideId: string | null;
  editSaved: boolean;
  likeStatus: Record<string, { liked: boolean; count: number }>;
  returnStepId: string | null;
  onClose: () => void;
  onEditStart: (guideId: string) => void;
  onEditChange: (updated: RawGuideData) => void;
  onEditDone: () => void;
  onDelete: (guideId: string) => void;
  onTogglePublish: (guide: Guide) => void;
  onConfirmPublishToggle: () => void;
  onUpdatePublished: () => void;
  onToggleLike: (guideId: string) => void;
  onShareGuide: (guide: Guide) => void;
  onUnsave: (guideId: string) => void;
}

export default function ExpandedGuideView({
  guide,
  tab,
  editingGuide,
  editingGuideId,
  editSaved,
  likeStatus,
  returnStepId,
  onClose,
  onEditStart,
  onEditChange,
  onEditDone,
  onDelete,
  onTogglePublish,
  onConfirmPublishToggle,
  onUpdatePublished,
  onToggleLike,
  onShareGuide,
  onUnsave,
}: ExpandedGuideViewProps) {
  const { t } = useLanguage();
  const [showCommentsSheet, setShowCommentsSheet] = useState(false);
  const [showBottomActions, setShowBottomActions] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showUpdatePublishedModal, setShowUpdatePublishedModal] = useState(false);
  const [updatePublishedDone, setUpdatePublishedDone] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const isOwnGuide = guide.wallet_category === "published" || guide.wallet_category === "private";
  const commentCount = ((guide as unknown as Record<string, unknown>).comment_count as number) || 0;
  const showComments = (!isOwnGuide || guide.is_published) || (isOwnGuide && !guide.is_published && commentCount > 0);
  const commentsReadOnly = isOwnGuide && !guide.is_published;

  const handleShareGuide = async () => {
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

  const handleTogglePublish = () => {
    setShowPublishModal(true);
  };

  const handleConfirmPublishToggle = () => {
    setShowPublishModal(false);
    onConfirmPublishToggle();
  };

  const handleUpdatePublished = async () => {
    setShowUpdatePublishedModal(false);
    onUpdatePublished();
    setUpdatePublishedDone(true);
    setTimeout(() => setUpdatePublishedDone(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-surface-50 flex flex-col animate-fullscreenSlideUp">
      {/* Fixed top bar -- translucent, compact */}
      <div
        className="shrink-0 px-3 pt-[env(safe-area-inset-top)] bg-surface-50/90 backdrop-blur-md z-20"
        style={{ borderBottom: `1px solid ${guide.color}20` }}
      >
        <div className="flex items-center gap-2 max-w-2xl mx-auto py-2">
          {/* Close */}
          <button
            onClick={() => {
              if (editingGuide) { onEditDone(); return; }
              onClose();
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
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: guide.color }} />
            <h1 className="text-sm font-bold text-text-900 truncate">{guide.title}</h1>
          </div>

          {/* Top-right actions */}
          {isOwnGuide && guide.published_copy_id && !editingGuide && (
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
              onClick={() => onEditStart(guide.id)}
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
          {guide.is_published && !editingGuide && (
            <button
              onClick={handleShareGuide}
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

      {/* Main content -- immersive, fills viewport */}
      <div className="flex-1 min-h-0 flex flex-col">
        {editingGuide ? (
          <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4 max-w-2xl mx-auto w-full">
            <GuideEditor guide={editingGuide} onChange={onEditChange} />
          </div>
        ) : (
          <>
            {/* Description -- compact, above the steps */}
            {guide.description && (
              <div className="shrink-0 px-4 pt-2 pb-1 max-w-2xl mx-auto w-full">
                <StepMarkdown content={guide.description} className="text-text-500" />
              </div>
            )}

            {/* Private hint */}
            {isOwnGuide && !guide.is_published && (
              <div className="shrink-0 mx-4 mb-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50/80 border border-amber-200/40 max-w-2xl">
                <svg className="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <p className="text-[10px] text-amber-700">{t("guides.private.hint")}</p>
              </div>
            )}

            {/* Step reels -- takes remaining space */}
            <div className="flex-1 min-h-0 max-w-2xl mx-auto w-full">
              <GuideChecklist
                guideId={guide.id}
                guideTitle={guide.title}
                steps={guide.steps}
                color={guide.color}
                initialStepId={returnStepId}
              />
            </div>
          </>
        )}
      </div>

      {/* Bottom bar -- like + comments toggle */}
      {!editingGuide && (
        <div
          className="shrink-0 pb-[env(safe-area-inset-bottom)] bg-surface-50/90 backdrop-blur-md border-t border-surface-200/60 z-20"
        >
          <div className="flex items-center gap-3 px-4 py-2 max-w-2xl mx-auto">
            {/* Like */}
            {(!isOwnGuide || guide.is_published) && (
              <button
                onClick={() => onToggleLike(guide.id)}
                className={`flex items-center gap-1 text-sm transition-colors ${
                  likeStatus[guide.id]?.liked ? "text-red-500" : "text-text-400"
                }`}
              >
                <svg className="w-5 h-5" fill={likeStatus[guide.id]?.liked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                {(likeStatus[guide.id]?.count || 0) > 0 && (
                  <span className="text-xs">{likeStatus[guide.id]?.count}</span>
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
                onClick={handleTogglePublish}
                className={`text-[11px] font-medium flex items-center gap-1 px-2.5 py-1 rounded-full transition-colors ${
                  guide.is_published
                    ? "bg-sage/10 text-sage"
                    : "bg-surface-200 text-text-500"
                }`}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {guide.is_published ? "Published" : t("guides.publish")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Comments bottom sheet */}
      <BottomSheet open={showCommentsSheet && showComments && !editingGuide} onClose={() => setShowCommentsSheet(false)}>
        <div className="px-4">
          <PlaybookComments
            guideId={guide.id}
            commentCount={commentCount}
            readOnly={commentsReadOnly}
          />
        </div>
      </BottomSheet>

      {/* More actions sheet */}
      <BottomSheet open={showBottomActions} onClose={() => setShowBottomActions(false)}>
        <div className="px-4 pb-4 space-y-1">
          {isOwnGuide && (
            <button
              onClick={() => { setShowBottomActions(false); handleTogglePublish(); }}
              className="w-full min-h-[48px] flex items-center gap-3 px-3 rounded-xl hover:bg-surface-100 transition-colors"
            >
              <svg className="w-5 h-5 text-sage" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-text-700">
                {guide.is_published ? t("guides.unpublish") || "Unpublish" : t("guides.publish")}
              </span>
            </button>
          )}
          {!isOwnGuide && (
            <button
              onClick={() => { setShowBottomActions(false); onUnsave(guide.id); onClose(); }}
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
              onClick={() => { setShowBottomActions(false); onDelete(guide.id); }}
              className="w-full min-h-[48px] flex items-center gap-3 px-3 rounded-xl hover:bg-surface-100 transition-colors"
            >
              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span className="text-sm text-red-600">{t("guides.delete")}</span>
            </button>
          )}
        </div>
      </BottomSheet>

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
              {guide.is_published ? t("guides.unpublish.confirm.title") : t("guides.publish.confirm.title")}
            </h2>
            <p className="text-xs text-text-600 leading-relaxed">
              {guide.is_published ? t("guides.unpublish.confirm.description") : t("guides.publish.confirm.description")}
            </p>

            {!guide.is_published && (
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
                {guide.is_published ? t("guides.unpublish.confirm.cancel") : t("guides.publish.confirm.cancel")}
              </button>
              <button
                onClick={handleConfirmPublishToggle}
                className="flex-1 py-2.5 min-h-[44px] rounded-xl text-xs font-semibold bg-sage text-white hover:bg-sage-dark transition-colors"
              >
                {guide.is_published ? t("guides.unpublish.confirm.ok") : t("guides.publish.confirm.ok")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
