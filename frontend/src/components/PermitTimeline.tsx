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
    <div className="my-3 bg-surface-100 border border-surface-300 rounded-xl p-4">
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
            <div key={i} className="flex gap-3">
              {/* Left rail: circle + connector */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 cursor-pointer transition-colors ${
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
                  <div className="w-[2px] bg-sage/30 flex-1 min-h-[12px]" />
                )}
              </div>

              {/* Right content */}
              <div className="flex-1 pb-3 min-w-0">
                <div
                  className="flex items-center gap-2 cursor-pointer flex-wrap"
                  onClick={() => toggle(i)}
                >
                  <span className="text-xs font-semibold text-text-900 truncate">
                    {phase.phase}
                  </span>
                  <span className="text-[10px] text-sage-dark bg-sage/10 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
                    {phase.duration}
                  </span>
                  {hasCritical && (
                    <span className="text-[9px] font-bold uppercase tracking-wide text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                      Don&apos;t Miss
                    </span>
                  )}
                  {!hasCritical && hasInspections && (
                    <span className="text-[9px] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                      Inspection
                    </span>
                  )}
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className={`mt-2 rounded-lg p-3 text-xs animate-in fade-in duration-150 ${
                    hasCritical
                      ? "bg-red-50 border border-red-200"
                      : "bg-surface-50 border border-surface-300"
                  }`}>
                    <p className="text-text-700 mb-2">{phase.description}</p>

                    {phase.details && phase.details.length > 0 && (
                      <ul className="space-y-0.5 mb-2">
                        {phase.details.map((d, j) => (
                          <li key={j} className="text-text-600 flex items-start gap-1.5">
                            <span className="text-sage mt-0.5">&#8226;</span>
                            <span>{d}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Critical inspections — red highlight */}
                    {phase.critical_inspections && phase.critical_inspections.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-red-200">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-red-700 flex items-center gap-1">
                          <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                          </svg>
                          Don&apos;t Miss — Inspect Before Concealment
                        </span>
                        <ul className="mt-1 space-y-1">
                          {phase.critical_inspections.map((insp, j) => (
                            <li key={j} className="text-red-800 flex items-start gap-1.5 bg-red-100/50 rounded px-1.5 py-1">
                              <span className="text-red-500 mt-0.5 shrink-0">&#9888;</span>
                              <span>{insp}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Regular inspections — amber/gold */}
                    {phase.inspections && phase.inspections.length > 0 && (
                      <div className={`mt-2 pt-2 ${phase.critical_inspections && phase.critical_inspections.length > 0 ? "border-t border-surface-300" : "border-t border-amber-200"}`}>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                          Inspections Required
                        </span>
                        <ul className="mt-1 space-y-0.5">
                          {phase.inspections.map((insp, j) => (
                            <li key={j} className="text-text-600 flex items-start gap-1.5">
                              <span className="text-amber-500 mt-0.5">&#9679;</span>
                              <span>{insp}</span>
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
      <div className="flex items-center gap-3 mt-3 pt-2 border-t border-surface-300 flex-wrap">
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
