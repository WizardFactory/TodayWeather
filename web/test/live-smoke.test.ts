import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error standalone JavaScript smoke command
import * as smoke from "../../scripts/web-live-smoke.mjs";

// 2026-09-27 01:00 KST.
const now = Date.parse("2026-09-26T16:00:00Z");
const kma = (current: object, extra: object = {}) => ({
  source: "KMA",
  current,
  shortPubDate: "202609262300",
  ...extra,
});

it("derives the KMA current observation time like the app", () => {
  expect(
    smoke.kmaObservationTime(kma({ stnDateTime: "2026.09.27.00:50" })),
  ).toBe("2026.09.27.00:50");
  // Without stnDateTime: date plus an hour (<= 24) or HHMM time.
  expect(smoke.kmaObservationTime(kma({ date: "20260927", time: 1 }))).toBe(
    "202609270100",
  );
  expect(
    smoke.kmaObservationTime(kma({ date: "20260926", time: "2330" })),
  ).toBe("202609262330");
  expect(smoke.kmaObservationTime(kma({ date: "20260926", time: 2330 }))).toBe(
    "202609262330",
  );
  expect(smoke.kmaObservationTime(kma({ date: "2026-09-26", time: 7 }))).toBe(
    "202609260700",
  );
  expect(smoke.kmaObservationTime(kma({}))).toBeNull();
  expect(
    smoke.kmaObservationTime(kma({ date: "20260926", time: "2375" })),
  ).toBe(null);
  expect(smoke.kmaObservationTime(null)).toBeNull();
});

it("warns when Seoul observation or forecast times are stale (KST, pinned clock)", () => {
  const fresh = smoke.domesticFreshness(
    kma({ stnDateTime: "2026.09.27.00:50" }),
    { now },
  );
  expect(fresh.observation.status).toBe("pass");
  expect(fresh.observation.evidence).toMatchObject({
    ageHours: 0.2,
    limitHours: 3,
  });
  expect(fresh.forecast.status).toBe("pass");
  expect(fresh.forecast.evidence).toMatchObject({
    ageHours: 2,
    limitHours: 24,
  });
  // Exactly at the limits passes; just past them warns. A UTC reading of the
  // naive KST times would be 9 h off and flip these.
  const edge = smoke.domesticFreshness(
    kma({ stnDateTime: "2026.09.26.22:00" }, { shortPubDate: "202609260100" }),
    { now },
  );
  expect(edge.observation.status).toBe("pass");
  expect(edge.forecast.status).toBe("pass");
  const stale = smoke.domesticFreshness(
    kma({ stnDateTime: "2026.09.26.21:54" }, { shortPubDate: "202609260054" }),
    { now },
  );
  expect(stale.observation).toMatchObject({
    status: "warn",
    evidence: { ageHours: 3.1, note: "older than 3 h" },
  });
  expect(stale.forecast).toMatchObject({
    status: "warn",
    evidence: { ageHours: 24.1, note: "older than 24 h" },
  });
  // A stalled collector days behind, from date+time only.
  expect(
    smoke.domesticFreshness(
      kma({ date: "20260920", time: 12 }, { shortPubDate: "202609200500" }),
      { now },
    ).observation.evidence.ageHours,
  ).toBe(157);
  // The page notice warns even when the API time looks fresh.
  const notice = smoke.domesticFreshness(
    kma({ stnDateTime: "2026.09.27.00:50" }),
    { now, observationNotice: true, forecastNotice: true },
  );
  expect(notice.observation.status).toBe("warn");
  expect(notice.observation.evidence.note).toMatch(/stale-data notice/);
  expect(notice.forecast.status).toBe("warn");
  // Missing times warn; overseas (VC) bodies are not domestic and are skipped.
  const missing = smoke.domesticFreshness(
    { source: "KMA", current: {} },
    { now },
  );
  expect(missing.observation.evidence.note).toBe("no parseable time");
  expect(missing.forecast.status).toBe("warn");
  expect(smoke.domesticFreshness({ source: "VC" }, { now })).toMatchObject({
    observation: { status: "skip" },
    forecast: { status: "skip" },
  });
});

