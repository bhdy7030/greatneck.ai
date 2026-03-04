import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.askmura.app",
  appName: "AskMura",
  webDir: "out",
  server: {
    androidScheme: "https",
  },
};

export default config;
