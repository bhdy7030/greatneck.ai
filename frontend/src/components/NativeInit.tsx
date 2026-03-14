"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { isNative, setStatusBarDark, hideSplash } from "@/lib/native";

/**
 * Initializes native platform features (status bar, splash screen, push notifications).
 * Renders nothing — mount once in the root layout.
 */
export default function NativeInit() {
  const { user } = useAuth();

  // Push notification registration (no-op on web)
  usePushNotifications(user?.id);

  // Native platform setup
  useEffect(() => {
    if (!isNative()) return;
    setStatusBarDark();
    hideSplash();
  }, []);

  return null;
}