it("parses the service worker precache list from the built and source worker", () => {
  const source = readFileSync("web/public/sw.js", "utf8");
  const list = smoke.parsePrecache(source);
  expect(list).toContain("/index.html");
  expect(list).toContain("/theme.js");
  const built =
    'const VERSION = "abc";\nconst ASSETS = ["/","/index.html","/assets/a-1.js"];\n';
  expect(smoke.parsePrecache(built)).toEqual([
    "/",
    "/index.html",
    "/assets/a-1.js",
  ]);
  // An older release's list without /theme.js is still a valid list.
  expect(smoke.parsePrecache('const ASSETS = ["/","/icon.svg"];')).toEqual([
    "/",
    "/icon.svg",
  ]);
  for (const bad of [
    "",
    "<?xml version='1.0'?><Error><Code>AccessDenied</Code></Error>",
    "const ASSETS = [];",
    'const ASSETS = ["relative.js"];',
    "const ASSETS = [oops];",
    undefined,
  ])
    expect(smoke.parsePrecache(bad), String(bad)).toBeNull();
});

it("flags precache and shell entries that would break cache.addAll", () => {
  const problem = smoke.precacheEntryProblem;
  expect(problem("/theme.js", 200, "text/javascript")).toBeNull();
  expect(problem("/assets/a.js", 200, "application/javascript")).toBeNull();
  expect(problem("/", 200, "text/html; charset=utf-8")).toBeNull();
  expect(problem("/index.html", 200, "text/html")).toBeNull();
  expect(problem("/assets/a.css", 200, "text/css")).toBeNull();
  expect(problem("/icon.svg", 200, "image/svg+xml")).toBeNull();
  expect(problem("/icons/icon-192.png", 200, "image/png")).toBeNull();
  expect(
    problem("/manifest.webmanifest", 200, "application/manifest+json"),
  ).toBeNull();
  expect(problem("/unknown.bin", 200, undefined)).toBeNull();
  expect(problem("/theme.js", 404, "application/xml")).toBe(
    "/theme.js status 404",
  );
  expect(problem("/theme.js", 403, null)).toMatch(/403/);
  // An HTML fallback served for a script or icon is caught by its type.
  expect(problem("/theme.js", 200, "text/html; charset=utf-8")).toMatch(
    /content-type text\/html/,
  );
  expect(problem("/icon.svg", 200, "")).toMatch(/content-type \(none\)/);
  expect(problem("/index.html", 200, "application/xml")).toMatch(
    /content-type/,
  );
  expect(
    smoke.shellReferences(
      '<link rel="icon" href="/icon.svg"/><script src="/theme.js"></script>' +
        '<script type="module" crossorigin src="/assets/i-1.js"></script>' +
        '<link rel="stylesheet" href="/assets/i-1.css"><a href="https://x.test/">' +
        '<link href="//cdn.test/x.css"><script src="/theme.js"></script>',
    ),
  ).toEqual(["/icon.svg", "/theme.js", "/assets/i-1.js", "/assets/i-1.css"]);
});

