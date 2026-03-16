"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { GuideStep } from "@/lib/api";

interface StepReelsProps {
  steps: GuideStep[];
  activeIdx: number;
  color?: string;
  mode: "full" | "fit";
  onNav: (idx: number) => void;
  renderContent: (idx: number) => React.ReactNode;
  /** If set, this index is an overview page (not counted in step numbers) */
  overviewIndex?: number;
}

export default function StepReels({
  steps,
  activeIdx,
  color,
  mode,
  onNav,
  renderContent,
  overviewIndex,
}: StepReelsProps) {
  const [direction, setDirection] = useState<"up" | "down" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);

  const accentColor = color || "rgb(var(--color-sage))";
  const total = steps.length;
  const step = steps[activeIdx];
  const isOverview = overviewIndex !== undefined && activeIdx === overviewIndex;
  const realStepCount = overviewIndex !== undefined ? total - 1 : total;
  const displayStepNum = overviewIndex !== undefined && activeIdx > overviewIndex ? activeIdx : activeIdx + 1;

  const navigate = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= total || idx === activeIdx) return;
      setDirection(idx > activeIdx ? "up" : "down");
      onNav(idx);
    },
    [activeIdx, total, onNav]
  );

  // Reset direction after animation
  useEffect(() => {
    if (direction === null) return;
    const timer = setTimeout(() => setDirection(null), 300);
    return () => clearTimeout(timer);
  }, [direction, activeIdx]);

  // Keyboard navigation (up/down like reels)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        navigate(activeIdx + (e.key === "ArrowDown" ? 1 : -1));
      }
    };
    el.addEventListener("keydown", handleKey);
    return () => el.removeEventListener("keydown", handleKey);
  }, [activeIdx, navigate]);

  // Vertical swipe — navigate between steps when at scroll boundaries
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null || touchStartX.current === null) return;
    const deltaY = touchStartY.current - e.changedTouches[0].clientY;
    const deltaX = touchStartX.current - e.changedTouches[0].clientX;
    touchStartY.current = null;
    touchStartX.current = null;
    // Only trigger if vertical swipe is dominant and exceeds threshold
    if (Math.abs(deltaY) < 60 || Math.abs(deltaX) > Math.abs(deltaY)) return;

    // Check if content is scrolled to boundary
    const content = contentRef.current;
    if (content) {
      const atTop = content.scrollTop <= 5;
      const atBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 5;
      if (deltaY > 0 && !atBottom) return; // swiping up but not at bottom — let scroll
      if (deltaY < 0 && !atTop) return;    // swiping down but not at top — let scroll
    }

    navigate(activeIdx + (deltaY > 0 ? 1 : -1)); // swipe up = next, swipe down = prev
  };

  const animClass =
    direction === "up"
      ? "animate-reelSlideUp"
      : direction === "down"
      ? "animate-reelSlideDown"
      : "";

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col h-full outline-none"
      tabIndex={0}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Step header — compact, inside the content flow */}
      <div className="shrink-0 px-4 pt-3 pb-2 flex items-center gap-3">
        {/* Step number circle */}
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors duration-200"
          style={{
            backgroundColor: isOverview
              ? accentColor
              : step.status === "done"
                ? accentColor
                : step.status === "in_progress"
                ? "rgb(245 158 11)"
                : undefined,
            color: isOverview || step.status === "done" || step.status === "in_progress"
              ? "white"
              : undefined,
            border: !isOverview && step.status !== "done" && step.status !== "in_progress"
              ? "2px solid rgb(var(--color-surface-300))"
              : undefined,
          }}
        >
          {isOverview ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : step.status === "done" ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          ) : step.status === "in_progress" ? (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
            </span>
          ) : (
            <span className="text-text-600 text-xs">{displayStepNum}</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <span
            className={`text-[15px] font-semibold block leading-tight ${
              !isOverview && (step.status === "done" || step.status === "skipped")
                ? "text-text-500 line-through"
                : "text-text-900"
            }`}
          >
            {step.title}
          </span>
          <span className="text-[11px] text-text-400">
            {isOverview ? `${realStepCount} steps` : `Step ${displayStepNum} of ${realStepCount}`}
          </span>
        </div>

        {step.priority === "high" && step.status !== "done" && (
          <span className="text-[9px] font-bold uppercase tracking-wide text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded-full">
            Priority
          </span>
        )}
      </div>

      {/* Scrollable content area — fills remaining space */}
      <div
        ref={contentRef}
        className="flex-1 overflow-y-auto px-4 pb-4"
      >
        <div key={activeIdx} className={animClass}>
          {renderContent(activeIdx)}
        </div>
      </div>

      {/* Thin vertical progress indicator — right edge */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col items-center gap-[3px] z-10">
        {steps.map((s, i) => {
          const isActive = i === activeIdx;
          let bgColor = "rgb(var(--color-surface-400))";
          if (s.status === "done") bgColor = accentColor;
          else if (s.status === "in_progress") bgColor = "rgb(245 158 11)";
          else if (isActive) bgColor = "rgb(var(--color-text-500))";
          return (
            <button
              key={s.id}
              onClick={() => onNav(i)}
              className="transition-all duration-200 rounded-full"
              style={{
                backgroundColor: bgColor,
                width: "5px",
                height: isActive ? "24px" : "10px",
                opacity: 1,
                boxShadow: isActive ? `0 0 8px ${bgColor}` : undefined,
              }}
              aria-label={`Step ${i + 1}`}
            />
          );
        })}
      </div>
    </div>
  );
}
