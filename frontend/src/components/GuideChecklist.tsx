"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "./LanguageProvider";
import type { GuideStep, StepStatus } from "@/lib/api";
import { updateStepStatus, clearStepReminder } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import StepInlineChat from "./StepInlineChat";
import StepMarkdown from "./StepMarkdown";
import StepReels from "./StepReels";

interface GuideChecklistProps {
  guideId: string;
  guideTitle?: string;
  steps: GuideStep[];
  color?: string;
  initialStepId?: string | null;
}

const STATUS_OPTIONS: StepStatus[] = ["todo", "in_progress", "done"];

const STATUS_LABEL_KEYS: Record<string, string> = {
  todo: "guides.status.todo",
  in_progress: "guides.status.inProgress",
  done: "guides.status.done",
};

export default function GuideChecklist({ guideId, guideTitle, steps: initialSteps, color, initialStepId }: GuideChecklistProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [steps, setSteps] = useState(initialSteps);
  const [activeIdx, setActiveIdx] = useState<number>(() => {
    if (!initialStepId) return 0;
    const idx = initialSteps.findIndex((s) => s.id === initialStepId);
    return idx >= 0 ? idx : 0;
  });
  const [editingNote, setEditingNote] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  const [inlineChatIdx, setInlineChatIdx] = useState<number | null>(null);
  const [reminderPickerIdx, setReminderPickerIdx] = useState<number | null>(null);
  const [reminderDays, setReminderDays] = useState<number | null>(null);


  const cycleStatus = useCallback(
    async (idx: number, newStatus: StepStatus) => {
      const step = steps[idx];
      setSteps((prev) =>
        prev.map((s, i) => (i === idx ? { ...s, status: newStatus } : s))
      );
      try {
        await updateStepStatus(guideId, step.id, { status: newStatus });
      } catch {
        showToast("Couldn't update status, try again");
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
    async (idx: number, remind_at: string) => {
      const step = steps[idx];
      setSteps((prev) =>
        prev.map((s, i) => (i === idx ? { ...s, remind_at } : s))
      );
      setReminderPickerIdx(null);
      try {
        await updateStepStatus(guideId, step.id, { status: step.status, remind_at });
      } catch {
        // silent
      }
    },
    [guideId, steps]
  );

  const handleClearReminder = useCallback(
    async (idx: number) => {
      const step = steps[idx];
      setSteps((prev) =>
        prev.map((s, i) => (i === idx ? { ...s, remind_at: null } : s))
      );
      try {
        await clearStepReminder(guideId, step.id);
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
    <div className="h-full flex flex-col">
      {/* Reel view — immersive, fills container */}
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
              <div className="bg-white rounded-xl px-3.5 py-3 border border-surface-200/60 shadow-sm">
                <StepMarkdown content={step.description} />
                {step.details && (
                  <StepMarkdown content={step.details} className="mt-2 text-text-600 text-[12px]" />
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
                <div className="bg-white rounded-xl px-3.5 py-3 border border-surface-200/60 shadow-sm">
                  {editingNote === i ? (
                    <div
                      className="flex items-center gap-1.5 rounded-full bg-surface-50 px-3 py-1"
                      style={{ border: "1px solid rgba(0,0,0,0.05)" }}
                    >
                      <input
                        type="text"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder=""
                        className="flex-1 text-[12px] bg-transparent px-1 py-1.5 focus:outline-none text-text-800"
                        autoFocus
                        onKeyDown={(e) => e.key === "Enter" && saveNote(i)}
                      />
                      <button
                        onClick={() => saveNote(i)}
                        className="text-[10px] px-3 py-1 bg-sage text-white rounded-full hover:bg-sage-dark transition-colors"
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
                <div className="bg-white rounded-xl px-3.5 py-3 border border-surface-200/60 shadow-sm">
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

              {/* Section 4: Status + Actions — single row */}
              <div className="flex items-center gap-2 bg-white rounded-xl px-2.5 py-2 border border-surface-200/60 shadow-sm">
                {/* Status segmented control */}
                <div className="flex bg-surface-100 rounded-lg p-0.5 gap-0.5 flex-1">
                  {STATUS_OPTIONS.map((status) => {
                    const isActive = step.status === status;
                    const icons: Record<string, React.ReactNode> = {
                      todo: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" strokeWidth={2} /></svg>,
                      in_progress: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
                      done: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>,
                    };
                    let activeClass = "text-text-500";
                    if (isActive) {
                      switch (status) {
                        case "todo": activeClass = "bg-white text-text-700 shadow-sm"; break;
                        case "in_progress": activeClass = "bg-amber-500 text-white shadow-sm"; break;
                        case "done": activeClass = "bg-sage text-white shadow-sm"; break;
                      }
                    }
                    return (
                      <button
                        key={status}
                        onClick={() => cycleStatus(i, status)}
                        className={`flex-1 min-h-[34px] flex items-center justify-center gap-1 text-[10px] font-medium rounded-md transition-all duration-200 ${
                          isActive ? activeClass : "text-text-400 hover:text-text-600"
                        }`}
                        title={t(STATUS_LABEL_KEYS[status])}
                      >
                        {icons[status]}
                        {isActive && <span className="hidden sm:inline">{t(STATUS_LABEL_KEYS[status])}</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Divider */}
                <div className="w-px h-5 bg-surface-200" />

                {/* Action icons */}
                {step.remind_at ? (
                  <button
                    onClick={() => handleClearReminder(i)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-100 text-amber-600 hover:bg-amber-200 transition-colors relative"
                    title={new Date(step.remind_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" /></svg>
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-500 rounded-full" />
                  </button>
                ) : (
                  <button
                    onClick={() => setReminderPickerIdx(reminderPickerIdx === i ? null : i)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-text-400 hover:text-text-600 hover:bg-surface-100 transition-colors"
                    title={t("guides.action.remind")}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                  </button>
                )}
                <button
                  onClick={() => { setEditingNote(i); setNoteText(step.note || ""); }}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                    step.note ? "text-sage bg-sage/10 hover:bg-sage/20" : "text-text-400 hover:text-text-600 hover:bg-surface-100"
                  }`}
                  title={t("guides.action.note")}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                </button>
                {step.chat_prompt && (
                  <button
                    onClick={() => setInlineChatIdx(inlineChatIdx === i ? null : i)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-text-400 hover:text-sage hover:bg-sage/10 transition-colors"
                    title={t("guides.action.askAI")}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                  </button>
                )}
              </div>

              {/* Reminder picker — expands below when active */}
              {reminderPickerIdx === i && (
                <div className="bg-white rounded-xl px-3.5 py-2.5 border border-amber-200/60 shadow-sm space-y-1.5">
                  <div className="flex gap-1.5">
                    {[
                      { label: "Tomorrow", days: 1 },
                      { label: "3 days", days: 3 },
                      { label: "1 week", days: 7 },
                    ].map(({ label, days }) => (
                      <button
                        key={label}
                        onClick={() => setReminderDays(days)}
                        className={`flex-1 min-h-[32px] text-[10px] rounded-lg border ${
                          reminderDays === days
                            ? "bg-amber-200 text-amber-800 border-amber-300"
                            : "bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {reminderDays !== null && (
                    <div className="flex gap-1.5">
                      {[
                        { label: "9 AM", hour: 9 },
                        { label: "12 PM", hour: 12 },
                        { label: "5 PM", hour: 17 },
                        { label: "8 PM", hour: 20 },
                      ].map(({ label, hour }) => {
                        const d = new Date();
                        d.setDate(d.getDate() + reminderDays);
                        d.setHours(hour, 0, 0, 0);
                        return (
                          <button
                            key={label}
                            onClick={() => { setReminderDays(null); setReminder(i, d.toISOString()); }}
                            className="flex-1 min-h-[32px] text-[10px] rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200"
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex gap-1.5 items-center">
                    <input
                      type="datetime-local"
                      className="flex-1 min-h-[32px] px-2 text-[10px] rounded-lg border border-surface-300 bg-white focus:outline-none focus:border-sage"
                      onChange={(e) => {
                        if (e.target.value) {
                          setReminderDays(null);
                          setReminder(i, new Date(e.target.value).toISOString());
                        }
                      }}
                    />
                    <button
                      onClick={() => { setReminderPickerIdx(null); setReminderDays(null); }}
                      className="min-h-[32px] px-2 text-[10px] text-text-400 hover:text-text-600"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}
