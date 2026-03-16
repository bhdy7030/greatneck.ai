"use client";

import type { ChatMessage as ChatMessageType } from "@/lib/api";
import SourceCitation from "./SourceCitation";
import PermitTimeline, { type PermitPhase } from "./PermitTimeline";
import EmailDraftCard from "./EmailDraftCard";
import PlaybookCarousel, { type PlaybookCard } from "./PlaybookCarousel";
import PipelineSteps from "./PipelineSteps";
import CalendarCard from "./CalendarCard";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Regex to match [calendar:/api/events/{id}/calendar](Title | Date | Venue)
// Accepts numeric IDs and UUIDs; uses .+ (greedy) to handle titles with parentheses
const CALENDAR_RE = /\[calendar:(\/api\/events\/[\w-]+\/calendar)\]\((.+)\)/g;

interface CalendarMatch {
  url: string;
  title: string;
  date: string;
  time: string;
  venue: string;
}

/** Split message content into text segments and calendar card data. */
function splitCalendarCards(content: string): (string | CalendarMatch)[] {
  const parts: (string | CalendarMatch)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  CALENDAR_RE.lastIndex = 0;
  while ((match = CALENDAR_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    const [title = "Event", date = "", time = "", venue = ""] = match[2].split("|").map((s) => s.trim());
    parts.push({ url: match[1], title, date, time, venue });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }
  return parts;
}

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-lg font-bold mt-4 mb-2 text-text-900">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-base font-bold mt-3 mb-2 text-text-900">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-bold mt-3 mb-1 text-text-900">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 text-text-700">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc list-inside mb-2 space-y-1 text-text-700">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal list-inside mb-2 space-y-1 text-text-700">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="text-text-700">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-text-900">{children}</strong>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sage hover:underline"
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }: { className?: string; children?: React.ReactNode }) => {
    // Render permit-timeline blocks as visual stepper
    if (className === "language-permit-timeline") {
      try {
        const raw = String(children).trim();
        const data = JSON.parse(raw);
        const phases: PermitPhase[] = data.phases || data;
        const projectType: string | undefined = data.project_type;
        return <PermitTimeline phases={phases} projectType={projectType} />;
      } catch {
        // Fall through to normal code rendering if parse fails
      }
    }
    // Render guide-checklist blocks as interactive checklist
    if (className === "language-guide-checklist") {
      try {
        const data = JSON.parse(String(children).trim());
        const steps = (data.steps || data).map((s: Record<string, unknown>, i: number) => ({
          id: (s.id as string) || `step-${i}`,
          title: (s.title as string) || "",
          description: (s.description as string) || "",
          details: (s.details as string) || "",
          links: (s.links as { label: string; url: string }[]) || [],
          category: (s.category as string) || "",
          priority: (s.priority as string) || "medium",
          status: "todo" as const,
          remind_at: null,
          note: "",
          chat_prompt: (s.chat_prompt as string) || "",
        }));
        // Lazy import to avoid circular deps
        const GuideChecklist = require("./GuideChecklist").default;
        return <GuideChecklist guideId={data.guide_id || "inline"} steps={steps} />;
      } catch {
        // Fall through to normal code rendering if parse fails
      }
    }
    // Render email-draft blocks as copyable email card
    if (className === "language-email-draft") {
      try {
        const data = JSON.parse(String(children).trim());
        return <EmailDraftCard to={data.to} subject={data.subject} body={data.body} phone={data.phone} />;
      } catch {
        // Fall through to normal code rendering if parse fails
      }
    }
    // Render playbook-carousel blocks as horizontal guide carousel
    if (className === "language-playbook-carousel") {
      try {
        const guides: PlaybookCard[] = JSON.parse(String(children).trim());
        return <PlaybookCarousel guides={guides} />;
      } catch {
        // Fall through to normal code rendering if parse fails
      }
    }
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
  pre: ({ children }: { children?: React.ReactNode }) => {
    // If the child is a custom component (PermitTimeline, PlaybookCarousel, etc.),
    // render as a plain div — <pre> adds white-space:pre which prevents text wrapping
    const child = Array.isArray(children) ? children[0] : children;
    if (child && typeof child === "object" && "type" in (child as React.ReactElement)) {
      const el = child as React.ReactElement;
      if (typeof el.type !== "string") {
        // Custom React component, not a raw <code> tag — skip <pre> wrapper
        return <>{children}</>;
      }
    }
    return (
      <pre className="bg-surface-200 rounded-lg overflow-x-auto my-2">{children}</pre>
    );
  },
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-gold pl-3 my-2 text-text-600 italic">
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-surface-300 px-2 py-1 bg-surface-200 text-left font-semibold text-text-700">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-surface-300 px-2 py-1 text-text-600">{children}</td>
  ),
};

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  // Pre-process assistant messages
  // Fix raw playbook JSON not wrapped in ```playbook-carousel fence
  let processedContent = message.content;
  if (!isUser) {
    // Match any JSON array containing objects with "id" and "step_count" fields
    processedContent = processedContent.replace(
      /\[(\s*\{[^[\]]*"id"\s*:[^[\]]*"step_count"\s*:\s*\d+[^[\]]*\}(?:\s*,\s*\{[^[\]]*\})*\s*)\]/g,
      (match) => {
        // Skip if already inside a code fence
        const before = processedContent.slice(0, processedContent.indexOf(match));
        const fenceCount = (before.match(/```/g) || []).length;
        if (fenceCount % 2 === 1) return match; // inside a code block
        return `\n\`\`\`playbook-carousel\n${match.trim()}\n\`\`\`\n`;
      }
    );
  }
  const contentParts = !isUser ? splitCalendarCards(processedContent) : null;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-5`}>
      <div
        className={`${isUser ? "max-w-[92%] md:max-w-[70%]" : "w-full min-w-0"} ${
          isUser
            ? "bg-sage text-white rounded-2xl rounded-br-md shadow-sm shadow-sage/10"
            : "bg-surface-50 border border-surface-200/60 shadow-sm text-text-800 rounded-2xl rounded-bl-md"
        } px-4 py-3`}
      >
        {/* Pipeline steps (collapsed) */}
        {!isUser && message.pipelineEvents && message.pipelineEvents.length > 0 && (
          <PipelineSteps events={message.pipelineEvents} isComplete={true} />
        )}

        {/* Agent badge */}
        {!isUser && message.agent && (
          <div className="mb-1.5">
            <span className="text-[10px] font-mono bg-sage/8 text-sage-dark px-2 py-0.5 rounded-md">
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
          <div className="prose prose-sm max-w-none text-sm leading-relaxed overflow-hidden break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            {contentParts!.map((part, i) =>
              typeof part === "string" ? (
                <ReactMarkdown
                  key={i}
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {part}
                </ReactMarkdown>
              ) : (
                <CalendarCard
                  key={i}
                  url={part.url}
                  title={part.title}
                  date={part.date}
                  time={part.time}
                  venue={part.venue}
                />
              )
            )}
          </div>
        )}

        {/* Sources — compact list */}
        {!isUser && message.sources && message.sources.length > 0 && (() => {
          const MAX_SOURCES = 5;
          const shown = message.sources!.slice(0, MAX_SOURCES);
          const remaining = message.sources!.length - MAX_SOURCES;
          return (
            <div className="mt-2 pt-1.5 border-t border-surface-300">
              <p className="text-[10px] text-text-600 font-medium uppercase tracking-wider mb-1">
                Sources ({message.sources!.length})
              </p>
              <div className="space-y-0">
                {shown.map((src, i) => (
                  <SourceCitation key={i} source={src} index={i} />
                ))}
                {remaining > 0 && (
                  <p className="text-[10px] text-text-500 mt-1">
                    (and {remaining} more)
                  </p>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
