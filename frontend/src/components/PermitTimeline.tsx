"use client";

import { useState } from "react";

export interface PermitPhase {
  phase: string;
  description: string;
  duration: string;
  details?: string[];
  inspections?: string[];
  /** Inspections that must happen before work is concealed — costly if missed */
  critical_inspections?: string[];
}

interface PermitTimelineProps {
  phases: PermitPhase[];
  projectType?: string;
}

export default function PermitTimeline({ phases, projectType }: PermitTimelineProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const toggle = (i: number) => setExpandedIdx(expandedIdx === i ? null : i);

  return (
    <div className="mt-2 pt-2 border-t border-surface-200/60" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
      {projectType && (
        <div className="text-[10px] font-bold uppercase tracking-wider text-sage-dark mb-3">
          {projectType} — Permit Process
        </div>
      )}

      {/* Vertical timeline */}
      <div className="space-y-0">
        {phases.map((phase, i) => {
          const isExpanded = expandedIdx === i;
          const hasInspections = (phase.inspections && phase.inspections.length > 0) ||
            (phase.critical_inspections && phase.critical_inspections.length > 0);
          const hasCritical = phase.critical_inspections && phase.critical_inspections.length > 0;

          return (
            <div key={i} className="flex gap-2.5">
              {/* Left rail: circle + connector */}
              <div className="flex flex-col items-center shrink-0">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 cursor-pointer transition-colors ${
                    hasCritical
                      ? isExpanded
                        ? "bg-red-600 text-white ring-2 ring-red-300"
                        : "bg-red-500 text-white hover:bg-red-600"
                      : hasInspections
                        ? isExpanded
                          ? "bg-amber-600 text-white ring-2 ring-amber-300"
                          : "bg-amber-500 text-white hover:bg-amber-600"
                        : isExpanded
                          ? "bg-sage-dark text-white ring-2 ring-sage/30"
                          : "bg-sage text-white hover:bg-sage-dark"
                  }`}
                  onClick={() => toggle(i)}
                >
                  {i + 1}
                </div>
                {i < phases.length - 1 && (
                  <div className="w-[2px] bg-sage/30 flex-1 min-h-[8px]" />
                )}
              </div>

              {/* Right content — force shrink with min-w-0 */}
              <div className="min-w-0 flex-1 pb-3">
                <div
                  className="cursor-pointer"
                  onClick={() => toggle(i)}
                >
                  <span className="text-xs font-semibold text-text-900">
                    {phase.phase}
                  </span>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-[10px] text-sage-dark bg-sage/10 px-1.5 py-0.5 rounded-full font-medium">
                      {phase.duration}
                    </span>
                    {hasCritical && (
                      <span className="text-[9px] font-bold uppercase tracking-wide text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded-full">
                        Don&apos;t Miss
                      </span>
                    )}
                    {!hasCritical && hasInspections && (
                      <span className="text-[9px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full">
                        Inspection
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className={`mt-2 rounded-xl p-3 text-xs animate-fadeIn ${
                    hasCritical
                      ? "bg-red-50/80 ring-1 ring-red-200 shadow-sm"
                      : "bg-white ring-1 ring-surface-200/60 shadow-sm"
                  }`}>
                    <p className="text-text-700 mb-2">{phase.description}</p>

                    {phase.details && phase.details.length > 0 && (
                      <ul className="space-y-0.5 mb-2">
                        {phase.details.map((d, j) => (
                          <li key={j} className="text-text-600">
                            <span className="text-sage">&#8226;</span> {d}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Critical inspections — red highlight */}
                    {phase.critical_inspections && phase.critical_inspections.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-red-200">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-red-700 mb-1">
                          &#9888; Don&apos;t Miss — Inspect Before Concealment
                        </p>
                        <ul className="space-y-1">
                          {phase.critical_inspections.map((insp, j) => (
                            <li key={j} className="text-red-800 bg-red-100/50 rounded px-1.5 py-1 text-xs">
                              {insp}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Regular inspections — amber/gold */}
                    {phase.inspections && phase.inspections.length > 0 && (
                      <div className={`mt-2 pt-2 ${phase.critical_inspections && phase.critical_inspections.length > 0 ? "border-t border-surface-300" : "border-t border-amber-200"}`}>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1">
                          Inspections Required
                        </p>
                        <ul className="space-y-0.5">
                          {phase.inspections.map((insp, j) => (
                            <li key={j} className="text-text-600">
                              <span className="text-amber-500">&#9679;</span> {insp}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-3 pt-2 border-t border-surface-200/40 flex-wrap">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-sage" />
          <span className="text-[9px] text-text-500">Standard</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-amber-500" />
          <span className="text-[9px] text-text-500">Inspection</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span className="text-[9px] text-text-500">Don&apos;t Miss</span>
        </div>
      </div>

      {/* Tap hint */}
      {expandedIdx === null && (
        <p className="text-[10px] text-text-400 text-center mt-1">
          Tap a step to see details
        </p>
      )}
    </div>
  );
}
