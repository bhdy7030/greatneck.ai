/**
 * Native mobile utilities — Capacitor plugin wrappers.
 * All functions are no-ops on web to allow shared code paths.
 */
import { Capacitor } from "@capacitor/core";

export const isNative = () => Capacitor.isNativePlatform();
export const getPlatform = () => Capacitor.getPlatform() as "ios" | "android" | "web";

// ── Camera ──

export type TakePhotoResult =
  | { ok: true; base64: string; mime: string }
  | { ok: false; reason: "cancelled" | "denied" };

export async function takePhoto(): Promise<TakePhotoResult> {
  if (!isNative()) return { ok: false, reason: "cancelled" };

  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");

  // Explicitly check & request permissions before calling getPhoto.
  // Without this, getPhoto may silently throw on iOS instead of prompting.
  try {
    let perms = await Camera.checkPermissions();
    if (perms.camera === "denied") {
      return { ok: false, reason: "denied" };
    }
    if (perms.camera !== "granted") {
      perms = await Camera.requestPermissions({ permissions: ["camera", "photos"] });
      if (perms.camera !== "granted") {
        return { ok: false, reason: "denied" };
      }
    }
  } catch {
    // checkPermissions/requestPermissions failed — try getPhoto anyway
  }

  try {
    const photo = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt,
      width: 1920,
      height: 1920,
    });
    if (!photo.base64String) return { ok: false, reason: "cancelled" };
    const mime = photo.format === "png" ? "image/png" : "image/jpeg";
    return { ok: true, base64: photo.base64String, mime };
  } catch {
    return { ok: false, reason: "cancelled" };
  }
}

// ── Settings ──

export async function openSettings(): Promise<void> {
  if (!isNative()) return;
  window.open("app-settings:", "_system");
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

export async function setStatusBarLight(): Promise<void> {
  if (!isNative()) return;
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  await StatusBar.setStyle({ style: Style.Light });
  if (getPlatform() === "android") {
    await StatusBar.setBackgroundColor({ color: "#F6F8FA" });
  }
}

// ── Splash Screen ──

export async function hideSplash(): Promise<void> {
  if (!isNative()) return;
  const { SplashScreen } = await import("@capacitor/splash-screen");
  await SplashScreen.hide();
}

// ── Browser (external links) ──

/**
 * Open an external URL. On native, uses SFSafariViewController (in-app browser).
 * On web, opens in a new tab. Use this instead of target="_blank" or window.open().
 */
export async function openExternalLink(url: string): Promise<void> {
  if (isNative()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
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
