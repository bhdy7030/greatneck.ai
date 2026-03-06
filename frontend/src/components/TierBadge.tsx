"use client";

import { useAuth } from "@/components/AuthProvider";

export default function TierBadge() {
  const { tier, usage } = useAuth();

  if (tier === "anonymous" || tier === "free") return null;

  if (tier === "free_promo") {
    let daysLeft = 0;
    if (usage?.promo_expires_at) {
      const exp = new Date(usage.promo_expires_at);
      daysLeft = Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86400000));
    }
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
        Trial ({daysLeft}d)
      </span>
    );
  }

  if (tier === "pro") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sage/20 text-sage font-medium">
        Pro
      </span>
    );
  }

  return null;
}
