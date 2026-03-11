"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackVisit } from "@/lib/api";

/**
 * Tracks page visits on route changes. Mount once in the layout.
 * Fire-and-forget, no visual output.
 */
export default function PageTracker() {
  const pathname = usePathname();

  useEffect(() => {
    trackVisit(pathname);
  }, [pathname]);

  return null;
}
