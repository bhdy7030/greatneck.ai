"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { suggestHandles, checkHandleAvailable, setHandle } from "@/lib/api";

interface HandlePickerProps {
  userName: string;
  onComplete: (handle: string) => void;
}

const HANDLE_RE = /^[a-z0-9]([a-z0-9-]{1,18}[a-z0-9])?$/;

function validateHandle(h: string): string | null {
  if (h.length < 3) return "At least 3 characters";
  if (h.length > 20) return "Max 20 characters";
  if (h.includes("--")) return "No consecutive hyphens";
  if (!HANDLE_RE.test(h)) return "Lowercase letters, numbers, and hyphens only";
  return null;
}

export default function HandlePicker({ userName, onComplete }: HandlePickerProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    suggestHandles()
      .then(({ suggestions: s }) => {
        setSuggestions(s);
        if (s.length > 0) setSelected(s[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const checkAvailability = useCallback((handle: string) => {
    const validationError = validateHandle(handle);
    if (validationError) {
      setError(validationError);
      setAvailable(null);
      return;
    }
    setError(null);
    setChecking(true);
    checkHandleAvailable(handle)
      .then(({ available: ok }) => {
        setAvailable(ok);
        if (!ok) setError("This handle is taken");
      })
      .catch(() => setAvailable(null))
      .finally(() => setChecking(false));
  }, []);

  const handleCustomChange = useCallback(
    (val: string) => {
      const normalized = val.toLowerCase().replace(/[^a-z0-9-]/g, "");
      setCustom(normalized);
      setSelected(null);
      setAvailable(null);
      setError(null);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (normalized.length >= 3) {
        debounceRef.current = setTimeout(() => checkAvailability(normalized), 300);
      }
    },
    [checkAvailability]
  );

  const handleSubmit = async () => {
    const handle = selected || custom;
    if (!handle) return;

    const validationError = validateHandle(handle);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await setHandle(handle);
      onComplete(handle);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to set handle");
    } finally {
      setSubmitting(false);
    }
  };

  const activeHandle = selected || custom;
  const canSubmit = activeHandle && !checking && !submitting && (selected ? true : available === true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Choose your handle</h2>
        <p className="text-sm text-gray-500 mb-4">
          This is how others will find and mention you.
        </p>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-sage/30 border-t-sage rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Suggestions */}
            <div className="flex flex-wrap gap-2 mb-4">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setSelected(s);
                    setCustom("");
                    setError(null);
                    setAvailable(null);
                  }}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    selected === s
                      ? "bg-sage text-white"
                      : "bg-surface-100 text-text-700 hover:bg-surface-200"
                  }`}
                >
                  @{s}
                </button>
              ))}
            </div>

            {/* Custom input */}
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">Or type your own:</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
                <input
                  type="text"
                  value={custom}
                  onChange={(e) => handleCustomChange(e.target.value)}
                  onFocus={() => setSelected(null)}
                  placeholder="your-handle"
                  maxLength={20}
                  className="w-full pl-7 pr-10 py-2.5 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sage/30 focus:border-sage"
                />
                {custom && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2">
                    {checking ? (
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-sage rounded-full animate-spin" />
                    ) : available === true ? (
                      <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : available === false ? (
                      <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : null}
                  </span>
                )}
              </div>
              {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={`w-full py-2.5 rounded-xl text-sm font-medium transition-colors ${
                canSubmit
                  ? "bg-sage text-white hover:bg-sage/90"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
            >
              {submitting ? "Setting handle..." : `Continue as @${activeHandle || "..."}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
