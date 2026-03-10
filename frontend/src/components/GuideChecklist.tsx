"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import type { GuideStep, StepStatus } from "@/lib/api";
import { updateStepStatus } from "@/lib/api";
import StepInlineChat from "./StepInlineChat";

interface GuideChecklistProps {
  guideId: string;
  steps: GuideStep[];
  color?: string;
  initialStepId?: string | null;
}

const STATUS_ICONS: Record<StepStatus, React.ReactNode> = {
  todo: null, // will show step number
  in_progress: (
    <span className="relative flex h-3 w-3">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
    </span>
  ),
  done: (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  ),
  skipped: (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M20 12H4" />
    </svg>
  ),
};

const STATUS_OPTIONS: StepStatus[] = ["todo", "in_progress", "done", "skipped"];

const STATUS_LABEL_KEYS: Record<StepStatus, string> = {
  todo: "guides.status.todo",
  in_progress: "guides.status.inProgress",
  done: "guides.status.done",
  skipped: "guides.status.skipped",
};

export default function GuideChecklist({ guideId, steps: initialSteps, color, initialStepId }: GuideChecklistProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const [steps, setSteps] = useState(initialSteps);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(() => {
    if (!initialStepId) return null;
    const idx = initialSteps.findIndex((s) => s.id === initialStepId);
    return idx >= 0 ? idx : null;
  });
  const [editingNote, setEditingNote] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [inlineChatIdx, setInlineChatIdx] = useState<number | null>(null);

  const doneCount = steps.filter((s) => s.status === "done").length;

  const toggle = (i: number) => {
    setExpandedIdx(expandedIdx === i ? null : i);
    if (expandedIdx !== i) setInlineChatIdx(null);
  };

  const cycleStatus = useCallback(
    async (idx: number, newStatus: StepStatus) => {
      const step = steps[idx];
      setSteps((prev) =>
        prev.map((s, i) => (i === idx ? { ...s, status: newStatus } : s))
      );
      try {
        await updateStepStatus(guideId, step.id, { status: newStatus });
      } catch {
        setSteps((prev) =>
          prev.map((s, i) => (i === idx ? { ...s, status: step.status } : s))
        );
      }
    },
    [guideId, steps]
  );

  const saveNote = useCallback(
    async (idx: number) => {
      const step = steps[idx];
      const note = noteText.trim();
      setSteps((prev) =>
        prev.map((s, i) => (i === idx ? { ...s, note } : s))
      );
      setEditingNote(null);
      try {
        await updateStepStatus(guideId, step.id, { status: step.status, note });
      } catch {
        // silent
      }
    },
    [guideId, steps, noteText]
  );

  const setReminder = useCallback(
    async (idx: number) => {
      const step = steps[idx];
      const remindDate = new Date();
      remindDate.setDate(remindDate.getDate() + 3);
      const remind_at = remindDate.toISOString();
      setSteps((prev) =>
        prev.map((s, i) => (i === idx ? { ...s, remind_at } : s))
      );
      try {
        await updateStepStatus(guideId, step.id, { status: step.status, remind_at });
      } catch {
        // silent
      }
    },
    [guideId, steps]
  );

  const handleContinueInChat = (chatPrompt: string) => {
    localStorage.setItem("gn_draft", chatPrompt);
    router.push("/chat/");
  };

  return (
    <div className="space-y-0">
      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 h-2 bg-surface-200 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${steps.length ? (doneCount / steps.length) * 100 : 0}%`,
              backgroundColor: color || "rgb(var(--color-sage))",
            }}
          />
        </div>
        <span className="text-xs font-medium text-text-600">
          {doneCount}/{steps.length}
        </span>
      </div>

      {/* Steps */}
      {steps.map((step, i) => {
        const isExpanded = expandedIdx === i;
        const isDone = step.status === "done";
        const isSkipped = step.status === "skipped";
        const isInProgress = step.status === "in_progress";

        return (
          <div key={step.id} className="flex gap-3">
            {/* Left rail: circle + connector */}
            <div className="flex flex-col items-center">
              <div
                className={`w-10 h-10 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center text-xs font-bold shrink-0 cursor-pointer transition-all ${
                  isDone
                    ? "bg-sage text-white"
                    : isInProgress
                      ? "bg-amber-500 text-white"
                      : isSkipped
                        ? "bg-surface-300 text-text-500"
                        : isExpanded
                          ? "bg-sage-dark text-white ring-2 ring-sage/30"
                          : "border-2 border-surface-300 text-text-500 hover:border-sage"
                }`}
                onClick={() => toggle(i)}
              >
                {STATUS_ICONS[step.status] ?? (i + 1)}
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`w-[2px] flex-1 min-h-[12px] ${
                    isDone ? "bg-sage/50" : "bg-surface-300"
                  }`}
                />
              )}
            </div>

            {/* Right content */}
            <div className="flex-1 pb-3 min-w-0">
              <div
                className="flex items-center gap-2 cursor-pointer flex-wrap"
                onClick={() => toggle(i)}
              >
                <span
                  className={`text-xs font-semibold truncate ${
                    isDone || isSkipped ? "text-text-500 line-through" : "text-text-900"
                  }`}
                >
                  {step.title}
                </span>
                {step.priority === "high" && !isDone && (
                  <span className="text-[9px] font-bold uppercase tracking-wide text-red-700 bg-red-100 border border-red-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                    {t("guides.priority")}
                  </span>
                )}
                {step.remind_at && (
                  <span className="text-[9px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {t("guides.reminder")}
                  </span>
                )}
              </div>

              {/* Note preview (when collapsed) */}
              {!isExpanded && step.note && (
                <p className="text-[10px] text-text-500 mt-0.5 truncate italic">
                  {step.note}
                </p>
              )}

              {/* Expanded detail */}
              {isExpanded && (
                <div className="mt-2 rounded-lg p-3 text-xs bg-surface-50 border border-surface-300 animate-in fade-in duration-150 space-y-2">
                  <p className="text-text-700">{step.description}</p>

                  {step.details && (
                    <div className="text-text-600 whitespace-pre-line text-[11px]">
                      {step.details}
                    </div>
                  )}

                  {/* Links */}
                  {step.links.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {step.links.map((link, j) => (
                        <a
                          key={j}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] text-sage hover:text-sage-dark bg-sage/10 px-2 py-1 rounded-full"
                        >
                          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                          {link.label}
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Note editing */}
                  {editingNote === i ? (
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder={t("guides.notePlaceholder")}
                        className="flex-1 text-[11px] px-2 py-1 border border-surface-300 rounded bg-white focus:outline-none focus:border-sage"
                        autoFocus
                        onKeyDown={(e) => e.key === "Enter" && saveNote(i)}
                      />
                      <button
                        onClick={() => saveNote(i)}
                        className="text-[10px] px-2 py-1 bg-sage text-white rounded hover:bg-sage-dark"
                      >
                        {t("guides.save")}
                      </button>
                    </div>
                  ) : step.note ? (
                    <div
                      className="text-[11px] text-text-500 italic bg-surface-100 px-2 py-1 rounded cursor-pointer hover:bg-surface-200"
                      onClick={() => { setEditingNote(i); setNoteText(step.note); }}
                    >
                      {step.note}
                    </div>
                  ) : null}

                  {/* Inline chat */}
                  {inlineChatIdx === i && step.chat_prompt && (
                    <StepInlineChat
                      chatPrompt={step.chat_prompt}
                      stepTitle={step.title}
                      guideId={guideId}
                      stepId={step.id}
                      onContinueInChat={() => handleContinueInChat(step.chat_prompt)}
                    />
                  )}

                  {/* Row 1: Segmented status control */}
                  <div className="flex bg-surface-200 rounded-xl p-1 gap-1">
                    {STATUS_OPTIONS.map((status) => {
                      const isActive = step.status === status;
                      let activeClass = "";
                      if (isActive) {
                        switch (status) {
                          case "todo":
                            activeClass = "bg-surface-50 text-text-700 shadow-sm border border-surface-300";
                            break;
                          case "in_progress":
                            activeClass = "bg-amber-500 text-white shadow-sm";
                            break;
                          case "done":
                            activeClass = "bg-sage text-white shadow-sm";
                            break;
                          case "skipped":
                            activeClass = "bg-surface-300 text-text-500";
                            break;
                        }
                      }
                      return (
                        <button
                          key={status}
                          onClick={() => cycleStatus(i, status)}
                          className={`flex-1 min-h-[44px] text-[11px] font-medium rounded-lg transition-all duration-200 ${
                            isActive
                              ? activeClass
                              : "text-text-500 hover:text-text-700 hover:bg-surface-100"
                          }`}
                        >
                          {t(STATUS_LABEL_KEYS[status])}
                        </button>
                      );
                    })}
                  </div>

                  {/* Row 2: Secondary actions */}
                  <div className="flex gap-2 mt-2">
                    {!step.remind_at && (
                      <button
                        onClick={() => setReminder(i)}
                        className="flex-1 min-h-[44px] text-[11px] rounded-lg bg-surface-100 text-text-600 hover:bg-surface-200 flex items-center justify-center gap-1.5"
                      >
                        <span>🔔</span>
                        {t("guides.action.remind")}
                      </button>
                    )}
                    <button
                      onClick={() => { setEditingNote(i); setNoteText(step.note || ""); }}
                      className="flex-1 min-h-[44px] text-[11px] rounded-lg bg-surface-100 text-text-600 hover:bg-surface-200 flex items-center justify-center gap-1.5"
                    >
                      <span>📝</span>
                      {t("guides.action.note")}
                    </button>
                    {step.chat_prompt && (
                      <button
                        onClick={() => setInlineChatIdx(inlineChatIdx === i ? null : i)}
                        className="flex-1 min-h-[44px] text-[11px] rounded-lg bg-surface-100 text-text-600 hover:bg-surface-200 flex items-center justify-center gap-1.5"
                      >
                        <span>✨</span>
                        {t("guides.action.askAI")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Tap hint */}
      {expandedIdx === null && steps.length > 0 && (
        <p className="text-[10px] text-text-500 text-center mt-1">
          {t("guides.tapHint")}
        </p>
      )}
    </div>
  );
}
