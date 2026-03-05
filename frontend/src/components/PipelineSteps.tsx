"use client";

import { useState } from "react";
import type { PipelineEvent } from "@/lib/api";
import { useLanguage } from "./LanguageProvider";

interface PipelineStepsProps {
  events: PipelineEvent[];
  isComplete: boolean;
}

const STAGE_ICONS: Record<string, string> = {
  router: "R",
  planner: "P",
  specialist: "S",
  critic: "C",
  retry: "!",
  critic2: "C",
};

const STAGE_COLORS: Record<string, string> = {
  running: "text-gold",
  done: "text-sage",
  skipped: "text-text-500",
};

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        className="opacity-20"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ToolCallItem({ event }: { event: PipelineEvent }) {
  const isWebSearch = event.tool === "web_search";
  const hasResults = event.has_results !== false;
  const isResult = event.type === "tool" && event.preview !== undefined;
  const isCall = event.type === "tool" && event.preview === undefined;

  if (isCall) {
    const queryArg =
      event.args?.query || event.args?.project_type || event.args?.section_id || "";
    return (
      <div className="flex items-center gap-2 text-xs text-text-500 pl-8 py-0.5">
        <Spinner className="w-3 h-3 text-gold flex-shrink-0" />
        <span className="font-mono text-text-500">{event.tool}</span>
        {queryArg && (
          <span className="text-text-500 truncate max-w-[300px]">
            &quot;{queryArg}&quot;
          </span>
        )}
        {event.retry && (
          <span className="text-gold-dark text-[10px] font-medium">(retry)</span>
        )}
      </div>
    );
  }

  if (isResult) {
    return (
      <div className="flex items-center gap-2 text-xs pl-8 py-0.5">
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            hasResults ? "bg-sage" : "bg-red-400"
          }`}
        />
        <span className="font-mono text-text-500">{event.tool}</span>
        <ToolResultLabel hasResults={hasResults} />
        {isWebSearch && hasResults && (
          <span className="text-gold text-[10px]">web</span>
        )}
      </div>
    );
  }

  return null;
}

function ToolResultLabel({ hasResults }: { hasResults: boolean }) {
  const { t } = useLanguage();
  return (
    <span className={hasResults ? "text-sage" : "text-red-400"}>
      {hasResults ? t("pipeline.foundResults") : t("pipeline.noResults")}
    </span>
  );
}

function StepItem({ event }: { event: PipelineEvent }) {
  const icon = STAGE_ICONS[event.stage || ""] || "?";
  const colorClass = STAGE_COLORS[event.status || ""] || "text-text-500";
  const isRunning = event.status === "running";

  return (
    <div className="flex items-start gap-2 py-1">
      {/* Stage icon */}
      {isRunning ? (
        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5 text-gold">
          <Spinner className="w-4 h-4" />
        </div>
      ) : (
        <div
          className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 ${
            event.status === "done"
              ? "bg-sage/10 text-sage"
              : "bg-surface-200 text-text-500"
          }`}
        >
          {event.status === "done" ? (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            icon
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-medium ${colorClass}`}>
          {event.label}
        </div>
        {event.detail && (
          <div className="text-[11px] text-text-500 truncate">
            {event.detail}
          </div>
        )}
        {/* Show planned search steps */}
        {event.plan && (
          <div className="mt-1 space-y-0.5">
            {event.plan.steps.map((s, i) => (
              <div key={i} className="text-[10px] text-text-500 pl-2 font-mono">
                {s.tool}(&quot;{s.query}&quot;)
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PipelineSteps({ events, isComplete }: PipelineStepsProps) {
  const [expanded, setExpanded] = useState(!isComplete);
  const { t } = useLanguage();

  if (events.length === 0) return null;

  // Deduplicate steps: keep only the latest event per stage
  // (e.g., when "router: running" is followed by "router: done", show only "done")
  const allSteps = events.filter((e) => e.type === "step");
  const stepsByStage = new Map<string, PipelineEvent>();
  for (const s of allSteps) {
    const key = s.stage || "";
    stepsByStage.set(key, s);
  }
  const steps = Array.from(stepsByStage.values());
  const toolEvents = events.filter((e) => e.type === "tool");
  const totalSteps = steps.filter((s) => s.status === "done").length;
  const toolCount = toolEvents.filter((te) => te.preview !== undefined && te.has_results !== false).length;

  // Determine header label
  const hasSearches = toolEvents.length > 0;
  const headerLabel = isComplete
    ? hasSearches
      ? t("pipeline.researched", { steps: totalSteps, searches: toolCount })
      : t("pipeline.thought", { steps: totalSteps })
    : hasSearches
    ? t("pipeline.researching")
    : t("pipeline.thinking");

  return (
    <div className="bg-surface-200/60 border border-surface-300 rounded-xl px-3 py-2 mb-3">
      {/* Clickable header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 text-left"
      >
        {isComplete ? (
          <svg
            className="w-3.5 h-3.5 text-sage"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        ) : (
          <Spinner className="w-3.5 h-3.5 text-gold" />
        )}
        <span className={`text-[11px] font-medium flex-1 ${isComplete ? "text-text-500" : "text-gold"}`}>
          {headerLabel}
        </span>
        <svg
          className={`w-3 h-3 text-text-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expandable content */}
      {expanded && (
        <div className="mt-1.5 space-y-0">
          {steps.map((step, i) => (
            <div key={`${step.stage}-${step.status}-${i}`}>
              <StepItem event={step} />
              {/* Show tool events under the specialist step */}
              {step.stage === "specialist" &&
                toolEvents
                  .filter((t) => !t.retry)
                  .map((te, j) => <ToolCallItem key={`tool-${j}`} event={te} />)}
              {/* Show retry tool events under the retry step */}
              {step.stage === "retry" &&
                toolEvents
                  .filter((t) => t.retry)
                  .map((te, j) => (
                    <ToolCallItem key={`retry-tool-${j}`} event={te} />
                  ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
