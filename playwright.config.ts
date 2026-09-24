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
      { outputFile: "reports/sdlc/webapp-implementation/browser-results.json" },
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
    command: "node web-api/dist/server.js",
    url: "http://127.0.0.1:4174/api/health",
    reuseExistingServer: false,
    env: {
      WEB_API_MODE: "demo",
      WEB_ORIGIN: "http://127.0.0.1:4174",
      HOST: "127.0.0.1",
      PORT: "4174",
    },
  },
});
