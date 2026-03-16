"use client";

import OpenMojiIcon from "./OpenMojiIcon";

export interface PlaybookCard {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  step_count: number;
}

interface PlaybookCarouselProps {
  guides: PlaybookCard[];
}

export default function PlaybookCarousel({ guides }: PlaybookCarouselProps) {
  if (!guides || guides.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-surface-200/60">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <svg className="w-3.5 h-3.5 text-sage" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
        <p className="text-[11px] font-semibold text-text-500 uppercase tracking-wide">
          Related Playbooks
        </p>
      </div>

      {/* Cards — horizontal scroll */}
      <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide">
        {guides.map((guide) => (
          <a
            key={guide.id}
            href={`/guides/?open=${guide.id}`}
            className="flex-shrink-0 w-28 flex flex-col rounded-xl overflow-hidden bg-white shadow-sm shadow-surface-300/30 hover:shadow-md hover:shadow-sage/10 transition-all duration-200 hover:-translate-y-0.5 group ring-1 ring-surface-200/50 aspect-[3/4]"
          >
            {/* Color accent strip */}
            <div
              className="h-1 w-full shrink-0"
              style={{ backgroundColor: guide.color }}
            />
            {/* Icon */}
            <div className="flex items-center justify-center pt-3 pb-1 shrink-0 transition-transform duration-200 group-hover:scale-110">
              <OpenMojiIcon icon={guide.icon} size={30} />
            </div>
            {/* Title */}
            <div className="px-2 flex-1">
              <p className="text-[10px] font-semibold text-text-800 leading-tight line-clamp-2">
                {guide.title}
              </p>
            </div>
            {/* Footer */}
            <div className="px-2 pb-2 pt-1 shrink-0 flex items-center justify-between">
              <span className="text-[9px] text-text-400 tabular-nums">
                {guide.step_count} steps
              </span>
              <span className="text-[9px] font-medium text-sage group-hover:text-sage-dark transition-colors">
                →
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
