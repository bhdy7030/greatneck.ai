"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import OpenMojiIcon from "./OpenMojiIcon";

interface ExploreCardProps {
  title: string;
  icon: string;
  color: string;
  description: string;
  totalCount: number;
  doneCount?: number;
  seasonLabel?: string | null;
  saved?: boolean;
  badge?: string | null;
  authorHandle?: string;
  likeCount?: number;
  index: number;
  onTap: () => void;
}

export default function ExploreCard({
  title,
  icon,
  color,
  description,
  totalCount,
  doneCount,
  seasonLabel,
  saved,
  badge,
  authorHandle,
  likeCount,
  index,
  onTap,
}: ExploreCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [tiltStyle, setTiltStyle] = useState<React.CSSProperties>({});
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Scroll entrance via IntersectionObserver
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const rotateX = (0.5 - y) * 6;
    const rotateY = (x - 0.5) * 6;
    setTiltStyle({
      transform: `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(0.96)`,
    });
  }, []);

  const handlePointerUp = useCallback(() => {
    setTiltStyle({});
  }, []);

  const handlePointerLeave = useCallback(() => {
    setTiltStyle({});
    setHovered(false);
  }, []);

  const delay = Math.min(index * 80, 600);

  return (
    <div
      ref={cardRef}
      className={`relative aspect-[3/4] rounded-2xl overflow-hidden cursor-pointer select-none group ${
        visible ? "animate-exploreCardIn" : "opacity-0"
      }`}
      style={{
        animationDelay: visible ? `${delay}ms` : undefined,
        animationFillMode: "both",
        willChange: "transform",
        transformStyle: "preserve-3d",
        transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        boxShadow: hovered
          ? `0 8px 30px ${color}40, 0 0 0 1px ${color}20`
          : "0 2px 8px rgba(0,0,0,0.1)",
        ...tiltStyle,
      }}
      onClick={onTap}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={handlePointerLeave}
    >
      {/* Gradient background */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(160deg, ${color}ee 0%, ${color}bb 50%, ${color}88 100%)`,
        }}
      />

      {/* Animated shimmer overlay on hover */}
      <div
        className="absolute inset-0 z-[1] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.15) 50%, transparent 60%)",
          backgroundSize: "200% 100%",
          animation: hovered ? "shimmer 1.5s ease-in-out infinite" : "none",
        }}
      />

      {/* Season / Custom / Community badge */}
      {(seasonLabel || badge) && (
        <div className="absolute top-2.5 right-2.5 z-10 flex gap-1">
          {badge && (
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-white/25 text-white backdrop-blur-sm">
              {badge}
            </span>
          )}
          {seasonLabel && (
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-white/25 text-white backdrop-blur-sm">
              {seasonLabel}
            </span>
          )}
        </div>
      )}

      {/* OpenMoji icon — floats up on hover */}
      <div
        className="absolute inset-0 flex items-center justify-center z-[2] transition-transform duration-300 ease-out"
        style={{
          paddingBottom: "30%",
          transform: hovered ? "translateY(-4px) scale(1.08)" : "translateY(0) scale(1)",
        }}
      >
        <OpenMojiIcon
          icon={icon}
          size={64}
          className="drop-shadow-lg"
        />
      </div>

      {/* Bottom dark overlay for text */}
      <div className="absolute bottom-0 left-0 right-0 h-2/5 bg-gradient-to-t from-black/60 via-black/30 to-transparent z-[3]" />

      {/* Text content */}
      <div className="absolute bottom-0 left-0 right-0 p-3 z-[4]">
        <h3 className="text-sm font-bold text-white drop-shadow-sm leading-tight mb-0.5 line-clamp-2">
          {title}
        </h3>
        <p className="text-[10px] text-white/80 drop-shadow-sm line-clamp-2 mb-1.5">
          {description}
        </p>
        {authorHandle && authorHandle !== "admin" && (
          <p className="text-[9px] text-white/60 drop-shadow-sm mb-1">@{authorHandle}</p>
        )}
        {doneCount != null ? (
          /* Progress bar for "Mine" cards */
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-white/80 transition-all duration-500"
                style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }}
              />
            </div>
            <span className="text-[10px] text-white/70 tabular-nums">
              {doneCount}/{totalCount}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/70">
                {totalCount} steps
              </span>
              {likeCount != null && likeCount > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-white/70">
                  <svg className="w-3 h-3" fill="currentColor" stroke="none" viewBox="0 0 24 24">
                    <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                  {likeCount}
                </span>
              )}
            </div>
            {saved && (
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-white/25 backdrop-blur-sm">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
