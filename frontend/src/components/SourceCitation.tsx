"use client";

import { useState } from "react";
import type { SourceRef } from "@/lib/api";

interface SourceCitationProps {
  source: SourceRef;
  index: number;
}

export default function SourceCitation({ source, index }: SourceCitationProps) {
  const [expanded, setExpanded] = useState(false);

  const hostname = source.url
    ? (() => { try { return new URL(source.url).hostname.replace("www.", ""); } catch { return ""; } })()
    : "";

  return (
    <div className="group">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 text-left py-0.5 cursor-pointer"
      >
        <span className="text-[10px] font-mono text-sage-dark font-semibold w-4 text-right shrink-0">
          {index + 1}
        </span>

        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] text-sage hover:text-sage-dark hover:underline truncate"
          >
            {source.source}
          </a>
        ) : (
          <span className="text-[11px] text-text-600 truncate">
            {source.source}
          </span>
        )}

        {hostname && (
          <span className="text-[10px] text-text-600 shrink-0 hidden sm:inline">
            {hostname}
          </span>
        )}

        {source.section && source.section !== "web" && (
          <span className="text-[10px] text-text-600 shrink-0">
            {source.section}
          </span>
        )}

        {source.text && (
          <svg
            className={`w-3 h-3 text-text-600 transition-transform shrink-0 ml-auto ${
              expanded ? "rotate-180" : ""
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        )}
      </button>

      {expanded && source.text && (
        <div className="ml-5 mt-0.5 mb-1 pl-2 border-l-2 border-sage/30">
          <p className="text-[11px] text-text-700 leading-relaxed line-clamp-3">
            {source.text}
          </p>
        </div>
      )}
    </div>
  );
}
