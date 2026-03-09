"use client";

import { useAuth } from "@/components/AuthProvider";

export default function TierBadge() {
  const { tier, usage } = useAuth();

  if (tier !== "pro") return null;

  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sage/20 text-sage font-medium">
      Sponsor
    </span>
  );
}
