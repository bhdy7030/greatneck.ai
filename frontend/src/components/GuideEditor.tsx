"use client";

import { useState, useCallback } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import type { RawGuideData, RawGuideStep, BilingualText } from "@/lib/api";

const ICONS: Record<string, string> = {
  home: "\u{1F3E0}",
  snowflake: "\u{2744}\u{FE0F}",
  flower: "\u{1F338}",
  sun: "\u{2600}\u{FE0F}",
  leaf: "\u{1F342}",
  star: "\u{2B50}",
  briefcase: "\u{1F4BC}",
  heart: "\u{2764}\u{FE0F}",
  book: "\u{1F4D6}",
  tools: "\u{1F6E0}\u{FE0F}",
};

const COLOR_PRESETS = [
  "#4A90D9", "#D94A4A", "#4AD97A", "#D9A84A",
  "#9B4AD9", "#4AD9D9", "#D94A9B", "#7A8B3D",
];

function loc(obj: BilingualText | string | undefined, lang: string): string {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  return obj[lang as "en" | "zh"] || obj.en || "";
}

function setLoc(obj: BilingualText | undefined, lang: string, value: string): BilingualText {
  const base = typeof obj === "object" && obj ? { ...obj } : { en: "", zh: "" };
  (base as Record<string, string>)[lang] = value;
  return base;
}

interface GuideEditorProps {
  guide: RawGuideData;
  onChange: (updated: RawGuideData) => void;
}