it("labels known warnings and lists every WARN and FAIL in the job summary", () => {
  const known = Object.keys(smoke.KNOWN_WARNINGS);
  // Every known name is a check the smoke actually records.
  const source = readFileSync("scripts/web-live-smoke.mjs", "utf8");
  for (const name of known)
    expect(
      source.includes(`"${name}"`) ||
        source.includes(name.replace(/24 h$/, "${FRESH_HOURS} h")),
      name,
    ).toBe(true);
  const checks = [
    { name: "deep link /", status: "pass", category: "hosting" },
    {
      name: known[0],
      status: "warn",
      category: "upstream",
      evidence: "no air | <b>",
    },
    {
      name: "API nation/KR contract and size",
      status: "warn",
      category: "upstream",
      evidence: "200, 1200000 bytes",
    },
    {
      name: "service worker precache entries return 200 with their content type",
      status: "fail",
      category: "hosting",
      evidence: "1 of 9 entries would fail install: /theme.js status 404",
    },
    { name: "skipped", status: "skip", category: "app" },
  ];
  const result = {
    base: "http://127.0.0.1:1",
    target: "preview",
    passed: false,
    release: { commit: "a".repeat(40) },
    counts: { pass: 1, warn: 2, skip: 1, fail: 1 },
    failures: { app: 0, hosting: 1, upstream: 0 },
    checks,
  };
  const md = smoke.summaryMarkdown(result);
  expect(md).toMatch(/^## Web live smoke FAILED/);
  expect(md).toContain(`| 1 | 2 (1 / 1) | 1 | 1 (0 / 1 / 0) |`);
  expect(md).toContain(
    "- FAIL `hosting` service worker precache entries return 200 with their content type — 1 of 9 entries would fail install: /theme.js status 404",
  );
  expect(md).toContain(
    "- **NEW** WARN `upstream` API nation/KR contract and size — 200, 1200000 bytes",
  );
  expect(md).toContain(
    `WARN (known: ${String(smoke.KNOWN_WARNINGS[known[0]]).replace(/[()]/g, (c) => "\\" + c)})`,
  );
  // Evidence cannot break the Markdown or inject HTML.
  expect(md).toContain("no air \\| \\<b\\>");
  // New warnings are listed before known ones; passes and skips are not listed.
  expect(md.indexOf("**NEW**")).toBeLessThan(md.indexOf("(known:"));
  expect(md).not.toContain("deep link /");
  expect(checks[1]).toMatchObject({ known: true });
  expect(checks[2]).toMatchObject({ known: false });
  expect(
    smoke.summaryMarkdown({ ...result, checks: [], passed: true }),
  ).toContain("No warnings or failures.");
  expect(
    smoke.summaryMarkdown({ base: null, passed: false, setupError: "boom" }),
  ).toContain("**Setup failed:** boom");
  expect(smoke.labelWarnings(checks, {})).toEqual({ known: 0, new: 2 });
});

it("keeps crafted values from reshaping the job summary (round 4, R4-2)", () => {
  const md = smoke.summaryMarkdown({
    base: "http://127.0.0.1:1",
    target: "preview",
    passed: false,
    release: { commit: "x`\n## Web live smoke passed\n![i](http://e/x)" },
    counts: { pass: 0, warn: 1, skip: 0, fail: 0 },
    failures: {},
    checks: [
      {
        name: "API nation/KR contract and size",
        status: "warn",
        category: "upstream",
        evidence: "[click](http://e) **bold** `code`",
      },
    ],
  });
  expect(md.match(/^## /gm)).toHaveLength(1);
  expect(md).not.toMatch(/!\[i\]\(/);
  expect(md).not.toMatch(/\[click\]\(/);
  expect(md).toContain("\\*\\*bold\\*\\*");
});

it("counts a warning as known only when its evidence condition matches (round 4, R4-3)", () => {
  const name = "non-KR weather (Tokyo) renders or reports an upstream error";
  const known = {
    [name]: {
      reason: "overseas weather returns 501",
      match: (e: any) => e?.status === 501 || e?.directProbe?.status === 501,
    },
  };
  const checks = [
    { name, status: "warn", category: "upstream", evidence: { status: 501 } },
    {
      name,
      status: "warn",
      category: "upstream",
      evidence: { directProbe: { status: 501 } },
    },
    { name, status: "warn", category: "upstream", evidence: { status: 503 } },
    {
      name,
      status: "warn",
      category: "upstream",
      evidence: { directProbe: { error: "getaddrinfo ENOTFOUND" } },
    },
  ];
  expect(smoke.labelWarnings(checks, known)).toEqual({ known: 2, new: 2 });
  expect(checks.map((c: any) => c.known)).toEqual([true, true, false, false]);
  // Fixed on 2026-09-27: an overseas failure is no longer a known warning.
  expect(Object.keys(smoke.KNOWN_WARNINGS)).not.toContain(name);
});

it("redacts URLs from upstream body snippets", () => {
  expect(
    smoke.redactUrls("Not Implemented: http://internal.example:8080/x?y=1 end"),
  ).toBe("Not Implemented: [url] end");
});
