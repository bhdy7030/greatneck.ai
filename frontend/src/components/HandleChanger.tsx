"use client";

import { useState, useCallback, useRef } from "react";
import { checkHandleAvailable, setHandle } from "@/lib/api";

interface HandleChangerProps {
  currentHandle: string;
  onComplete: (handle: string) => void;
  onClose: () => void;
}

const HANDLE_RE = /^[a-z0-9]([a-z0-9-]{1,18}[a-z0-9])?$/;

function validateHandle(h: string): string | null {
  if (h.length < 3) return "At least 3 characters";
  if (h.length > 20) return "Max 20 characters";
  if (h.includes("--")) return "No consecutive hyphens";
  if (!HANDLE_RE.test(h)) return "Lowercase letters, numbers, and hyphens only";
  return null;
}

export default function HandleChanger({ currentHandle, onComplete, onClose }: HandleChangerProps) {
  const [value, setValue] = useState(currentHandle);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const checkAvailability = useCallback((handle: string) => {
    const validationError = validateHandle(handle);
    if (validationError) {
      setError(validationError);
      setAvailable(null);
      return;
    }
    if (handle === currentHandle) {
      setError(null);
      setAvailable(null);
      return;
    }
    setError(null);
    setChecking(true);
    checkHandleAvailable(handle)
      .then(({ available: ok }) => {
        setAvailable(ok);
        if (!ok) setError("This username is taken");
      })
      .catch(() => setAvailable(null))
      .finally(() => setChecking(false));
  }, [currentHandle]);

  const handleChange = useCallback(
    (val: string) => {
      const normalized = val.toLowerCase().replace(/[^a-z0-9-]/g, "");
      setValue(normalized);
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
    if (!value || value === currentHandle) return;
    const validationError = validateHandle(value);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await setHandle(value);
      onComplete(value);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to change username");
    } finally {
      setSubmitting(false);
    }
  };

  const isChanged = value !== currentHandle;
  const canSubmit = isChanged && value.length >= 3 && !checking && !submitting && available === true;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Change your username</h2>
        <p className="text-sm text-gray-500 mb-4">
          Your current username is <span className="font-medium text-text-700">@{currentHandle}</span>
        </p>

        <div className="mb-4">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
            <input
              type="text"
              value={value}
              onChange={(e) => handleChange(e.target.value)}
              placeholder="new-username"
              maxLength={20}
              autoFocus
              className="w-full pl-7 pr-10 py-2.5 border border-surface-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sage/30 focus:border-sage"
            />
            {isChanged && value.length >= 3 && (
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
          <p className="text-[11px] text-text-400 mt-1.5">3-20 characters. Lowercase letters, numbers, and hyphens.</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-surface-100 text-text-600 hover:bg-surface-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              canSubmit
                ? "bg-sage text-white hover:bg-sage/90"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            {submitting ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
