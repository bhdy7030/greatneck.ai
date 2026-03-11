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
}

export default function StepReels({
  steps,
  activeIdx,
  color,
  mode,
  onNav,
  renderContent,
}: StepReelsProps) {
  const [direction, setDirection] = useState<"left" | "right" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const accentColor = color || "rgb(var(--color-sage))";
  const total = steps.length;
  const step = steps[activeIdx];

  const navigate = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= total || idx === activeIdx) return;
      setDirection(idx > activeIdx ? "left" : "right");
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

  // Keyboard navigation
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

  // Horizontal swipe — doesn't block vertical scrolling
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const deltaX = touchStartX.current - e.changedTouches[0].clientX;
    const deltaY = touchStartY.current - e.changedTouches[0].clientY;
    touchStartX.current = null;
    touchStartY.current = null;
    // Only trigger if horizontal swipe is dominant and exceeds threshold
    if (Math.abs(deltaX) < 50 || Math.abs(deltaY) > Math.abs(deltaX)) return;
    navigate(activeIdx + (deltaX > 0 ? 1 : -1)); // swipe left = next, swipe right = prev
  };

  const animClass =
    direction === "left"
      ? "animate-reelSlideLeft"
      : direction === "right"
      ? "animate-reelSlideRight"
      : "";

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col outline-none"
      tabIndex={0}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Card area — sizes to content */}
      <div className="overflow-hidden">
        <div
          key={activeIdx}
          className={`rounded-2xl overflow-hidden ${animClass}`}
          style={{
            border: `1.5px solid ${accentColor}`,
            boxShadow:
              "0 20px 60px rgba(0,0,0,0.12), 0 8px 20px rgba(0,0,0,0.06)",
            background: `linear-gradient(160deg, rgb(var(--color-surface-50)) 60%, ${accentColor}0a)`,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Accent strip */}
          <div
            className="h-[4px] w-full shrink-0"
            style={{
              background: `linear-gradient(90deg, ${accentColor}, ${accentColor}99)`,
            }}
          />

          {/* Card header */}
          <div className="px-4 pt-3 pb-2 shrink-0">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors duration-200"
                style={{
                  backgroundColor:
                    step.status === "done"
                      ? accentColor
                      : step.status === "in_progress"
                      ? "rgb(245 158 11)"
                      : undefined,
                  color:
                    step.status === "done" || step.status === "in_progress"
                      ? "white"
                      : undefined,
                  border:
                    step.status !== "done" && step.status !== "in_progress"
                      ? "2px solid rgb(var(--color-surface-300))"
                      : undefined,
                }}
              >
                {step.status === "done" ? (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : step.status === "in_progress" ? (
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
                  </span>
                ) : (
                  <span className="text-text-600">{activeIdx + 1}</span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <span
                  className={`text-[14px] font-semibold block ${
                    step.status === "done" || step.status === "skipped"
                      ? "text-text-500 line-through"
                      : "text-text-900"
                  }`}
                >
                  {step.title}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {step.priority === "high" && step.status !== "done" && (
                  <span className="text-[9px] font-bold uppercase tracking-wide text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                    Priority
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Content area */}
          <div className="px-4 pb-4">
            {renderContent(activeIdx)}
          </div>
        </div>
      </div>

      {/* Bottom nav: < [progress segments] > */}
      <div className="shrink-0 flex items-center gap-1.5 pt-3 pb-1 px-1">
        {/* Prev arrow */}
        <button
          onClick={() => navigate(activeIdx - 1)}
          disabled={activeIdx === 0}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full transition-colors active:bg-surface-200 disabled:opacity-20"
          aria-label="Previous step"
        >
          <svg className="w-4 h-4 text-text-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Progress segments */}
        <div className="flex items-center gap-1 flex-1">
          {steps.map((s, i) => {
            const isActive = i === activeIdx;
            let bgColor = "rgb(var(--color-surface-300))";
            if (s.status === "done") bgColor = accentColor;
            else if (s.status === "in_progress") bgColor = "rgb(245 158 11)";
            else if (s.status === "skipped") bgColor = "rgb(var(--color-surface-400))";
            return (
              <button
                key={s.id}
                onClick={() => onNav(i)}
                className={`flex-1 rounded-full transition-all duration-200 min-h-[28px] ${
                  isActive
                    ? "h-2.5 opacity-100"
                    : "h-1.5 opacity-50 hover:opacity-80"
                }`}
                style={{ backgroundColor: bgColor }}
                aria-label={`Step ${i + 1}`}
              />
            );
          })}
        </div>

        {/* Next arrow */}
        <button
          onClick={() => navigate(activeIdx + 1)}
          disabled={activeIdx >= total - 1}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full transition-colors active:bg-surface-200 disabled:opacity-20"
          aria-label="Next step"
        >
          <svg className="w-4 h-4 text-text-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
