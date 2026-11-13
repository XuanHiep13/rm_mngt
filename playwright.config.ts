import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: `http://localhost:${process.env.TEST_PORT ?? "3000"}`,
    viewport: { width: 1440, height: 1000 },
    channel: process.env.TEST_BROWSER_CHANNEL,
    launchOptions:
      process.platform === "darwin"
        ? {
            executablePath:
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          }
        : {},
  },
  reporter: "list",
});
