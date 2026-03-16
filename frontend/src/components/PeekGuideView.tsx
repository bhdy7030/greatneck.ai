"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import StepReels from "@/components/StepReels";
import StepInlineChat from "@/components/StepInlineChat";
import StepMarkdown from "@/components/StepMarkdown";
import PlaybookComments from "@/components/PlaybookComments";
import BottomSheet from "@/components/BottomSheet";
import { type Guide } from "@/lib/api";

interface PeekGuideViewProps {
  guide: Guide;
  tab: "wallet" | "browse";
  likeStatus: Record<string, { liked: boolean; count: number }>;
  onClose: () => void;
  onFork: (guideId: string) => void;
  onToggleLike: (guideId: string) => void;
  onShareGuide: (guide: Guide) => void;
}

export default function PeekGuideView({
  guide,
  tab,
  likeStatus,
  onClose,
  onFork,
  onToggleLike,
  onShareGuide,
}: PeekGuideViewProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const [previewIdx, setPreviewIdx] = useState(0);
  const [previewChatIdx, setPreviewChatIdx] = useState<number | null>(null);
  const [showCommentsSheet, setShowCommentsSheet] = useState(false);
  const [showSaveSheet, setShowSaveSheet] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  const peekCommentCount = ((guide as unknown as Record<string, unknown>).comment_count as number) || 0;

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

  return (
    <div className="fixed inset-0 z-50 bg-surface-50 flex flex-col animate-fullscreenSlideUp">
      {/* Fixed top bar -- translucent */}
      <div
        className="shrink-0 px-3 pt-[env(safe-area-inset-top)] bg-surface-50/85 backdrop-blur-lg z-20"
        style={{ borderBottom: `1px solid ${guide.color}15` }}
      >
        <div className="flex items-center gap-2.5 max-w-2xl mx-auto py-2.5">
          <button
            onClick={() => { onClose(); setPreviewIdx(0); setPreviewChatIdx(null); }}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl hover:bg-surface-200/60 active:bg-surface-300/60 transition-all duration-200"
            aria-label="Close"
          >
            <svg className="w-5 h-5 text-text-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0" onClick={() => setDescExpanded(!descExpanded)}>
            <div className="flex items-center gap-2 cursor-pointer">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: guide.color }} />
              <h1 className={`text-sm font-bold text-text-900 leading-tight ${descExpanded ? "" : "truncate"}`}>{guide.title}</h1>
              <svg className={`w-3 h-3 text-text-400 shrink-0 transition-transform ${descExpanded ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            {guide.author_handle && (
              <a href={`/profile/?h=${guide.author_handle}`} onClick={(e) => e.stopPropagation()} className="text-[10px] text-text-400 hover:text-sage ml-4">
                by @{guide.author_handle}
              </a>
            )}
          </div>
          <button
            onClick={handleShareGuide}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl hover:bg-surface-200/60 transition-all duration-200"
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

      {/* Immersive content -- fills viewport */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Collapsible description — toggled from top bar */}
        {guide.description && descExpanded && (
          <div className="shrink-0 px-4 pt-1.5 pb-1 max-w-2xl mx-auto w-full animate-fadeIn">
            <StepMarkdown content={guide.description} className="text-text-500 text-[12px]" />
          </div>
        )}

        {/* Read-only step reels -- fills remaining space */}
        <div className="flex-1 min-h-0 max-w-2xl mx-auto w-full">
          <StepReels
            steps={guide.steps}
            activeIdx={previewIdx}
            color={guide.color}
            mode="fit"
            onNav={setPreviewIdx}
            renderContent={(i) => {
              const s = guide.steps[i];
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
                        guideTitle={guide.title}
                        stepDescription={s.description}
                        stepDetails={s.details}
                        guideId={guide.id}
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
                      className="w-full min-h-[40px] text-[12px] font-medium rounded-full text-sage hover:text-sage-dark flex items-center justify-center gap-1.5 transition-colors hover:bg-sage/5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      Ask about this step
                    </button>
                  )}
                </div>
              );
            }}
          />
        </div>
      </div>

      {/* Fixed bottom bar -- floating pill style */}
      <div
        className="shrink-0 px-3 z-20"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div
          className="flex items-center gap-3 px-4 py-2.5 max-w-2xl mx-auto rounded-full bg-white"
          style={{
            boxShadow: "0 8px 24px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)",
            border: "1px solid rgba(0,0,0,0.05)",
          }}>
          {/* Like */}
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
            className="px-5 py-2.5 min-h-[36px] rounded-full font-semibold text-sm bg-sage text-white hover:bg-sage-dark active:scale-[0.97] transition-all duration-200 shadow-sm shadow-sage/15"
          >
            {t("guides.save.cta")}
          </button>
        </div>
      </div>

      {/* Save confirmation bottom sheet */}
      <BottomSheet open={showSaveSheet} onClose={() => setShowSaveSheet(false)}>
        <div className="px-5 pb-4 space-y-4">
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
              onFork(guide.id);
              onClose();
            }}
            className="w-full py-3 min-h-[48px] rounded-full font-semibold text-sm bg-sage text-white hover:bg-sage-dark active:scale-[0.98] transition-all"
          >
            {t("guides.save.cta")}
          </button>
        </div>
      </BottomSheet>

      {/* Comments bottom sheet */}
      <BottomSheet open={showCommentsSheet} onClose={() => setShowCommentsSheet(false)}>
        <div className="px-4">
          <PlaybookComments
            guideId={guide.id}
            commentCount={peekCommentCount}
          />
        </div>
      </BottomSheet>
    </div>
  );
}
