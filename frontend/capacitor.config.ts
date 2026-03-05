import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ai.greatneck.app",
  appName: "greatneck.ai",
  webDir: "out",
  server: {
    androidScheme: "https",
  },
};

export default config;
