#!/usr/bin/env node
/**
 * Web PWA layout check: reference screen sizes × browser engines × UI
 * languages × views, against fixture data on the static preview.
 *
 *   node scripts/web-layout-check.mjs [--base URL] [--classes phone,tablet,desktop]
 *     [--langs ko,en,es,ja,de,pt,fr] [--sizes 320x694,...] [--json out.json]
 *     [--shots dir] [--workers 4]
 *
 * Phone and tablet sizes run in Chromium (Chrome) and WebKit (Safari);
 * desktop sizes also run in Microsoft Edge (Playwright channel "msedge",
 * skipped with a warning when it is not installed). The sizes are the
 * reference sets in docs/webapp/specification.md. Checks: horizontal page
 * overflow, text wider or taller than its box (ellipsis is allowed only for
 * place names), weather actions on one row and, on touch screens, 16 px form
 * text and 44 px icon targets. Service workers are blocked so the fixtures
 * answer every request (Playwright WebKit bypasses page routes for pages a
 * service worker controls). Exit code 1 when any finding remains.
 */
import { chromium, webkit } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const KMA = read("docs/rewrite/examples/client-kma-response.json").response;
const NATION = read("web/src/demo/nation.json");
const WARNINGS = read("web/src/demo/warnings.json");

export const SIZES = {
  phone: [
    [402, 874],
    [393, 852],
    [390, 844],
    [440, 956],
    [375, 812],
    [430, 932],
    [375, 667],
    [414, 896],
    [428, 926],
    [420, 912],
    [384, 832],
    [360, 780],
    [412, 892],
    [412, 915],
    [360, 800],
    [320, 694],
    [360, 880],
    [412, 883],
    [384, 854],
    [412, 869],
  ],
  tablet: [
    [820, 1180],
    [1205, 753],
    [1280, 800],
    [1334, 800],
    [1180, 688],
    [1180, 629],
    [800, 1280],
    [753, 1205],
    [768, 1024],
    [810, 1080],
  ],
  // Screen sizes; the viewport is ~135 px shorter (taskbar and toolbars).
  desktop: [
    [1920, 1080],
    [2560, 1440],
    [1536, 864],
    [1024, 768],
    [3440, 1440],
    [1440, 900],
    [1280, 720],
    [2048, 1152],
    [800, 600],
    [1707, 1067],
  ],
};
export const ENGINES = {
  phone: ["chromium", "webkit"],
  tablet: ["chromium", "webkit"],
  desktop: ["chromium", "webkit", "msedge"],
};
const LOCALES = {
  ko: "ko-KR",
  en: "en-US",
  es: "es-ES",
  ja: "ja-JP",
  de: "de-DE",
  pt: "pt-BR",
  fr: "fr-FR",
};
const VIEWS = [
  "/weather/seoul/hourly",
  "/weather/seoul/daily",
  "/air/seoul",
  "/weather/seoul/overview",
  "/locations",
  "/nation/weather",
  "/nation/air",
  "/warnings",
  "/settings",
  "/help",
];
// Dark theme on the views with the most colour-dependent controls.
const DARK_VIEWS = [
  "/weather/seoul/hourly",
  "/air/seoul",
  "/nation/air",
  "/settings",
];
/** Place names may be ellipsized (address line, heading, station picker). */
export const PLACE_NAME =
  ".eyebrow, .place-title, .station-select, .station-select *";

function options(argv) {
  const o = {
    classes: ["phone", "tablet", "desktop"],
    langs: Object.keys(LOCALES),
    workers: 4,
  };
  for (let i = 0; i < argv.length; i++) {
    const [key, value] = [argv[i], argv[i + 1]];
    if (key === "--base") o.base = value;
    else if (key === "--classes") o.classes = value.split(",");
    else if (key === "--langs") o.langs = value.split(",");
    else if (key === "--json") o.json = value;
    else if (key === "--shots") o.shots = value;
    else if (key === "--workers") o.workers = Number(value);
    else if (key === "--sizes") o.sizes = value.split(",");
    else throw Error("Unknown option: " + key);
    i++;
  }
  return o;
}
async function startPreview() {
  if (!existsSync(join(ROOT, "web/dist/index.html")))
    throw Error(
      "web/dist is missing; run `npm run build:web` first or pass --base",
    );
  const server = createServer();
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address();
  await new Promise((ok) => server.close(ok));
  const child = spawn(process.execPath, ["scripts/web-static-preview.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/index.html")).ok) return { base, child };
    } catch {}
    await delay(100);
  }
  child.kill();
  throw Error("Static preview did not start");
}

