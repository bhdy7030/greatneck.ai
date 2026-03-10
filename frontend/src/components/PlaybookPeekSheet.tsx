"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import type { Guide } from "@/lib/api";

const ICONS: Record<string, string> = {
  home: "\u{1F3E0}",
  snowflake: "\u{2744}\u{FE0F}",
  flower: "\u{1F338}",
  sun: "\u{2600}\u{FE0F}",
  leaf: "\u{1F342}",
};

const MAX_PREVIEW_STEPS = 4;

interface PlaybookPeekSheetProps {
  guide: Guide;
  onClose: () => void;
  onSave: (id: string) => void;
  onFork?: (id: string) => void;
}

export default function PlaybookPeekSheet({
  guide,
  onClose,
  onSave,
  onFork,
}: PlaybookPeekSheetProps) {
  const { t } = useLanguage();
  const [closing, setClosing] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const emoji = ICONS[guide.icon] || "\u{1F4CB}";
  const previewSteps = guide.steps.slice(0, MAX_PREVIEW_STEPS);
  const remainingCount = guide.steps.length - MAX_PREVIEW_STEPS;

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const dismiss = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 280);
  }, [onClose]);

  // Swipe-to-dismiss
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragStartY.current = e.clientY;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragStartY.current === null) return;
    const delta = e.clientY - dragStartY.current;
    if (delta > 0) setDragOffset(delta);
  }, []);

  const handlePointerUp = useCallback(() => {
    if (dragOffset > 120) {
      dismiss();
    }
    setDragOffset(0);
    dragStartY.current = null;
  }, [dragOffset, dismiss]);

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center ${
        closing ? "animate-backdropFadeOut" : "animate-backdropFadeIn"
      }`}
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        ref={sheetRef}
        className={`relative w-full max-w-lg bg-surface-50 rounded-t-2xl shadow-2xl max-h-[70vh] overflow-y-auto ${
          closing ? "animate-peekSheetDown" : "animate-peekSheetUp"
        }`}
        style={{
          transform: dragOffset > 0 ? `translateY(${dragOffset}px)` : undefined,
          transition: dragOffset > 0 ? "none" : undefined,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Drag handle */}
        <div className="sticky top-0 bg-surface-50 pt-3 pb-2 flex justify-center z-10 rounded-t-2xl">
          <div className="w-10 h-1 rounded-full bg-surface-400" />
        </div>

        <div className="px-5 pb-6">
          {/* Color bar */}
          <div
            className="h-1.5 rounded-full mb-4"
            style={{ backgroundColor: guide.color }}
          />

          {/* Header */}
          <div className="flex items-start gap-3 mb-4">
            <span className="text-3xl">{emoji}</span>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-text-900 leading-tight">
                {guide.title}
              </h2>
              <p className="text-xs text-text-500 mt-1">{guide.description}</p>
            </div>
          </div>

          {/* Steps preview */}
          <h3 className="text-[10px] font-semibold text-text-500 uppercase tracking-wider mb-3">
            {t("guides.peek.stepsPreview")}
          </h3>
          <div className="space-y-2.5 mb-4">
            {previewSteps.map((step, i) => (
              <div key={step.id} className="flex items-start gap-2.5">
                <span
                  className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ backgroundColor: guide.color }}
                >
                  {i + 1}
                </span>
                <span className="text-sm text-text-800 leading-snug pt-0.5">
                  {step.title}
                </span>
              </div>
            ))}
          </div>
          {remainingCount > 0 && (
            <p className="text-xs text-text-500 mb-5 pl-9">
              +{remainingCount} {t("guides.peek.moreSteps")}
            </p>
          )}

          {/* CTAs */}
          <div className="space-y-2">
            <button
              onClick={() => {
                if (!guide.saved) onSave(guide.id);
              }}
              disabled={guide.saved}
              className={`w-full py-3 min-h-[44px] rounded-xl font-semibold text-sm transition-colors ${
                guide.saved
                  ? "bg-surface-200 text-text-500 cursor-default"
                  : "bg-sage text-white hover:bg-sage-dark"
              }`}
            >
              {guide.saved
                ? t("guides.peek.alreadySaved") + " \u2713"
                : t("guides.peek.addToMine")}
            </button>
            {onFork && (
              <button
                onClick={() => onFork(guide.id)}
                className="w-full py-3 min-h-[44px] rounded-xl font-medium text-sm border border-sage/30 text-sage hover:bg-sage/5 transition-colors"
              >
                {t("guides.fork")}
                <span className="text-xs text-text-500 ml-1.5">
                  {t("guides.fork.description")}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
