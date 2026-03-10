"use client";

import { useState } from "react";
import { useLanguage } from "./LanguageProvider";

interface EmailDraftCardProps {
  to: string;
  subject: string;
  body: string;
  phone?: string;
}

export default function EmailDraftCard({ to, subject, body, phone }: EmailDraftCardProps) {
  const [copied, setCopied] = useState(false);
  const { t } = useLanguage();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = body;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const mailtoUrl = to
    ? `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : undefined;

  return (
    <div className="bg-surface-100 border border-surface-300 rounded-xl p-4 my-3">
      {/* To */}
      {to ? (
        <div className="mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-500">To</span>
          <p className="text-sm text-text-800 font-medium">{to}</p>
        </div>
      ) : phone ? (
        <div className="mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-500">Phone</span>
          <p className="text-sm text-text-800 font-medium">{phone}</p>
        </div>
      ) : null}

      {/* Subject */}
      <div className="mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-500">Subject</span>
        <p className="text-sm text-text-800 font-medium">{subject}</p>
      </div>

      {/* Body */}
      <div className="mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-500">Body</span>
        <pre className="text-sm text-text-700 whitespace-pre-wrap font-sans mt-1 bg-surface-50 rounded-lg p-3 border border-surface-200">
          {body}
        </pre>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleCopy}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-sage text-white hover:bg-sage-dark transition-colors"
        >
          {copied ? t("email.copied") : t("email.copyEmail")}
        </button>
        {mailtoUrl && (
          <a
            href={mailtoUrl}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-sage text-sage hover:bg-sage/10 transition-colors inline-flex items-center"
          >
            {t("email.openMail")}
          </a>
        )}
      </div>
    </div>
  );
}
