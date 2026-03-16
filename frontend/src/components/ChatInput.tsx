"use client";

import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { useLanguage } from "./LanguageProvider";
import ImageAnnotator from "./ImageAnnotator";
import { isNative, takePhoto } from "@/lib/native";

interface ChatInputProps {
  onSend: (message: string, imageBase64?: string, imageMime?: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const { t } = useLanguage();
  const [text, setText] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>("image/jpeg");
  const [showAnnotator, setShowAnnotator] = useState(false);
  const [rawDataUrl, setRawDataUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const extractMime = (dataUrl: string): string => {
    const match = dataUrl.match(/^data:([^;]+);/);
    return match ? match[1] : "image/jpeg";
  };

  const handleImageSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setRawDataUrl(result);
        setShowAnnotator(true);
      };
      reader.readAsDataURL(file);
    },
    []
  );

  const handleAnnotatorDone = useCallback((mergedBase64: string, mime: string) => {
    setShowAnnotator(false);
    setImageBase64(mergedBase64);
    setImageMime(mime);
    setImagePreview(`data:${mime};base64,${mergedBase64}`);
    setRawDataUrl(null);
  }, []);

  const handleAnnotatorSkip = useCallback(() => {
    setShowAnnotator(false);
    if (rawDataUrl) {
      setImagePreview(rawDataUrl);
      setImageBase64(rawDataUrl.split(",")[1]);
      setImageMime(extractMime(rawDataUrl));
    }
    setRawDataUrl(null);
  }, [rawDataUrl]);

  const clearImage = useCallback(() => {
    setImagePreview(null);
    setImageBase64(null);
    setImageMime("image/jpeg");
    setRawDataUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && !imageBase64) return;

    onSend(trimmed, imageBase64 || undefined, imageBase64 ? imageMime : undefined);
    setText("");
    clearImage();

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, imageBase64, imageMime, onSend, clearImage]);

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
    <div
      className="px-3"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}
    >
      {/* Floating pill container */}
      <div
        className="mx-auto max-w-3xl rounded-[28px] bg-white px-3 py-2"
        style={{
          boxShadow: "0 8px 24px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)",
          border: "1px solid rgba(0,0,0,0.05)",
        }}
      >
        {/* Image preview */}
        {imagePreview && (
          <div className="mb-2 px-1 pt-1 flex items-center gap-2">
            <div className="relative">
              <img
                src={imagePreview}
                alt="Selected"
                className="w-14 h-14 object-cover rounded-xl border border-surface-200"
              />
              <button
                onClick={clearImage}
                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600 transition-colors"
              >
                ×
              </button>
            </div>
            <span className="text-[11px] text-text-400">{t("input.imageAttached")}</span>
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-1.5">
          {/* Camera button */}
          <button
            onClick={async () => {
              if (isNative()) {
                const result = await takePhoto();
                if (result) {
                  setImageBase64(result.base64);
                  setImageMime(result.mime);
                  setImagePreview(`data:${result.mime};base64,${result.base64}`);
                }
              } else {
                fileInputRef.current?.click();
              }
            }}
            disabled={disabled}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center text-text-400 hover:text-sage rounded-full hover:bg-surface-100 transition-colors disabled:opacity-40"
            title="Attach image"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageSelect}
          />

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder=""
            disabled={disabled}
            rows={1}
            className="flex-1 bg-transparent text-text-800 px-1 py-2 resize-none focus:outline-none placeholder-text-400 disabled:opacity-50 leading-snug"
            style={{ minHeight: "36px", maxHeight: "160px", fontSize: "16px" }}
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={disabled || (!text.trim() && !imageBase64)}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-sage text-white rounded-full hover:bg-sage-dark transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Send"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>

      {/* Image annotator modal */}
      {showAnnotator && rawDataUrl && (
        <ImageAnnotator
          imageDataUrl={rawDataUrl}
          onDone={handleAnnotatorDone}
          onSkip={handleAnnotatorSkip}
        />
      )}
    </div>
  );
}
