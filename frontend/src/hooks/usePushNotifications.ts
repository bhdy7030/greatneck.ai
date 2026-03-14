"use client";

import { useEffect, useRef } from "react";
import { isNative, getPlatform } from "@/lib/native";
import { registerDeviceToken } from "@/lib/api";

/**
 * Registers for push notifications on native platforms.
 * Call this once in the root layout when the user is authenticated.
 */
export function usePushNotifications(userId: number | undefined) {
  const registered = useRef(false);

  useEffect(() => {
    if (!isNative() || !userId || registered.current) return;

    let cleanup: (() => void) | undefined;

    (async () => {
      const { PushNotifications } = await import(
        "@capacitor/push-notifications"
      );

      // Check / request permission
      let permStatus = await PushNotifications.checkPermissions();
      if (permStatus.receive === "prompt") {
        permStatus = await PushNotifications.requestPermissions();
      }
      if (permStatus.receive !== "granted") return;

      // Listen for registration
      const regListener = await PushNotifications.addListener(
        "registration",
        async (token) => {
          try {
            const platform = getPlatform() as "ios" | "android";
            await registerDeviceToken(token.value, platform);
            registered.current = true;
          } catch (err) {
            console.error("Failed to register device token:", err);
          }
        },
      );

      const errListener = await PushNotifications.addListener(
        "registrationError",
        (err) => {
          console.error("Push registration error:", err);
        },
      );

      cleanup = () => {
        regListener.remove();
        errListener.remove();
      };

      // Trigger registration
      await PushNotifications.register();
    })();

    return () => {
      cleanup?.();
    };
  }, [userId]);
}
