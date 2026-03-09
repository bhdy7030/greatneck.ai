"use client";

import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { useLanguage } from "./LanguageProvider";

interface ChatInputProps {
  onSend: (message: string, imageBase64?: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const { t } = useLanguage();
  const [text, setText] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleImageSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setImagePreview(result);
        const base64 = result.split(",")[1];
        setImageBase64(base64);
      };
      reader.readAsDataURL(file);
    },
    []
  );

  const clearImage = useCallback(() => {
    setImagePreview(null);
    setImageBase64(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && !imageBase64) return;

    onSend(trimmed, imageBase64 || undefined);
    setText("");
    clearImage();

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, imageBase64, onSend, clearImage]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  };

  return (
    <div className="border-t border-surface-300 bg-surface-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {imagePreview && (
        <div className="mb-2 flex items-center gap-2">
          <div className="relative">
            <img
              src={imagePreview}
              alt="Selected"
              className="w-16 h-16 object-cover rounded-lg border border-surface-300"
            />
            <button
              onClick={clearImage}
              className="absolute -top-1 -right-1 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-700 transition-colors"
            >
              x
            </button>
          </div>
          <span className="text-xs text-text-500">{t("input.imageAttached")}</span>
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="flex-shrink-0 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-500 hover:text-sage transition-colors disabled:opacity-50"
          title="Attach image"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageSelect}
        />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder={t("input.placeholder")}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-surface-50 text-text-800 rounded-xl px-4 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-sage placeholder-text-500 text-base md:text-sm disabled:opacity-50 border border-surface-300"
          style={{ minHeight: "42px", maxHeight: "160px", fontSize: "max(16px, 0.875rem)" }}
        />

        <button
          onClick={handleSend}
          disabled={disabled || (!text.trim() && !imageBase64)}
          className="flex-shrink-0 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center bg-sage text-white rounded-xl hover:bg-sage-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Send message"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