export default function GuideEditor({ guide, onChange }: GuideEditorProps) {
  const { language, t } = useLanguage();
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const update = useCallback(
    (patch: Partial<RawGuideData>) => {
      onChange({ ...guide, ...patch });
    },
    [guide, onChange]
  );

  const updateStep = useCallback(
    (index: number, patch: Partial<RawGuideStep>) => {
      const steps = [...guide.steps];
      steps[index] = { ...steps[index], ...patch };
      onChange({ ...guide, steps });
    },
    [guide, onChange]
  );

  const addStep = useCallback(() => {
    const newStep: RawGuideStep = {
      id: `step-${guide.steps.length + 1}`,
      title: { en: "", zh: "" },
      description: { en: "", zh: "" },
      details: { en: "", zh: "" },
      links: [],
      category: "",
      priority: "medium",
      chat_prompt: { en: "", zh: "" },
    };
    onChange({ ...guide, steps: [...guide.steps, newStep] });
    setExpandedStep(guide.steps.length);
  }, [guide, onChange]);

  const deleteStep = useCallback(
    (index: number) => {
      const steps = guide.steps.filter((_, i) => i !== index);
      onChange({ ...guide, steps });
      setExpandedStep(null);
    },
    [guide, onChange]
  );

  const moveStep = useCallback(
    (index: number, direction: -1 | 1) => {
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= guide.steps.length) return;
      const steps = [...guide.steps];
      [steps[index], steps[newIndex]] = [steps[newIndex], steps[index]];
      onChange({ ...guide, steps });
      setExpandedStep(newIndex);
    },
    [guide, onChange]
  );

  return (
    <div className="space-y-5">
      {/* Title */}
      <div>
        <label className="block text-xs font-medium text-text-500 mb-1">Title</label>
        <input
          type="text"
          value={loc(guide.title, language)}
          onChange={(e) => update({ title: setLoc(guide.title, language, e.target.value) })}
          className="w-full px-3 py-2 text-sm bg-surface-100 border border-surface-200 rounded-xl text-text-900 focus:outline-none focus:ring-2 focus:ring-sage/30"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-medium text-text-500 mb-1">Description</label>
        <textarea
          value={loc(guide.description, language)}
          onChange={(e) => update({ description: setLoc(guide.description, language, e.target.value) })}
          rows={2}
          className="w-full px-3 py-2 text-sm bg-surface-100 border border-surface-200 rounded-xl text-text-900 focus:outline-none focus:ring-2 focus:ring-sage/30 resize-none"
        />
      </div>

      {/* Icon picker */}
      <div>
        <label className="block text-xs font-medium text-text-500 mb-2">Icon</label>
        <div className="flex flex-wrap gap-2">
          {Object.entries(ICONS).map(([key, emoji]) => (
            <button
              key={key}
              onClick={() => update({ icon: key })}
              className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl transition-all ${
                guide.icon === key
                  ? "bg-sage/20 ring-2 ring-sage scale-110"
                  : "bg-surface-100 hover:bg-surface-200"
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Color picker */}
      <div>
        <label className="block text-xs font-medium text-text-500 mb-2">Color</label>
        <div className="flex flex-wrap gap-2">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              onClick={() => update({ color: c })}
              className={`w-8 h-8 rounded-full transition-all ${
                guide.color === c ? "ring-2 ring-offset-2 ring-text-900 scale-110" : "hover:scale-105"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/* Steps */}
      <div>
        <label className="block text-xs font-medium text-text-500 mb-2">
          Steps ({guide.steps.length})
        </label>
        <div className="space-y-2">
          {guide.steps.map((step, i) => (
            <div
              key={step.id || i}
              className="bg-surface-100 rounded-xl border border-surface-200 overflow-hidden"
            >
              {/* Step header (always visible) */}
              <button
                onClick={() => setExpandedStep(expandedStep === i ? null : i)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left min-h-[44px]"
              >
                <span
                  className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ backgroundColor: guide.color }}
                >
                  {i + 1}
                </span>
                <span className="flex-1 text-sm text-text-800 truncate">
                  {loc(step.title, language) || "(untitled)"}
                </span>
                <svg
                  className={`w-4 h-4 text-text-400 transition-transform ${
                    expandedStep === i ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Expanded step editor */}
              {expandedStep === i && (
                <div className="px-3 pb-3 space-y-3 border-t border-surface-200 pt-3">
                  <input
                    type="text"
                    placeholder="Step title"
                    value={loc(step.title, language)}
                    onChange={(e) => updateStep(i, { title: setLoc(step.title, language, e.target.value) })}
                    className="w-full px-3 py-2 text-sm bg-white border border-surface-200 rounded-lg text-text-900 focus:outline-none focus:ring-2 focus:ring-sage/30"
                  />
                  <textarea
                    placeholder="Description"
                    value={loc(step.description, language)}
                    onChange={(e) => updateStep(i, { description: setLoc(step.description, language, e.target.value) })}
                    rows={2}
                    className="w-full px-3 py-2 text-sm bg-white border border-surface-200 rounded-lg text-text-900 focus:outline-none focus:ring-2 focus:ring-sage/30 resize-none"
                  />
                  <textarea
                    placeholder="Detailed instructions"
                    value={loc(step.details, language)}
                    onChange={(e) => updateStep(i, { details: setLoc(step.details, language, e.target.value) })}
                    rows={3}
                    className="w-full px-3 py-2 text-sm bg-white border border-surface-200 rounded-lg text-text-900 focus:outline-none focus:ring-2 focus:ring-sage/30 resize-none"
                  />

                  {/* Priority */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-500">Priority:</span>
                    {(["low", "medium", "high"] as const).map((p) => (
                      <button
                        key={p}
                        onClick={() => updateStep(i, { priority: p })}
                        className={`text-xs px-2 py-1 rounded-full capitalize ${
                          step.priority === p
                            ? p === "high"
                              ? "bg-red-100 text-red-700"
                              : p === "medium"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-green-100 text-green-700"
                            : "bg-surface-200 text-text-500"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>

                  {/* Move / Delete buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => moveStep(i, -1)}
                      disabled={i === 0}
                      className="text-xs text-text-500 hover:text-sage disabled:opacity-30 min-h-[44px] px-2"
                    >
                      Move up
                    </button>
                    <button
                      onClick={() => moveStep(i, 1)}
                      disabled={i === guide.steps.length - 1}
                      className="text-xs text-text-500 hover:text-sage disabled:opacity-30 min-h-[44px] px-2"
                    >
                      Move down
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={() => deleteStep(i)}
                      className="text-xs text-red-500 hover:text-red-700 min-h-[44px] px-2"
                    >
                      {t("guides.edit.deleteStep")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add step */}
        <button
          onClick={addStep}
          className="mt-3 w-full py-2.5 min-h-[44px] text-sm font-medium text-sage border border-dashed border-sage/40 rounded-xl hover:bg-sage/5 transition-colors"
        >
          + {t("guides.edit.addStep")}
        </button>
      </div>
    </div>
  );
}