/** Runs in the page: layout findings for the current view. */
export function measure({ touch, placeName }) {
  const out = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw)
    out.push(
      `page overflows horizontally (${document.documentElement.scrollWidth} > ${vw}): ` +
        [...document.querySelectorAll("body *")]
          .filter((e) => e.getBoundingClientRect().right > vw + 1)
          .slice(-3)
          .map(
            (e) =>
              e.tagName.toLowerCase() +
              [...e.classList].map((c) => "." + c).join(""),
          )
          .join(", "),
    );
  const visible = (e) =>
    e.offsetParent !== null && !e.closest("[inert]") && !e.closest("svg");
  const label = (e) =>
    e.tagName.toLowerCase() +
    [...e.classList].map((c) => "." + c).join("") +
    " «" +
    (e.textContent || "").trim().slice(0, 40) +
    "»";
  for (const e of document.querySelectorAll("main *, .topbar *, .sidebar *")) {
    if (!visible(e) || e.matches(placeName)) continue;
    const s = getComputedStyle(e);
    if (s.display === "inline") continue;
    const text = [...e.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim(),
    );
    if (!text) continue;
    if (e.scrollWidth > e.clientWidth + 1 && !/(auto|scroll)/.test(s.overflowX))
      out.push(`text wider than its box: ${label(e)}`);
    else if (
      e.scrollHeight > e.clientHeight + 2 &&
      s.overflowY !== "visible" &&
      !/(auto|scroll)/.test(s.overflowY)
    )
      out.push(`text taller than its box: ${label(e)}`);
  }
  const tops = [
    ...document.querySelectorAll(".weather-page-head .icon-button"),
  ].map((e) => Math.round(e.getBoundingClientRect().top));
  if (new Set(tops).size > 1) out.push("weather actions wrap to a second row");
  if (touch) {
    for (const e of document.querySelectorAll("input, select, textarea"))
      if (visible(e) && parseFloat(getComputedStyle(e).fontSize) < 16)
        out.push(`form text under 16 px: ${label(e)}`);
    for (const e of document.querySelectorAll(
      ".icon-button, .location-card-actions a, .sidebar-section-title a, .air-summary .section-head a",
    )) {
      if (!visible(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 44 || r.height < 44)
        out.push(`touch target under 44 px: ${label(e)}`);
    }
  }
  return out;
}

