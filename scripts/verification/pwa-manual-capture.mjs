/** Actual scenario screenshots; static build and synthetic KMA fixture only. */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const out = "docs/webapp/manual-images";
mkdirSync(out, { recursive: true });
const child = spawn(process.execPath, ["scripts/web-static-preview.mjs"], {
  env: { ...process.env, PORT: "4180" },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((r, j) => {
  child.stdout.once("data", r);
  child.once("exit", j);
});
const browser = await chromium.launch();
const fixture = JSON.parse(
  readFileSync("docs/rewrite/examples/client-kma-response.json"),
).response;
const page = await browser.newPage({
  viewport: { width: 820, height: 1180 },
  hasTouch: true,
  isMobile: true,
  locale: "en-US",
  bypassCSP: true,
});
const images = [];
try {
  await page.route("**/*", (r) =>
    new URL(r.request().url()).origin === "http://127.0.0.1:4180"
      ? r.continue()
      : new URL(r.request().url()).pathname.startsWith("/weather/")
        ? r.fulfill({ json: fixture })
        : r.abort(),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      "tw.web.v1.preferences",
      JSON.stringify({
        version: 1,
        places: [],
        selectedId: null,
        settings: { language: "en" },
      }),
    );
  });
  async function shot(name, locator) {
    await page.evaluate(() => document.fonts.ready);
    await locator.screenshot({ path: `${out}/${name}.png` });
    images.push({
      file: `${name}.png`,
      sha256: createHash("sha256")
        .update(readFileSync(`${out}/${name}.png`))
        .digest("hex"),
    });
  }
  await page.goto("http://127.0.0.1:4180/settings");
  const display = page
    .locator("section.panel")
    .filter({
      has: page.getByRole("heading", {
        name: "Display and updates",
        exact: true,
      }),
    });
  await shot("display", display);
  await page.goto("http://127.0.0.1:4180/weather/p_37.567_126.978/hourly");
  await page.locator(".temperature").waitFor();
  await page
    .getByRole("button", { name: "Show wind and humidity", exact: true })
    .click();
  await shot("hourly", page.locator('[data-weather-section="hourly"]'));
  await shot("daily", page.locator('[data-weather-section="daily"]'));
  await page.goto("http://127.0.0.1:4180/air/p_37.567_126.978");
  await page.locator(".air-detail").waitFor();
  await shot("air", page.locator(".air-detail"));
  await page.goto("http://127.0.0.1:4180/settings");
  await page
    .getByRole("combobox", { name: "Text size", exact: true })
    .selectOption("1.3");
  await shot("enlarged", display);
  await page
    .getByRole("button", {
      name: "Delete TodayWeather data in this browser",
      exact: true,
    })
    .click();
  await shot("confirmation", page.getByRole("dialog"));
  await page.keyboard.press("Escape");
  writeFileSync(
    `${out}/provenance.json`,
    JSON.stringify(
      {
        date: "2026-10-01",
        browser: browser.version(),
        viewport: [820, 1180],
        fixture: "docs/rewrite/examples/client-kma-response.json",
        externalRequests: "blocked except fixture fulfilment",
        csp: "screenshot context bypasses CSP for Playwright capture injection; separate primary matrix enforces production CSP",
        images,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
  child.kill();
}
