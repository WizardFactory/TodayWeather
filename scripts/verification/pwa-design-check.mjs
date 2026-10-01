/** Exercises the actual static PWA under its production CSP with isolated API fixtures. */
import { chromium, webkit } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const arg = (key, fallback) => {
  const i = process.argv.indexOf(key);
  return i < 0 ? fallback : process.argv[i + 1];
};
const out = resolve(
  arg("--out", "reports/sdlc/issue-2649-pwa-adoption/browser"),
);
mkdirSync(out, { recursive: true });
const edge = process.argv.includes("--edges");
const expanded = process.argv.includes("--expanded");
const factors = arg(
  "--text-scale",
  process.argv.includes("--quick") || edge ? "1" : "1,1.5,2",
)
  .split(",")
  .map(Number);
if (factors.some((f) => !Number.isFinite(f) || f <= 0))
  throw Error("Invalid --text-scale");
const quick = process.argv.includes("--quick"),
  base = arg("--base", "http://127.0.0.1:4178");
const child = process.argv.includes("--base")
  ? null
  : spawn(process.execPath, ["scripts/web-static-preview.mjs"], {
      env: { ...process.env, PORT: "4178" },
      stdio: ["ignore", "pipe", "inherit"],
    });
if (child)
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("exit", (code) => reject(Error(`preview exited ${code}`)));
  });
const fixture = JSON.parse(
  readFileSync("docs/rewrite/examples/client-kma-response.json"),
).response;
const id = "p_37.567_126.978",
  reports = [],
  failures = [],
  versions = {},
  blocked = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push({ name, detail });
};
const langs =
  quick || edge ? ["ko"] : ["ko", "en", "ja", "de", "fr", "es", "pt"];
const profiles = edge
  ? [
      { name: "phone-small", width: 320, height: 694, touch: true, body: 17 },
      {
        name: "tablet-landscape",
        width: 1180,
        height: 629,
        touch: true,
        body: 18,
      },
      {
        name: "phone-landscape",
        width: 874,
        height: 402,
        touch: true,
        body: 17,
      },
      {
        name: "desktop-short",
        width: 800,
        height: 465,
        touch: false,
        body: 16,
      },
    ]
  : [
      { name: "mobile", width: 402, height: 874, touch: true, body: 17 },
      { name: "tablet", width: 820, height: 1180, touch: true, body: 18 },
      { name: "desktop", width: 1440, height: 900, touch: false, body: 16 },
    ];
