"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const components = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 last:mb-0">{children}</p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-text-800">{children}</strong>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sage underline underline-offset-2 hover:text-sage-dark"
    >
      {children}
    </a>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li>{children}</li>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-base font-bold text-text-900 mt-3 mb-1 font-sans">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-sm font-bold text-text-900 mt-2 mb-1 font-sans">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-semibold text-text-800 mt-2 mb-1 font-sans">{children}</h3>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-sage/40 pl-3 my-2 text-text-600 italic">
      {children}
    </blockquote>
  ),
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <pre className="bg-surface-100 rounded-lg p-3 my-2 overflow-x-auto text-[11px] font-mono leading-relaxed">
          <code>{children}</code>
        </pre>
      );
    }
    return (
      <code className="bg-surface-100 text-text-700 px-1 py-0.5 rounded text-[11px] font-mono">
        {children}
      </code>
    );
  },
  hr: () => <hr className="my-3 border-surface-200" />,
};

interface StepMarkdownProps {
  content: string;
  className?: string;
}

export default function StepMarkdown({ content, className = "" }: StepMarkdownProps) {
  return (
    <div className={`font-serif text-[13px] text-text-700 leading-[1.7] ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
