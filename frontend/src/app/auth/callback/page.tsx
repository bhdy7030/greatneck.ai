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
      // Store tokens
      localStorage.setItem("gn_token", token);
      if (refresh) localStorage.setItem("gn_refresh", refresh);

      // Close the system browser if opened via @capacitor/browser
      import("@capacitor/browser")
        .then(({ Browser }) => Browser.close())
        .catch(() => {});

      // Redirect to home
      window.location.href = "/";
    } else {
      // No token — redirect home
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