async function main() {
  // D1/D2 production adoption matrix: same static bundle, strict application CSP.
  if (process.argv.includes("--text-scale")) {
    await import("./verification/pwa-design-check.mjs");
    return;
  }
  const o = options(process.argv.slice(2));
  const preview = o.base ? null : await startPreview();
  const base = o.base ?? preview.base;
  const engines = {};
  for (const name of new Set(o.classes.flatMap((c) => ENGINES[c]))) {
    try {
      engines[name] =
        name === "webkit"
          ? await webkit.launch()
          : name === "msedge"
            ? await chromium.launch({ channel: "msedge" })
            : await chromium.launch();
    } catch (error) {
      console.warn(
        `WARN ${name} unavailable (${String(error.message).split("\n")[0]}); skipped`,
      );
    }
  }
  const jobs = [];
  for (const cls of o.classes)
    for (const [w, h] of SIZES[cls].filter(
      ([w, h]) => !o.sizes || o.sizes.includes(`${w}x${h}`),
    ))
      for (const engine of ENGINES[cls].filter((e) => engines[e]))
        for (const lang of o.langs)
          jobs.push({
            cls,
            w,
            h: cls === "desktop" ? h - 135 : h,
            engine,
            lang,
          });
  const findings = [];
  let views = 0;
  if (o.shots) mkdirSync(o.shots, { recursive: true });
  async function worker() {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      const touch = job.cls !== "desktop";
      for (const theme of ["light", "dark"]) {
        if (theme === "dark" && !["ko", "de"].includes(job.lang)) continue;
        const context = await engines[job.engine].newContext({
          locale: LOCALES[job.lang],
          viewport: { width: job.w, height: job.h },
          hasTouch: touch,
          isMobile: touch && job.engine !== "msedge" && job.cls === "phone",
          serviceWorkers: "block",
        });
        await context.addInitScript((t) => {
          if (t === "dark" && !localStorage.getItem("tw.web.v1.preferences"))
            localStorage.setItem(
              "tw.web.v1.preferences",
              JSON.stringify({
                version: 1,
                places: [],
                selectedId: null,
                settings: { theme: "dark" },
              }),
            );
        }, theme);
        await context.route(
          "https://todayweather.wizardfactory.net/**",
          (route) => {
            const url = new URL(route.request().url());
            if (url.pathname.includes("/nation/"))
              return route.fulfill({ json: NATION });
            if (url.pathname.includes("/kma/special"))
              return route.fulfill({ json: WARNINGS });
            if (url.pathname.includes("/geocode/"))
              return route.fulfill({
                json: {
                  name: "명동",
                  country: "KR",
                  address: "대한민국 서울특별시 중구 명동",
                  location: { lat: 37.567, long: 126.978 },
                },
              });
            const body = structuredClone(KMA);
            body.units = {
              ...body.units,
              airUnit: url.searchParams.get("airUnit") ?? body.units.airUnit,
            };
            return route.fulfill({ json: body });
          },
        );
        const page = await context.newPage();
        await page.clock.setFixedTime(new Date("2026-09-23T10:30:00+09:00"));
        for (const view of theme === "dark" ? DARK_VIEWS : VIEWS) {
          const where = `${job.cls} ${job.w}x${job.h} ${job.engine} ${job.lang} ${theme} ${view}`;
          try {
            await page.goto(base + view);
            // Measure the rendered view, not the loading state (WebKit is
            // slower to finish the first render).
            await page
              .waitForFunction(
                () =>
                  !!document.querySelector("main") &&
                  !document.querySelector("main .spin"),
                null,
                { timeout: 15000 },
              )
              .catch(() => undefined);
            await page.waitForTimeout(300);
            if (await page.locator("main .spin").count())
              findings.push(`${where}: still loading after 15 s`);
            views++;
            for (const problem of await page.evaluate(measure, {
              touch,
              placeName: PLACE_NAME,
            }))
              findings.push(`${where}: ${problem}`);
            if (
              o.shots &&
              theme === "light" &&
              ["hourly", "air", "settings"].some(
                (v) => view.endsWith(v) || view.includes(`/${v}/`),
              )
            )
              await page.screenshot({
                path: join(
                  o.shots,
                  `${job.cls}-${job.w}x${job.h}-${job.engine}-${job.lang}-${view.split("/").filter(Boolean).join("-")}.png`,
                ),
              });
          } catch (error) {
            findings.push(
              `${where}: error ${String(error.message).split("\n")[0]}`,
            );
          }
        }
        await context.close();
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: o.workers }, worker));
  } finally {
    for (const browser of Object.values(engines)) await browser.close();
    preview?.child.kill();
  }
  const summary = {
    views,
    findings: findings.length,
    engines: Object.keys(engines),
    classes: o.classes,
    langs: o.langs,
  };
  if (o.json)
    writeFileSync(
      o.json,
      JSON.stringify({ ...summary, list: findings }, null, 1),
    );
  for (const f of findings.slice(0, 50)) console.log("FAIL " + f);
  console.log(
    `${findings.length ? "FAILED" : "PASSED"}: ${views} views, ${findings.length} findings (${summary.engines.join(", ")})`,
  );
  process.exitCode = findings.length ? 1 : 0;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
