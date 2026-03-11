"use client";

import { getOpenMojiUrl, getPlaybookEmoji } from "@/lib/playbook-icons";

interface OpenMojiIconProps {
  icon: string;
  size?: number;
  className?: string;
}

/**
 * Renders an OpenMoji SVG emoji via CDN with native emoji fallback.
 * Uses <img> for consistent cross-platform rendering.
 */
export default function OpenMojiIcon({ icon, size = 48, className = "" }: OpenMojiIconProps) {
  const fallback = getPlaybookEmoji(icon);

  return (
    <img
      src={getOpenMojiUrl(icon)}
      alt={fallback}
      width={size}
      height={size}
      className={className}
      loading="eager"
      style={{ imageRendering: "auto" }}
      onError={(e) => {
        // Replace broken img with native emoji text
        const span = document.createElement("span");
        span.textContent = fallback;
        span.style.fontSize = `${size * 0.75}px`;
        span.style.lineHeight = "1";
        (e.target as HTMLElement).replaceWith(span);
      }}
    />
  );
}
