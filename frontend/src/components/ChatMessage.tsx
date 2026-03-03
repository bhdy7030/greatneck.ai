"use client";

import type { ChatMessage as ChatMessageType } from "@/lib/api";
import SourceCitation from "./SourceCitation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div
        className={`max-w-[85%] md:max-w-[70%] ${
          isUser
            ? "bg-sage text-white rounded-2xl rounded-br-md"
            : "bg-surface-50 border border-surface-300 shadow-sm text-text-800 rounded-2xl rounded-bl-md"
        } px-4 py-3`}
      >
        {/* Agent badge */}
        {!isUser && message.agent && (
          <div className="mb-1">
            <span className="text-[10px] font-mono bg-sage/10 text-sage-dark px-1.5 py-0.5 rounded">
              {message.agent}
            </span>
          </div>
        )}

        {/* Image thumbnail */}
        {message.image && (
          <div className="mb-2">
            <img
              src={`data:image/jpeg;base64,${message.image}`}
              alt="Attached"
              className="max-w-[200px] max-h-[200px] rounded-lg object-cover"
            />
          </div>
        )}

        {/* Message text */}
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {message.content}
          </div>
        ) : (
          <div className="prose prose-sm max-w-none text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <h1 className="text-lg font-bold mt-4 mb-2 text-text-900">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-base font-bold mt-3 mb-2 text-text-900">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-sm font-bold mt-3 mb-1 text-text-900">{children}</h3>
                ),
                p: ({ children }) => (
                  <p className="mb-2 text-text-700">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside mb-2 space-y-1 text-text-700">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside mb-2 space-y-1 text-text-700">{children}</ol>
                ),
                li: ({ children }) => (
                  <li className="text-text-700">{children}</li>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-text-900">{children}</strong>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sage hover:underline"
                  >
                    {children}
                  </a>
                ),
                code: ({ className, children, ...props }) => {
                  const isInline = !className;
                  return isInline ? (
                    <code className="bg-surface-200 text-text-700 px-1 py-0.5 rounded text-xs" {...props}>
                      {children}
                    </code>
                  ) : (
                    <code className={`${className} block bg-surface-200 text-text-700 p-3 rounded-lg text-xs overflow-x-auto my-2`} {...props}>
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => (
                  <pre className="bg-surface-200 rounded-lg overflow-x-auto my-2">{children}</pre>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-gold pl-3 my-2 text-text-600 italic">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto my-2">
                    <table className="min-w-full text-xs border-collapse">{children}</table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-surface-300 px-2 py-1 bg-surface-200 text-left font-semibold text-text-700">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-surface-300 px-2 py-1 text-text-600">{children}</td>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Sources — compact list */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-2 pt-1.5 border-t border-surface-300">
            <p className="text-[10px] text-text-600 font-medium uppercase tracking-wider mb-1">
              Sources ({message.sources.length})
            </p>
            <div className="space-y-0">
              {message.sources.map((src, i) => (
                <SourceCitation key={i} source={src} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
