"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import type { GuideStep, StepStatus } from "@/lib/api";
import { updateStepStatus } from "@/lib/api";
import StepInlineChat from "./StepInlineChat";
import StepReels from "./StepReels";

interface GuideChecklistProps {
  guideId: string;
  guideTitle?: string;
  steps: GuideStep[];
  color?: string;
  initialStepId?: string | null;
}

const STATUS_OPTIONS: StepStatus[] = ["todo", "in_progress", "done", "skipped"];

const STATUS_LABEL_KEYS: Record<StepStatus, string> = {
  todo: "guides.status.todo",
  in_progress: "guides.status.inProgress",
  done: "guides.status.done",
  skipped: "guides.status.skipped",
};

export default function GuideChecklist({ guideId, guideTitle, steps: initialSteps, color, initialStepId }: GuideChecklistProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const [steps, setSteps] = useState(initialSteps);
  const [activeIdx, setActiveIdx] = useState<number>(() => {
    if (!initialStepId) return 0;
    const idx = initialSteps.findIndex((s) => s.id === initialStepId);
    return idx >= 0 ? idx : 0;
  });
  const [editingNote, setEditingNote] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [inlineChatIdx, setInlineChatIdx] = useState<number | null>(null);


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
      {/* Reel view — includes bottom nav bar with progress + prev/next */}
      <StepReels
        steps={steps}
        activeIdx={activeIdx}
        color={color}
        mode="full"
        onNav={setActiveIdx}
        renderContent={(i) => {
          const step = steps[i];
          return (
            <div className="space-y-2.5">
              {/* Section 1: Description + Details */}
              <div className="bg-surface-100/60 rounded-xl px-3.5 py-3 border border-surface-200">
                <p className="text-xs text-text-700 leading-relaxed">{step.description}</p>
                {step.details && (
                  <div className="text-text-600 whitespace-pre-line text-[11px] mt-2 leading-relaxed">
                    {step.details}
                  </div>
                )}
                {step.links.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-surface-200">
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
              </div>

              {/* Section 2: Note */}
              {(editingNote === i || step.note) && (
                <div className="bg-surface-100/60 rounded-xl px-3.5 py-3 border border-surface-200">
                  {editingNote === i ? (
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder={t("guides.notePlaceholder")}
                        className="flex-1 text-[11px] px-2 py-1.5 border border-surface-300 rounded-lg bg-white focus:outline-none focus:border-sage"
                        autoFocus
                        onKeyDown={(e) => e.key === "Enter" && saveNote(i)}
                      />
                      <button
                        onClick={() => saveNote(i)}
                        className="text-[10px] px-3 py-1.5 bg-sage text-white rounded-lg hover:bg-sage-dark"
                      >
                        {t("guides.save")}
                      </button>
                    </div>
                  ) : step.note ? (
                    <div
                      className="text-[11px] text-text-500 italic cursor-pointer hover:text-text-600"
                      onClick={() => { setEditingNote(i); setNoteText(step.note); }}
                    >
                      {step.note}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Section 3: Inline chat */}
              {inlineChatIdx === i && step.chat_prompt && (
                <div className="bg-surface-100/60 rounded-xl px-3.5 py-3 border border-surface-200">
                  <StepInlineChat
                    chatPrompt={step.chat_prompt}
                    stepTitle={step.title}
                    guideTitle={guideTitle}
                    stepDescription={step.description}
                    stepDetails={step.details}
                    guideId={guideId}
                    stepId={step.id}
                    onContinueInChat={() => handleContinueInChat(step.chat_prompt)}
                  />
                </div>
              )}

              {/* Section 4: Status + Actions */}
              <div className="bg-surface-100/60 rounded-xl px-3.5 py-3 border border-surface-200 space-y-2">
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

                <div className="flex gap-2">
                  {!step.remind_at && (
                    <button
                      onClick={() => setReminder(i)}
                      className="flex-1 min-h-[44px] text-[11px] rounded-lg bg-surface-200/80 text-text-600 hover:bg-surface-200 flex items-center justify-center gap-1.5"
                    >
                      <span>🔔</span>
                      {t("guides.action.remind")}
                    </button>
                  )}
                  <button
                    onClick={() => { setEditingNote(i); setNoteText(step.note || ""); }}
                    className="flex-1 min-h-[44px] text-[11px] rounded-lg bg-surface-200/80 text-text-600 hover:bg-surface-200 flex items-center justify-center gap-1.5"
                  >
                    <span>📝</span>
                    {t("guides.action.note")}
                  </button>
                  {step.chat_prompt && (
                    <button
                      onClick={() => setInlineChatIdx(inlineChatIdx === i ? null : i)}
                      className="flex-1 min-h-[44px] text-[11px] rounded-lg bg-surface-200/80 text-text-600 hover:bg-surface-200 flex items-center justify-center gap-1.5"
                    >
                      <span>✨</span>
                      {t("guides.action.askAI")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}
