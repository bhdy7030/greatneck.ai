"use client";

import type { PipelineEvent } from "@/lib/api";

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
        <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse flex-shrink-0" />
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
        <span className={hasResults ? "text-sage" : "text-red-400"}>
          {hasResults ? "found results" : "no results"}
        </span>
        {isWebSearch && hasResults && (
          <span className="text-gold text-[10px]">web</span>
        )}
      </div>
    );
  }

  return null;
}

function StepItem({ event }: { event: PipelineEvent }) {
  const icon = STAGE_ICONS[event.stage || ""] || "?";
  const colorClass = STAGE_COLORS[event.status || ""] || "text-text-500";
  const isRunning = event.status === "running";

  return (
    <div className="flex items-start gap-2 py-1">
      {/* Stage icon */}
      <div
        className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 ${
          isRunning
            ? "bg-gold/15 text-gold animate-pulse"
            : event.status === "done"
            ? "bg-sage/10 text-sage"
            : "bg-surface-200 text-text-500"
        }`}
      >
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-medium ${colorClass}`}>
          {event.label}
          {isRunning && (
            <span className="inline-block ml-1 animate-pulse">...</span>
          )}
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
  if (events.length === 0) return null;

  const steps = events.filter((e) => e.type === "step");
  const toolEvents = events.filter((e) => e.type === "tool");

  // Group tool events by their position relative to steps
  // Find the specialist step index to know where to insert tool events
  const specialistIdx = steps.findIndex(
    (s) => s.stage === "specialist" && s.status === "running"
  );
  const retryIdx = steps.findIndex(
    (s) => s.stage === "retry" && s.status === "running"
  );

  return (
    <div className="bg-surface-200/60 border border-surface-300 rounded-xl px-3 py-2 mb-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <svg
          className="w-3.5 h-3.5 text-text-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 10V3L4 14h7v7l9-11h-7z"
          />
        </svg>
        <span className="text-[10px] text-text-500 uppercase tracking-wider font-semibold">
          Pipeline
        </span>
        {!isComplete && (
          <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />
        )}
      </div>

      <div className="space-y-0">
        {steps.map((step, i) => (
          <div key={`${step.stage}-${step.status}-${i}`}>
            <StepItem event={step} />
            {/* Show tool events after the specialist running step */}
            {step.stage === "specialist" &&
              step.status === "running" &&
              toolEvents
                .filter((t) => !t.retry)
                .map((te, j) => <ToolCallItem key={`tool-${j}`} event={te} />)}
            {/* Show retry tool events */}
            {step.stage === "retry" &&
              step.status === "running" &&
              toolEvents
                .filter((t) => t.retry)
                .map((te, j) => (
                  <ToolCallItem key={`retry-tool-${j}`} event={te} />
                ))}
          </div>
        ))}
      </div>
    </div>
  );
}
