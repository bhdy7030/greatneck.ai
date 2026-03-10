"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import { useAuth } from "@/components/AuthProvider";
import GuidePreview from "@/components/GuidePreview";
import { generateGuide, refineGuide, saveUserGuide, type RawGuideData } from "@/lib/api";

type Phase = "input" | "generating" | "preview" | "refining" | "saving";

export default function CreateGuidePage() {
  const router = useRouter();
  const { language, t } = useLanguage();
  const { user, login } = useAuth();
  const [phase, setPhase] = useState<Phase>("input");
  const [description, setDescription] = useState("");
  const [refineInput, setRefineInput] = useState("");
  const [guide, setGuide] = useState<RawGuideData | null>(null);
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const village = typeof window !== "undefined" ? localStorage.getItem("gn_village") || "" : "";

  // Auth gate
  if (!user) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <p className="text-sm text-text-500 mb-4">{t("guides.create.prompt")}</p>
        <button
          onClick={login}
          className="px-6 py-3 min-h-[44px] bg-sage text-white rounded-xl font-semibold text-sm hover:bg-sage-dark transition-colors"
        >
          Sign in to create
        </button>
      </div>
    );
  }

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setError(null);
    setPhase("generating");
    try {
      const result = await generateGuide(description.trim(), village, language);
      setGuide(result.guide);
      setMessages(result.wizard_messages);
      setPhase("preview");
    } catch (e) {
      setError("Failed to generate playbook. Please try again.");
      setPhase("input");
    }
  };

  const handleRefine = async () => {
    if (!refineInput.trim() || !guide) return;
    setError(null);
    setPhase("refining");
    try {
      const result = await refineGuide(refineInput.trim(), guide, messages, village, language);
      setGuide(result.guide);
      setMessages(result.wizard_messages);
      setRefineInput("");
      setPhase("preview");
    } catch (e) {
      setError("Failed to refine. Please try again.");
      setPhase("preview");
    }
  };

  const handleSave = async () => {
    if (!guide) return;
    setPhase("saving");
    try {
      await saveUserGuide(null, guide);
      router.push("/guides");
    } catch (e) {
      setError("Failed to save. Please try again.");
      setPhase("preview");
    }
  };

  const handleStartOver = () => {
    setPhase("input");
    setDescription("");
    setRefineInput("");
    setGuide(null);
    setMessages([]);
    setError(null);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Back button */}
        <button
          onClick={() => router.push("/guides")}
          className="flex items-center gap-1 text-xs text-text-500 hover:text-sage mb-4 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <h1 className="text-lg font-bold text-text-900 mb-1">{t("guides.create")}</h1>
        <p className="text-xs text-text-500 mb-6">{t("guides.create.prompt")}</p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Input phase */}
        {(phase === "input") && (
          <div className="space-y-4">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("guides.create.placeholder")}
              rows={4}
              autoFocus
              className="w-full px-4 py-3 text-sm bg-surface-100 border border-surface-200 rounded-xl text-text-900 placeholder:text-text-400 focus:outline-none focus:ring-2 focus:ring-sage/30 resize-none"
            />
            <button
              onClick={handleGenerate}
              disabled={!description.trim()}
              className="w-full py-3 min-h-[44px] bg-sage text-white rounded-xl font-semibold text-sm hover:bg-sage-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t("guides.create")}
            </button>
          </div>
        )}

        {/* Generating / Refining spinner */}
        {(phase === "generating" || phase === "refining" || phase === "saving") && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-sage border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-sm text-text-500">{t("guides.create.generating")}</p>
          </div>
        )}

        {/* Preview phase */}
        {phase === "preview" && guide && (
          <div className="space-y-4">
            <GuidePreview guide={guide} />

            {/* Refine input */}
            <div className="space-y-2">
              <p className="text-xs text-text-500">{t("guides.create.refine")}</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={refineInput}
                  onChange={(e) => setRefineInput(e.target.value)}
                  placeholder={t("guides.create.refine.placeholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRefine();
                  }}
                  className="flex-1 px-3 py-2 text-sm bg-surface-100 border border-surface-200 rounded-xl text-text-900 placeholder:text-text-400 focus:outline-none focus:ring-2 focus:ring-sage/30"
                />
                <button
                  onClick={handleRefine}
                  disabled={!refineInput.trim()}
                  className="px-4 py-2 min-h-[44px] bg-surface-200 text-text-700 rounded-xl text-sm font-medium hover:bg-surface-300 transition-colors disabled:opacity-40"
                >
                  Refine
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleStartOver}
                className="flex-1 py-3 min-h-[44px] border border-surface-300 text-text-700 rounded-xl font-medium text-sm hover:bg-surface-100 transition-colors"
              >
                {t("guides.create.startOver")}
              </button>
              <button
                onClick={handleSave}
                className="flex-1 py-3 min-h-[44px] bg-sage text-white rounded-xl font-semibold text-sm hover:bg-sage-dark transition-colors"
              >
                {t("guides.create.save")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
