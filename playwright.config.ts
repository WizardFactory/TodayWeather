import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./web/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          process.env.WEB_BROWSER_RESULTS ??
          "test-results/browser-results.json",
      },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:4174",
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? {
          executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
          args: ["--no-sandbox"],
        }
      : undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/web-static-preview.mjs",
    url: "http://127.0.0.1:4174/index.html",
    reuseExistingServer: false,
    env: { PORT: "4174" },
  },
});
