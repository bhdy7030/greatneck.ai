"use client";

import { useState, useMemo } from "react";
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

// --- Merged tool operation model ---

interface ToolOp {
  tool: string;
  args: Record<string, string>;
  status: "running" | "done" | "empty";
  retry?: boolean;
}

/** Build a natural-language description of what the tool is doing */
function toolRunningLabel(tool: string, args: Record<string, string>): string {
  const query = args.query || args.project_type || "";
  const sectionId = args.section_id || "";

  switch (tool) {
    case "search_codes":
      return query
        ? `Looking up \u201c${query}\u201d in village codes`
        : "Looking up village codes";
    case "search_permits":
      return query
        ? `Searching permits for \u201c${query}\u201d`
        : "Searching permits";
    case "web_search":
      return query
        ? `Searching the web for \u201c${query}\u201d`
        : "Searching the web";
    case "search_social":
      return query
        ? `Checking local discussions for \u201c${query}\u201d`
        : "Checking local discussions";
    case "search_community":
      return query
        ? `Searching community info for \u201c${query}\u201d`
        : "Searching community info";
    case "get_code_section":
      return sectionId
        ? `Reading code section ${sectionId}`
        : "Reading code section";
    default:
      return query ? `Searching for \u201c${query}\u201d` : "Searching";
  }
}

/** Build a friendly done label */
function toolDoneLabel(tool: string): string {
  switch (tool) {
    case "search_codes":
      return "Found relevant code sections";
    case "search_permits":
      return "Found permit information";
    case "web_search":
      return "Found web results";
    case "search_social":
      return "Found local discussions";
    case "search_community":
      return "Found community info";
    case "get_code_section":
      return "Loaded code section";
    default:
      return "Found results";
  }
}

function toolEmptyLabel(tool: string): string {
  switch (tool) {
    case "search_codes":
      return "No matching code sections";
    case "search_permits":
      return "No matching permits";
    case "web_search":
      return "No web results";
    case "search_social":
      return "No local discussions found";
    case "search_community":
      return "No community info found";
    case "get_code_section":
      return "Code section not found";
    default:
      return "No results found";
  }
}

/** Merge sequential tool_call + tool_result events into ToolOps */
function buildToolOps(toolEvents: PipelineEvent[]): ToolOp[] {
  const ops: ToolOp[] = [];

  for (const ev of toolEvents) {
    const isResult = ev.type === "tool_result" || (ev.type === "tool" && ev.preview !== undefined);
    if (!isResult) {
      // tool_call — create a new running op
      ops.push({
        tool: ev.tool || "",
        args: ev.args || {},
        status: "running",
        retry: ev.retry,
      });
    } else {
      // tool_result — find the latest matching running op and update it
      for (let i = ops.length - 1; i >= 0; i--) {
        if (ops[i].tool === ev.tool && ops[i].status === "running") {
          ops[i].status = ev.has_results !== false ? "done" : "empty";
          break;
        }
      }
    }
  }

  return ops;
}

function ToolOpItem({ op }: { op: ToolOp }) {
  const label = toolRunningLabel(op.tool, op.args);

  if (op.status === "running") {
    return (
      <div className="flex items-center gap-2 text-xs text-text-500 pl-8 py-0.5">
        <Spinner className="w-3 h-3 text-gold flex-shrink-0" />
        <span className="truncate">{label}...</span>
      </div>
    );
  }

  const found = op.status === "done";
  return (
    <div className="flex items-center gap-2 text-xs pl-8 py-0.5">
      <span className={`text-sm flex-shrink-0 ${found ? "text-sage" : "text-red-400"}`}>
        {found ? "✓" : "✗"}
      </span>
      <span className="text-text-500 truncate">{label}</span>
      <span className={`flex-shrink-0 ${found ? "text-sage" : "text-red-400"}`}>
        {found ? "— found results" : "— no results"}
      </span>
    </div>
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
        {event.plan && event.plan.steps && (
          <div className="mt-1 space-y-0.5">
            {event.plan.steps.map((s: { tool: string; query: string }, i: number) => (
              <div key={i} className="text-[10px] text-text-500 pl-2">
                {toolRunningLabel(s.tool, { query: s.query })}
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

  const toolEvents = useMemo(() => events.filter((e) => e.type === "tool_call" || e.type === "tool_result" || e.type === "tool"), [events]);
  const toolOps = useMemo(() => buildToolOps(toolEvents), [toolEvents]);

  if (events.length === 0) return null;

  // Deduplicate steps: keep only the latest event per stage
  const allSteps = events.filter((e) => e.type === "step");
  const stepsByStage = new Map<string, PipelineEvent>();
  for (const s of allSteps) {
    stepsByStage.set(s.stage || "", s);
  }
  const steps = Array.from(stepsByStage.values());
  const totalSteps = steps.filter((s) => s.status === "done").length;
  const toolCount = toolOps.filter((op) => op.status === "done").length;

  const hasSearches = toolEvents.length > 0;
  const headerLabel = isComplete
    ? hasSearches
      ? t("pipeline.researched", { steps: totalSteps, searches: toolCount })
      : t("pipeline.thought", { steps: totalSteps })
    : hasSearches
    ? t("pipeline.researching")
    : t("pipeline.thinking");

  // Split tool ops by retry flag
  const mainOps = toolOps.filter((op) => !op.retry);
  const retryOps = toolOps.filter((op) => op.retry);

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
              {step.stage === "specialist" &&
                mainOps.map((op, j) => <ToolOpItem key={`tool-${j}`} op={op} />)}
              {step.stage === "retry" &&
                retryOps.map((op, j) => <ToolOpItem key={`retry-tool-${j}`} op={op} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
