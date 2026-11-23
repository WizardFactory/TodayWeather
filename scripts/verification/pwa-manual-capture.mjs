/** Actual scenario screenshots; static build and synthetic KMA fixture only. */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
// The live API sends 41 three-hour rows, from the day before yesterday 00h to
// the day after tomorrow 24h, so the chart has yesterday's comparison values.
// Live KMA observations come a few minutes after the hour (liveTime), so the
// current temperature sits between columns, as in the apps.
const shape = [0, -1, -2, 1, 4, 6, 4, 2];
const sky = ["moon", "moon", "sun", "sun", "sun", "sun", "sun", "moon"];
// Today's rows span 18 to 26, the fixture's daily range for 09-23.
const base = { 21: 12, 22: 14, 23: 20, 24: 16, 25: 15, 26: 15 };
fixture.short = Array.from({ length: 41 }, (_, i) => {
  const day = 21 + Math.floor(i / 8),
    slot = i % 8,
    rainy = day === 24 && slot >= 3 && slot <= 6;
  return {
    ...fixture.short[0],
    date: `202609${day}`,
    time: slot * 3,
    dateObj: `2026.09.${day} ${String(slot * 3).padStart(2, "0")}:00`,
    fromToday: day - 23,
    t3h: base[day] + shape[slot],
    skyIcon: rainy ? "rain" : sky[slot],
    pop: rainy ? 60 : day === 24 ? 30 : 0,
    ...(rainy ? { r06: 4, pty: 1 } : {}),
  };
});
Object.assign(fixture.current, {
  time: 7,
  liveTime: "0730",
  stnDateTime: "2026.09.23.07:30",
  t1h: 20,
  yesterday: {
    ...fixture.current.yesterday,
    time: 7,
    dateObj: "2026.09.22 07:00",
    t1h: 13,
  },
});
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
        date: "2026-11-23",
        browser: browser.version(),
        viewport: [820, 1180],
        fixture: "docs/rewrite/examples/client-kma-response.json",
        fixturePatch: "41 three-hour short rows (09-21 00h to 09-25 24h); current time 7, liveTime 0730, t1h 20, yesterday 13",
        externalRequests: "blocked except fixture fulfilment",
        csp: "screenshot context bypasses CSP for Playwright capture injection; separate primary matrix enforces production CSP",
        // Keep entries written by other capture scripts (precipitation-*.png).
        images: [
          ...images,
          ...(existsSync(`${out}/provenance.json`)
            ? JSON.parse(readFileSync(`${out}/provenance.json`)).images.filter(
                (old) => !images.some((img) => img.file === old.file),
              )
            : []),
        ],
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
  child.kill();
}
