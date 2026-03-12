"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { searchHandles, type HandleSearchResult } from "@/lib/api";

interface MentionInputProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function MentionInput({
  value,
  onChange,
  onSubmit,
  placeholder = "Write a comment...",
  disabled = false,
}: MentionInputProps) {
  const [suggestions, setSuggestions] = useState<HandleSearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionStart, setMentionStart] = useState(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const detectMention = useCallback(
    (text: string, cursorPos: number) => {
      // Look backwards from cursor to find @
      const beforeCursor = text.slice(0, cursorPos);
      const atIndex = beforeCursor.lastIndexOf("@");

      if (atIndex === -1) {
        setShowSuggestions(false);
        return;
      }

      // Check that @ is at start or preceded by whitespace
      if (atIndex > 0 && !/\s/.test(text[atIndex - 1])) {
        setShowSuggestions(false);
        return;
      }

      const query = beforeCursor.slice(atIndex + 1);
      // Stop if there's a space in the query (mention ended)
      if (/\s/.test(query)) {
        setShowSuggestions(false);
        return;
      }

      if (query.length < 1) {
        setShowSuggestions(false);
        return;
      }

      setMentionStart(atIndex);
      setSelectedIndex(0);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const results = await searchHandles(query);
          setSuggestions(results);
          setShowSuggestions(results.length > 0);
        } catch {
          setShowSuggestions(false);
        }
      }, 200);
    },
    []
  );

  const insertMention = useCallback(
    (handle: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursorPos = textarea.selectionStart;
      const before = value.slice(0, mentionStart);
      const after = value.slice(cursorPos);
      const newValue = `${before}@${handle} ${after}`;
      onChange(newValue);
      setShowSuggestions(false);

      // Set cursor after the inserted handle
      requestAnimationFrame(() => {
        const newPos = mentionStart + handle.length + 2; // @handle + space
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
      });
    },
    [value, mentionStart, onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(suggestions[selectedIndex].handle);
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
      }
      return;
    }

    // Submit on Enter (without shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    detectMention(newValue, e.target.selectionStart);
  };

  // Close on click outside
  useEffect(() => {
    if (!showSuggestions) return;
    const handler = () => setShowSuggestions(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showSuggestions]);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
        className="w-full px-3 py-2 border border-surface-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sage/30 focus:border-sage disabled:opacity-50"
      />

      {showSuggestions && suggestions.length > 0 && (
        <div
          className="absolute left-0 bottom-full mb-1 w-64 bg-white rounded-lg shadow-lg border border-surface-200 py-1 z-50 max-h-[200px] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {suggestions.map((s, i) => (
            <button
              key={s.id}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(s.handle);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                i === selectedIndex ? "bg-sage/10" : "hover:bg-surface-50"
              }`}
            >
              {s.avatar_url ? (
                <img src={s.avatar_url} alt="" className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-sage/20 flex items-center justify-center text-[10px] font-medium text-sage">
                  {s.name?.[0] || "?"}
                </div>
              )}
              <div>
                <span className="text-text-700 font-medium">@{s.handle}</span>
                <span className="text-text-400 ml-1.5">{s.name}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
