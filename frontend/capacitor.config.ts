import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.greatneck.assistant",
  appName: "GreatNeck Assistant",
  webDir: "out",
  server: {
    androidScheme: "https",
  },
};

export default config;
