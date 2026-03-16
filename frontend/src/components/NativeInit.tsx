"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { isNative, setStatusBarLight, hideSplash, onAppUrlOpen } from "@/lib/native";

/**
 * Initializes native platform features (status bar, splash screen, push notifications, deep links).
 * Renders nothing — mount once in the root layout.
 */
export default function NativeInit() {
  const { user } = useAuth();

  // Push notification registration (no-op on web)
  usePushNotifications(user?.id);

  // Native platform setup
  useEffect(() => {
    if (!isNative()) return;
    setStatusBarLight();
    hideSplash();

    // Handle Universal Links (OAuth callback, shared links)
    const cleanup = onAppUrlOpen((url) => {
      try {
        const parsed = new URL(url);
        const token = parsed.searchParams.get("token");
        const refresh = parsed.searchParams.get("refresh");
        if (token) {
          localStorage.setItem("gn_token", token);
          if (refresh) localStorage.setItem("gn_refresh", refresh);
          // Close system browser and reload to pick up auth
          import("@capacitor/browser")
            .then(({ Browser }) => Browser.close())
            .catch(() => {});
          window.location.href = "/";
          return;
        }
        // Handle other deep links — extract path and navigate
        const path = parsed.pathname;
        if (path && path !== "/") {
          window.location.href = path + parsed.search;
        }
      } catch {}
    });
    return cleanup;
  }, []);

  return null;
}
