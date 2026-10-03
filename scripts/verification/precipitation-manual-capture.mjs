/** Capture #2598 labels from the production PWA using isolated KMA fixtures. */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const out = "docs/webapp/manual-images";
const raw = JSON.parse(
  readFileSync("docs/rewrite/examples/client-kma-response.json"),
).response;
raw.current = { ...raw.current, date: "20260925", time: 12, rn1: 0, sn1: 0 };
raw.short = [
  {
    date: "20260925",
    time: 15,
    t3h: 22,
    r06: 5,
    r06Hours: 6,
    s06: 10,
    s06Hours: 6,
  },
  {
    date: "20260925",
    time: 18,
    t3h: 21,
    r06: 40.5,
    r06Hours: 3,
    r06Approx: true,
  },
  {
    date: "20260925",
    time: 21,
    t3h: 20,
    r06: 0,
    r06Hours: 0,
    s06: 0,
    s06Hours: 0,
    pop: 65,
  },
];
raw.shortest = [
  { date: "20260925", time: 13, rn1: 2, rn1Approx: false, t1h: 22 },
];
raw.midData.dailyData = [
  {
    date: "20260925",
    time: "0000",
    tmn: 18,
    tmx: 24,
    r06: 5.5,
    r06Hours: 24,
    s06: 10,
    s06Hours: 24,
    s06Approx: true,
  },
];
const server = spawn(process.execPath, ["scripts/web-static-preview.mjs"], {
  env: { ...process.env, PORT: "4181" },
  stdio: ["ignore", "pipe", "inherit"],
});
let browser;
try {
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", (code) => reject(Error(`Preview exited: ${code}`)));
  });
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  });
  const page = await browser.newPage({
    viewport: { width: 820, height: 1180 },
    locale: "ko-KR",
    bypassCSP: true,
  });
  await page.route("**/*", (r) =>
    new URL(r.request().url()).origin === "http://127.0.0.1:4181"
      ? r.continue()
      : new URL(r.request().url()).pathname.startsWith("/weather/")
        ? r.fulfill({ json: raw })
        : r.abort(),
  );
  const provenance = JSON.parse(readFileSync(`${out}/provenance.json`));
  for (const [view, text] of [
    ["hourly", "강수 약 40.5 mm · 3시간 예보"],
    ["daily", "강수 5.5 mm · 24시간 예보"],
  ]) {
    await page.goto(`http://127.0.0.1:4181/weather/seoul/${view}`);
    const panel = page
      .locator("section.panel")
      .filter({
        has: page.getByRole("heading", { name: "강수·눈 예보", exact: true }),
      });
    await panel.getByText(text, { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const file = `precipitation-${view}.png`;
    await panel.screenshot({ path: `${out}/${file}` });
    const entry = {
      file,
      sha256: createHash("sha256")
        .update(readFileSync(`${out}/${file}`))
        .digest("hex"),
      date: "2026-10-03",
      browser: browser.version(),
      fixture: "scripts/verification/precipitation-manual-capture.mjs",
      scenario: view === "hourly" ? "2598-S1/S3" : "2598-S2",
    };
    provenance.images = provenance.images
      .filter((image) => image.file !== file)
      .concat(entry);
  }
  writeFileSync(
    `${out}/provenance.json`,
    JSON.stringify(provenance, null, 2) + "\n",
  );
} finally {
  await browser?.close();
  server.kill();
}
