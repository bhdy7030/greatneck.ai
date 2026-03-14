/**
 * Native mobile utilities — Capacitor plugin wrappers.
 * All functions are no-ops on web to allow shared code paths.
 */
import { Capacitor } from "@capacitor/core";

export const isNative = () => Capacitor.isNativePlatform();
export const getPlatform = () => Capacitor.getPlatform() as "ios" | "android" | "web";

// ── Camera ──

export async function takePhoto(): Promise<{
  base64: string;
  mime: string;
} | null> {
  if (!isNative()) return null;
  const { Camera, CameraResultType, CameraSource } = await import(
    "@capacitor/camera"
  );
  try {
    const photo = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt, // Let user choose camera or gallery
      width: 1920,
      height: 1920,
    });
    if (!photo.base64String) return null;
    const mime = photo.format === "png" ? "image/png" : "image/jpeg";
    return { base64: photo.base64String, mime };
  } catch {
    // User cancelled
    return null;
  }
}

// ── Share ──

export async function shareContent(opts: {
  title?: string;
  text?: string;
  url?: string;
}): Promise<void> {
  if (!isNative()) return;
  const { Share } = await import("@capacitor/share");
  await Share.share(opts);
}

// ── Haptics ──

export async function hapticLight(): Promise<void> {
  if (!isNative()) return;
  const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
  await Haptics.impact({ style: ImpactStyle.Light });
}

export async function hapticSuccess(): Promise<void> {
  if (!isNative()) return;
  const { Haptics, NotificationType } = await import("@capacitor/haptics");
  await Haptics.notification({ type: NotificationType.Success });
}

// ── Status Bar ──

export async function setStatusBarDark(): Promise<void> {
  if (!isNative()) return;
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  await StatusBar.setStyle({ style: Style.Dark });
  if (getPlatform() === "android") {
    await StatusBar.setBackgroundColor({ color: "#1a1a2e" });
  }
}

// ── Splash Screen ──

export async function hideSplash(): Promise<void> {
  if (!isNative()) return;
  const { SplashScreen } = await import("@capacitor/splash-screen");
  await SplashScreen.hide();
}

// ── Deep Linking ──

export function onAppUrlOpen(
  callback: (url: string) => void,
): (() => void) | undefined {
  if (!isNative()) return undefined;
  let listener: { remove: () => void } | undefined;
  import("@capacitor/app").then(({ App }) => {
    App.addListener("appUrlOpen", (data) => {
      callback(data.url);
    }).then((l) => {
      listener = l;
    });
  });
  return () => {
    listener?.remove();
  };
}
