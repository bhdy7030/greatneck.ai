"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function CallbackHandler() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");
    const refresh = searchParams.get("refresh");

    if (token) {
      // Store tokens for web (in case this loads in a regular browser)
      localStorage.setItem("gn_token", token);
      if (refresh) localStorage.setItem("gn_refresh", refresh);

      // Try custom URL scheme to redirect back to native app
      // SFSafariViewController will hand off to iOS which opens the app
      const params = new URLSearchParams();
      params.set("token", token);
      if (refresh) params.set("refresh", refresh);
      window.location.href = `greatneck://callback?${params.toString()}`;

      // Fallback: if custom scheme didn't work (web browser), go home
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    } else {
      window.location.href = "/";
    }
  }, [searchParams]);

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-sm text-text-500">Signing in...</div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <CallbackHandler />
    </Suspense>
  );
}
