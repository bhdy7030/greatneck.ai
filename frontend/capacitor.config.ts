import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ai.greatneck.app",
  appName: "GreatNeck.ai",
  webDir: "out",
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#F6F8FA",
      showSpinner: false,
      launchAutoHide: true,
    },
    StatusBar: {
      style: "Light",
      backgroundColor: "#F6F8FA",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