function geometry() {
  const visible = (e) => {
    const r = e.getBoundingClientRect(),
      s = getComputedStyle(e);
    return (
      r.width > 0 &&
      r.height > 0 &&
      s.visibility !== "hidden" &&
      s.display !== "none"
    );
  };
  const failures = [];
  const cells = [...document.querySelectorAll(".hourly-columns .chart-column")];
  const wind = cells.flatMap((cell) => [
    ...cell.querySelectorAll(".chart-wind-direction"),
  ]);
  for (let i = 1; i < wind.length; i++) {
    const previous = wind[i - 1].getBoundingClientRect();
    const current = wind[i].getBoundingClientRect();
    if (previous.right > current.left + 1)
      failures.push("overlapping expanded wind directions");
  }
  if (document.documentElement.scrollWidth > innerWidth + 1)
    failures.push(
      `page width ${document.documentElement.scrollWidth}/${innerWidth}`,
    );
  const walker = document.createTreeWalker(
    document.querySelector("main"),
    NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const e = node.parentElement;
    if (
      !node.textContent.trim() ||
      !e ||
      !visible(e) ||
      e.closest(".chart-scroll,.table-scroll,.bar-chart,details:not([open])")
    )
      continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width > 0 && (r.left < -1 || r.right > innerWidth + 1))
      failures.push(
        `${e.className || e.tagName}: ${node.textContent.trim().slice(0, 35)} outside ${Math.round(r.left)}..${Math.round(r.right)}`,
      );
  }
  return {
    failures,
    body: parseFloat(getComputedStyle(document.body).fontSize),
    root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    appearance: document.documentElement.dataset.appearance,
    hero: parseFloat(
      getComputedStyle(document.querySelector(".temperature") ?? document.body)
        .fontSize,
    ),
    sections: [...document.querySelectorAll("[data-weather-section]")].map(
      (e) => e.dataset.weatherSection,
    ),
  };
}
try {
  for (const [name, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch();
    versions[name] = browser.version();
    try {
      for (const profile of profiles)
        for (const lang of langs)
          for (const appearance of ["light", "dark"])
            for (const factor of factors) {
              const context = await browser.newContext({
                viewport: { width: profile.width, height: profile.height },
                locale: lang === "ko" ? "ko-KR" : lang,
                hasTouch: profile.touch,
                isMobile: profile.touch && profile.body === 17,
                colorScheme: appearance,
                serviceWorkers: "block",
              });
              await context.addInitScript(
                ({ lang, appearance, expanded }) => {
                  localStorage.setItem(
                    "tw.web.v1.preferences",
                    JSON.stringify({
                      version: 1,
                      places: [],
                      selectedId: null,
                      settings: { language: lang },
                    }),
                  );
                  localStorage.setItem(
                    "tw.web.v1.display",
                    JSON.stringify({
                      version: 1,
                      appearance,
                      heroStyle: "sky",
                      textScale: 1,
                      chartExpanded: expanded,
                      motion: false,
                    }),
                  );
                },
                { lang, appearance, expanded },
              );
              const routeFixture = async (route) => {
                const url = new URL(route.request().url());
                if (url.origin === new URL(base).origin)
                  return route.continue();
                if (
                  url.origin === "https://todayweather.wizardfactory.net" &&
                  url.pathname.startsWith("/weather/")
                ) {
                  const json = structuredClone(fixture);
                  json.units.airUnit =
                    url.searchParams.get("airUnit") ?? json.units.airUnit;
                  return route.fulfill({ json });
                }
                blocked.push(url.origin + url.pathname);
                return route.abort();
              };
              await context.route("**/*", routeFixture);
              const page = await context.newPage(),
                errors = [];
              page.on("pageerror", (e) => errors.push(e.message));
              page.on("console", (m) => {
                if (
                  /Content Security Policy|Refused to (apply|load|execute|connect)/i.test(
                    m.text(),
                  )
                )
                  errors.push(m.text());
              });
              await page.clock.setFixedTime(new Date("2026-09-23T01:30:00Z"));
              for (const view of [
                `/weather/${id}/hourly`,
                `/air/${id}`,
                "/settings",
              ]) {
                const label = `${name}/${profile.name}/${lang}/${appearance}/${factor}/${view}`;
                await page.goto(base + view);
                await page.locator("main").waitFor();
                await page.waitForFunction(
                  () => !document.querySelector("main .spin"),
                );
                await page.evaluate(() => document.fonts.ready);
                if (factor !== 1)
                  await page.evaluate((f) => {
                    document.documentElement.style.fontSize = `${16 * f}px`;
                  }, factor);
                await page.waitForTimeout(50);
                const measured = await page.evaluate(geometry);
                check(label + " geometry", !measured.failures.length, measured);
                check(
                  label + " body tier",
                  Math.abs(measured.body - profile.body * factor) < 0.1,
                  measured,
                );
                if (view.startsWith("/weather/")) {
                  check(
                    label + " DOM order",
                    measured.sections.join(",") ===
                      "hero,hourly,daily,air,details",
                    measured.sections,
                  );
                  const scroller = page.locator(".hourly-chart");
                  await scroller.focus();
                  await scroller.press("End");
                  check(
                    label + " keyboard",
                    Number(await scroller.getAttribute("data-cursor")) ===
                      (await page
                        .locator(".hourly-columns .chart-column")
                        .count()) -
                        1,
                    await scroller.getAttribute("data-cursor"),
                  );
                }
                let violations = [];
                if (factor === 1 && !edge) {
                  // axe's WebKit elementsFromPoint polyfill injects a stylesheet. Audit a
                  // separate identical render with CSP bypass; the primary render still
                  // verifies the shipped CSP and records every application violation.
                  const auditContext = await browser.newContext({
                    viewport: { width: profile.width, height: profile.height },
                    locale: lang === "ko" ? "ko-KR" : lang,
                    hasTouch: profile.touch,
                    isMobile: profile.touch && profile.body === 17,
                    colorScheme: appearance,
                    serviceWorkers: "block",
                    storageState: await context.storageState(),
                    bypassCSP: true,
                  });
                  await auditContext.route("**/*", routeFixture);
                  const auditPage = await auditContext.newPage();
                  await auditPage.clock.setFixedTime(
                    new Date("2026-09-23T01:30:00Z"),
                  );
                  await auditPage.goto(base + view);
                  await auditPage.waitForFunction(
                    () =>
                      document.querySelector("main") &&
                      !document.querySelector("main .spin"),
                  );
                  await auditPage.evaluate(() => document.fonts.ready);
                  violations = (
                    await new AxeBuilder({ page: auditPage }).analyze()
                  ).violations
                    .filter((v) => ["serious", "critical"].includes(v.impact))
                    .map((v) => ({
                      id: v.id,
                      nodes: v.nodes.map((n) => ({
                        target: n.target,
                        summary: n.failureSummary,
                      })),
                    }));
                  check(label + " axe", !violations.length, violations);
                  if (["ko", "de"].includes(lang))
                    await auditPage
                      .locator(".toast")
                      .waitFor({ state: "hidden", timeout: 10000 });
                  if (factor === 1 && ["ko", "de"].includes(lang))
                    await auditPage.screenshot({
                      path: resolve(
                        out,
                        `${name}-${profile.name}-${lang}-${appearance}-${view.startsWith("/weather/") ? "weather" : view.startsWith("/air/") ? "air" : "settings"}.png`,
                      ),
                      fullPage: true,
                      caret: "initial",
                    });
                  await auditContext.close();
                }
                reports.push({ label, ...measured, violations });
              }
              check(
                `${name}/${profile.name}/${lang}/${appearance}/${factor} runtime`,
                errors.length === 0,
                errors,
              );
              console.log(
                `${name}/${profile.name}/${lang}/${appearance}/${factor}: ${failures.length} cumulative failures`,
              );
              await context.close();
            }
    } finally {
      await browser.close();
    }
  }
} finally {
  child?.kill();
}
writeFileSync(
  resolve(out, "results.json"),
  JSON.stringify(
    { versions, expanded, renders: reports.length, failures, reports, blocked },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      versions,
      renders: reports.length,
      failures: failures.length,
      sample: failures.slice(0, 8),
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
