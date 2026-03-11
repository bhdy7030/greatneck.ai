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
  const [direction, setDirection] = useState<"up" | "down" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pointerStartY = useRef<number | null>(null);

  const accentColor = color || "rgb(var(--color-sage))";
  const total = steps.length;
  const step = steps[activeIdx];

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

  // Swipe handling
  const onPointerDown = (e: React.PointerEvent) => {
    pointerStartY.current = e.clientY;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (pointerStartY.current === null) return;
    const deltaY = pointerStartY.current - e.clientY;
    pointerStartY.current = null;
    if (Math.abs(deltaY) < 50) return;
    navigate(activeIdx + (deltaY > 0 ? 1 : -1));
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
      className="relative overflow-hidden outline-none"
      style={
        mode === "full"
          ? { maxHeight: "calc(100vh - 220px)" }
          : { minHeight: "320px" }
      }
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {/* Active card */}
      <div
        key={activeIdx}
        className={`rounded-2xl overflow-hidden ${animClass}`}
        style={{
          border: `1.5px solid ${accentColor}`,
          boxShadow:
            "0 20px 60px rgba(0,0,0,0.12), 0 8px 20px rgba(0,0,0,0.06)",
          background: `linear-gradient(160deg, rgb(var(--color-surface-50)) 60%, ${accentColor}0a)`,
          maxHeight: mode === "full" ? "100%" : undefined,
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

        {/* Content area — scrollable in full mode */}
        <div
          className={`px-4 pb-4 ${
            mode === "full" ? "overflow-y-auto flex-1 min-h-0" : ""
          }`}
        >
          {renderContent(activeIdx)}
        </div>
      </div>

      {/* Prev / Next navigation bar */}
      <div className="flex items-center justify-between px-2 py-2.5 mt-2">
        {activeIdx > 0 ? (
          <button
            onClick={() => navigate(activeIdx - 1)}
            className="flex items-center gap-1 text-[12px] font-medium text-text-600 hover:text-text-800 px-3 py-2 rounded-lg hover:bg-surface-200 transition-colors min-h-[44px]"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Prev
          </button>
        ) : (
          <div className="w-16" />
        )}

        <span className="text-[11px] text-text-500 font-medium">
          Step {activeIdx + 1} of {total}
        </span>

        {activeIdx < total - 1 ? (
          <button
            onClick={() => navigate(activeIdx + 1)}
            className="flex items-center gap-1 text-[12px] font-medium text-text-600 hover:text-text-800 px-3 py-2 rounded-lg hover:bg-surface-200 transition-colors min-h-[44px]"
          >
            Next
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        ) : (
          <div className="w-16" />
        )}
      </div>
    </div>
  );
}
