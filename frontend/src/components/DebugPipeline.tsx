"use client";

import { useState } from "react";
import type { PipelineEvent } from "@/lib/api";

interface DebugPipelineProps {
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

function DebugDataBlock({ label, data }: { label: string; data: unknown }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="ml-7 mt-1 mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[10px] font-mono text-gold-dark hover:text-gold flex items-center gap-1"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        {label}
      </button>
      {expanded && (
        <pre className="mt-1 text-[10px] font-mono text-text-600 bg-surface-200 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">
          {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ToolCallDebug({ event }: { event: PipelineEvent }) {
  const [showArgs, setShowArgs] = useState(false);
  const hasResults = event.has_results !== false;
  const isResult = event.preview !== undefined;
  const isCall = event.preview === undefined;

  if (isCall) {
    return (
      <div className="pl-7 py-0.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse flex-shrink-0" />
          <span className="font-mono text-text-600 font-medium">{event.tool}</span>
          <button
            onClick={() => setShowArgs(!showArgs)}
            className="text-[10px] text-gold-dark hover:text-gold"
          >
            {showArgs ? "hide args" : "show args"}
          </button>
          {event.retry && (
            <span className="text-gold-dark text-[10px] font-medium">(retry)</span>
          )}
        </div>
        {showArgs && event.args && (
          <pre className="mt-1 ml-4 text-[10px] font-mono text-text-500 bg-surface-200 rounded p-1.5 overflow-x-auto">
            {JSON.stringify(event.args, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  if (isResult) {
    const relevanceColor = hasResults ? "text-sage" : "text-red-400";
    return (
      <div className="pl-7 py-0.5">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              hasResults ? "bg-sage" : "bg-red-400"
            }`}
          />
          <span className="font-mono text-text-600">{event.tool}</span>
          <span className={relevanceColor}>
            {hasResults ? "found results" : "no results"}
          </span>
        </div>
        {event.preview && (
          <pre className="mt-1 ml-4 text-[10px] font-mono text-text-500 bg-surface-200 rounded p-1.5 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
            {event.preview}
          </pre>
        )}
      </div>
    );
  }

  return null;
}

function StepItem({ event }: { event: PipelineEvent }) {
  const icon = STAGE_ICONS[event.stage || ""] || "?";
  const isRunning = event.status === "running";

  return (
    <div className="py-1">
      <div className="flex items-start gap-2">
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
        <div className="flex-1 min-w-0">
          <div
            className={`text-xs font-medium ${
              isRunning ? "text-gold" : event.status === "done" ? "text-sage" : "text-text-500"
            }`}
          >
            {event.label}
            {isRunning && <span className="inline-block ml-1 animate-pulse">...</span>}
          </div>
          {event.detail && (
            <div className="text-[11px] text-text-500">{event.detail}</div>
          )}
        </div>
      </div>

      {/* Show planner steps */}
      {event.plan && (
        <div className="ml-7 mt-1 space-y-0.5">
          {event.plan.steps.map((s, i) => (
            <div key={i} className="text-[10px] text-text-500 font-mono">
              {s.tool}(&quot;{s.query}&quot;)
            </div>
          ))}
          <div className="text-[10px] text-text-500 mt-1">
            Model: <span className="text-gold-dark font-medium">{event.plan.model}</span>
          </div>
          {event.plan.web_fallbacks.length > 0 && (
            <div className="text-[10px] text-text-500">
              Fallbacks: {event.plan.web_fallbacks.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DebugPipeline({ events, isComplete }: DebugPipelineProps) {
  if (events.length === 0) return null;

  const steps = events.filter((e) => e.type === "step");
  const toolEvents = events.filter((e) => e.type === "tool");
  const debugEvents = events.filter((e) => e.type === "debug");
  const errorEvent = events.find((e) => e.type === "error");

  return (
    <div className="bg-surface-200/60 border border-surface-300 rounded-xl px-3 py-2 mb-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <svg
          className="w-3.5 h-3.5 text-gold"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
          />
        </svg>
        <span className="text-[10px] text-gold uppercase tracking-wider font-semibold">
          Debug Pipeline
        </span>
        {!isComplete && (
          <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />
        )}
      </div>

      <div className="space-y-0">
        {steps.map((step, i) => (
          <div key={`${step.stage}-${step.status}-${i}`}>
            <StepItem event={step} />

            {/* Show debug data for this stage */}
            {debugEvents
              .filter((d) => d.stage === step.stage)
              .map((d, j) => (
                <DebugDataBlock
                  key={`debug-${step.stage}-${j}`}
                  label={`${step.stage} debug data`}
                  data={d.data}
                />
              ))}

            {/* Tool events after specialist running */}
            {step.stage === "specialist" &&
              step.status === "running" &&
              toolEvents
                .filter((t) => !t.retry)
                .map((te, j) => <ToolCallDebug key={`tool-${j}`} event={te} />)}

            {/* Retry tool events */}
            {step.stage === "retry" &&
              step.status === "running" &&
              toolEvents
                .filter((t) => t.retry)
                .map((te, j) => <ToolCallDebug key={`retry-tool-${j}`} event={te} />)}
          </div>
        ))}

        {/* Error display */}
        {errorEvent && (
          <div className="py-1.5">
            <div className="flex items-start gap-2">
              <div className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 bg-red-100 text-red-600">
                !
              </div>
              <div className="text-xs text-red-600 font-medium">
                {errorEvent.message || "An error occurred"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
