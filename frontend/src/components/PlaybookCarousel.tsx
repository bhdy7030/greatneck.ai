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
    <div className="my-3 rounded-xl bg-gradient-to-br from-sage/5 to-gold/5 border border-sage/20 p-3">
      {/* Header — draws attention */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-sage/15">
          <svg className="w-3 h-3 text-sage" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </div>
        <p className="text-xs font-semibold text-sage-dark">
          Community Playbooks for this topic
        </p>
      </div>
      <p className="text-[11px] text-text-500 mb-2.5 leading-relaxed">
        Neighbors have shared step-by-step guides — tap one to follow along.
      </p>

      {/* Cards */}
      <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide">
        {guides.map((guide) => (
          <a
            key={guide.id}
            href={`/guides/?open=${guide.id}`}
            className="flex-shrink-0 w-[130px] flex flex-col rounded-lg overflow-hidden bg-white/80 border border-surface-300/60 hover:border-sage/50 shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 group"
          >
            {/* Color accent strip */}
            <div
              className="h-1 w-full shrink-0"
              style={{ backgroundColor: guide.color }}
            />
            {/* Icon */}
            <div className="flex items-center justify-center pt-3 pb-1 shrink-0 transition-transform duration-200 group-hover:scale-110">
              <OpenMojiIcon icon={guide.icon} size={38} />
            </div>
            {/* Title */}
            <div className="px-2.5 flex-1">
              <p className="text-[11px] font-semibold text-text-800 leading-tight line-clamp-2">
                {guide.title}
              </p>
              <p className="text-[9px] text-text-500 leading-tight line-clamp-2 mt-0.5">
                {guide.description}
              </p>
            </div>
            {/* Footer */}
            <div className="px-2.5 pb-2 pt-1.5 shrink-0 flex items-center justify-between">
              <span className="text-[9px] text-text-400 tabular-nums">
                {guide.step_count} steps
              </span>
              <span className="text-[9px] font-medium text-sage group-hover:text-sage-dark transition-colors">
                Open &rarr;
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
