"use client";

import { useRef, useState, useCallback } from "react";
import OpenMojiIcon from "./OpenMojiIcon";

interface WalletCardProps {
  title: string;
  icon: string;
  color: string;
  description: string;
  doneCount: number;
  totalCount: number;
  seasonLabel?: string | null;
  index?: number;
  isExpanding?: boolean;
  onClick?: () => void;
}

export default function WalletCard({
  title,
  icon,
  color,
  description,
  doneCount,
  totalCount,
  seasonLabel,
  isExpanding,
  onClick,
}: WalletCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [tiltStyle, setTiltStyle] = useState<React.CSSProperties>({});
  const progress = totalCount > 0 ? (doneCount / totalCount) * 100 : 0;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const rotateX = (0.5 - y) * 6;
    const rotateY = (x - 0.5) * 6;
    setTiltStyle({
      transform: `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(0.98)`,
      boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
    });
  }, []);

  const handlePointerUp = useCallback(() => {
    setTiltStyle({});
  }, []);

  const handlePointerLeave = useCallback(() => {
    setTiltStyle({});
  }, []);

  return (
    <div
      ref={cardRef}
      className={`relative bg-surface-50 border border-surface-300 rounded-xl shadow-md cursor-pointer min-h-[44px] ${isExpanding ? "animate-cardLift" : ""}`}
      style={{
        willChange: "transform",
        transformStyle: "preserve-3d",
        transition: "all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        background: `linear-gradient(135deg, ${color}08 0%, transparent 60%)`,
        ...tiltStyle,
      }}
      onClick={onClick}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      {/* Accent color strip */}
      <div
        className="h-1 rounded-t-xl"
        style={{ backgroundColor: color }}
      />

      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-1.5">
          <OpenMojiIcon icon={icon} size={24} />
          <h3 className="text-sm font-semibold text-text-900 truncate flex-1">
            {title}
          </h3>
          {seasonLabel && (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 whitespace-nowrap">
              {seasonLabel}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-1">
          <div className="flex-1 h-1.5 bg-surface-200 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, backgroundColor: color }}
            />
          </div>
          <span className="text-[10px] font-medium text-text-500 tabular-nums">
            {doneCount}/{totalCount}
          </span>
        </div>

        <p className="text-[11px] text-text-500 truncate">{description}</p>
      </div>
    </div>
  );
}
