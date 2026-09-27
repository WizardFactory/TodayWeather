/**
 * Unmocked, read-only smoke of the static web app and the public TodayWeather
 * API it calls. Usable before deployment (local preview of web/dist) and after
 * deployment (--base https://app.tdywx.xyz). Sends only GET requests, needs no
 * credentials and never writes to a server.
 *
 *   node scripts/web-live-smoke.mjs [--base <url>] [--json <out>]
 *     [--expect-commit <sha>]
 *
 * Without --base it starts scripts/web-static-preview.mjs on a free port
 * against web/dist and stops it by PID afterwards. Every check is recorded as
 * pass, warn, skip or fail with evidence and a category: `hosting` (static
 * responses and headers), `app` (rendered UI, CSP, page errors) or `upstream`
 * (public API availability or contract). Any fail exits with status 1; with
 * --json, each failed check also saves a full-page screenshot next to the
 * JSON file (<json>.fail-<check>.png). --expect-commit fails the run unless
 * release.json reports that commit (a prefix of at least 7 hex characters).
 *
 * Besides the rendered pages it checks that every /sw.js precache entry is
 * served, that the service worker installs and controls a reloaded page, and
 * that an offline deep link renders from its cache. Warnings never fail the
 * run; those listed in KNOWN_WARNINGS are labeled known. When
 * GITHUB_STEP_SUMMARY is set, a Markdown summary of the counts and every
 * WARN/FAIL line is appended to it.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const API_ORIGIN = "https://todayweather.wizardfactory.net";
/** Same console pattern as the e2e CSP guard in web/e2e/fixtures.ts. */
export const CSP_PATTERN =
  /Content Security Policy|Refused to (apply|load|execute|connect)/i;
export const DEEP_LINKS = [
  "/",
  "/locations",
  "/weather/seoul/hourly",
  "/weather/seoul/daily",
  "/air/seoul",
  "/nation/weather",
  "/nation/air",
  "/warnings",
  "/settings",
  "/help",
];
/** Suffixes produced by rainSuffix in web/src/Weather.tsx for KMA data. */
export const RAIN_LABELS = [
  "1시간 관측",
  "3시간 관측",
  "지금까지 관측",
  "관측 누적",
  "1시간 예보(근사)",
  "3시간 예보",
  "예보",
];
/** Weather request paths of the probed places (coordinates from PLACES). */
const SEOUL_WEATHER = "/weather/v000903/coord/37.567";
const TOKYO_WEATHER = "/weather/v000903/coord/35.69";
const FRESH_HOURS = 24;
/** The app's "관측 시각이 오래된 자료입니다" threshold (components.tsx). */
const OBSERVATION_FRESH_HOURS = 3;
/** The app's "발표 후 오래된 예보입니다" threshold (Weather.tsx). */
const FORECAST_FRESH_HOURS = 24;
const SW_TIMEOUT = 15_000;
/**
 * Chronic warnings, by exact check name, with the reason they are expected.
 * The job summary labels these "known"; any other warning is "NEW". Remove an
 * entry once its cause is fixed so a regression shows up as new again.
 */
export const KNOWN_WARNINGS = {
  "AirKorea credit on KMA weather":
    "the API returns no Seoul air observation (backend follow-up)",
  "Seoul air page renders":
    "the API returns no Seoul air stations (backend follow-up)",
  [`nation air observation times are within ${FRESH_HOURS} h`]:
    "nationwide air observations stopped in 2021 (backend follow-up)",
  // Overseas weather (#2585) and warnings (#2609) were fixed on 2026-09-27;
  // a Tokyo failure or stale warnings are new problems again.
};
const NATION_WARN_BYTES = 1_000_000;
const NATION_MAX_BYTES = 1_500_000; // The client rejects bodies above 2 MB.
const STEP_TIMEOUT = 30_000;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Precipitation texts whose basis label is missing or not a known label. */
export function unknownRainLabels(texts) {
  return texts.filter((raw) => {
    const text = raw.replace(/\s+/g, " ").trim();
    if (text === "강수 —" || /^강수확률 (\d+%|—)$/.test(text)) return false;
    const m = text.match(/^(강수량|강수 .+?)(?: · (.+))?$/);
    if (!m) return true;
    if (m[1] === "강수량")
      return m[2] !== undefined && !RAIN_LABELS.includes(m[2]);
    return m[2] === undefined || !RAIN_LABELS.includes(m[2]);
  });
}
/** True when a KMA "YYYY.MM.DD.HH:MM" time was shown without parsing. */
export function dottedKmaTime(text) {
  return /\d{4}\.\s?\d{1,2}\.\s?\d{1,2}/.test(text);
}

/** A finite number above the KMA invalid-value sentinels (as numberValue). */
const numeric = (v) =>
  (typeof v === "number" || typeof v === "string") &&
  String(v).trim() !== "" &&
  Number.isFinite(Number(v)) &&
  Number(v) > -100;
const rows = (v) => (Array.isArray(v) ? v.length : 0);
/**
 * Forecast-shape problems of a weather/coord body; [] when it can render.
 * KMA: rows in `short` or `shortest`, at least 3 `midData.dailyData` rows and
 * a numeric `current.t1h`. Overseas (`VC`): `hourly` rows, at least 3 `daily` rows and a
 * numeric `thisTime[1].t1h` (the current observation).
 */
export function weatherBodyProblems(json) {
  if (!json || typeof json !== "object" || Array.isArray(json))
    return ["body is not an object"];
  const problems = [];
  const overseas =
    json.source === "VC" || (!json.source && json.pubDate?.VC !== undefined);
  if (json.source === "KMA") {
    if (!rows(json.short) && !rows(json.shortest))
      problems.push("no short or shortest forecast rows");
    const daily = rows(json.midData?.dailyData);
    if (daily < 3) problems.push(`midData.dailyData has ${daily} rows (< 3)`);
    if (!numeric(json.current?.t1h))
      problems.push(
        "current.t1h is not numeric: " + JSON.stringify(json.current?.t1h),
      );
  } else if (overseas) {
    if (!rows(json.hourly)) problems.push("no hourly rows");
    const daily = rows(json.daily);
    if (daily < 3) problems.push(`daily has ${daily} rows (< 3)`);
    const now = Array.isArray(json.thisTime) ? json.thisTime[1] : undefined;
    if (!numeric(now?.t1h))
      problems.push(
        "thisTime[1].t1h is not numeric: " + JSON.stringify(now?.t1h),
      );
  } else problems.push("unknown source " + JSON.stringify(json.source));
  return problems;
}
/**
 * release.json `commit` against an optional expected commit (a prefix of at
 * least 7 lowercase hex characters). A `-dirty` build (local uncommitted
 * changes) warns, and fails when a commit is expected.
 */
export function releaseCommitStatus(commit, expect) {
  const fail = (evidence) => ({ status: "fail", evidence });
  const wanted = expect ? ` (expected ${expect})` : "";
  if (commit === undefined)
    return expect
      ? fail("release.json has no commit" + wanted)
      : {
          status: "warn",
          evidence:
            "release.json has no commit (built before release identity was added)",
        };
  if (
    typeof commit !== "string" ||
    !/^([0-9a-f]{40}(-dirty)?|unknown)$/.test(commit)
  )
    return fail("commit " + JSON.stringify(commit) + wanted);
  const dirty = commit.endsWith("-dirty");
  if (expect) {
    if (dirty)
      return fail(
        `commit ${commit} is a build of uncommitted changes${wanted}`,
      );
    if (!commit.startsWith(expect))
      return fail(`commit ${commit} does not match expected ${expect}`);
    return { status: "pass", evidence: `commit ${commit} matches ${expect}` };
  }
  if (dirty)
    return {
      status: "warn",
      evidence: `commit ${commit} is a build of uncommitted changes (the uploader refuses to --execute it)`,
    };
  return { status: "pass", evidence: "commit " + commit };
}
/**
 * Age in hours (0.1 h) of an API time: ISO 8601 with an offset, or a KST wall
 * time as YYYYMMDDHHMM, YYYY-MM-DD HH:MM or KMA's YYYY.MM.DD.HH:MM. Null when
 * the value cannot be parsed.
 */
export function observationAgeHours(value, now = Date.now()) {
  if (typeof value !== "string") return null;
  const m =
    value
      .trim()
      .match(
        /^(\d{4})[.-]?(\d{2})[.-]?(\d{2})[.T ]?(\d{2}):?(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i,
      ) ?? [];
  const [, y, mo, d, h, mi, sec = "00", frac = "", zone = "+09:00"] = m;
  if (!y || +mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 24 || +mi > 59)
    return null;
  const time = Date.parse(
    `${y}-${mo}-${d}T${h}:${mi}:${sec}${frac}${zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")}`,
  );
  return Number.isFinite(time) ? Math.round((now - time) / 360_000) / 10 : null;
}
/**
 * Freshness of API times: warns when any (`basis: "any"`) or the newest
 * (`basis: "newest"`) parsed time is older than `limitHours`, or when none of
 * several times parses. Evidence records the ages.
 */
export function freshness(
  times,
  { now = Date.now(), limitHours = FRESH_HOURS, basis = "any" } = {},
) {
  const ages = times
    .map((t) => observationAgeHours(t, now))
    .filter((a) => a !== null);
  const evidence = {
    basis,
    limitHours,
    count: times.length,
    parsed: ages.length,
  };
  if (!times.length) return { status: "pass", evidence };
  if (!ages.length)
    return {
      status: "warn",
      evidence: { ...evidence, note: "no parseable time" },
    };
  evidence.newestAgeHours = Math.min(...ages);
  evidence.oldestAgeHours = Math.max(...ages);
  evidence.olderThanLimit = ages.filter((a) => a > limitHours).length;
  const stale =
    basis === "newest"
      ? evidence.newestAgeHours > limitHours
      : evidence.olderThanLimit > 0;
  return { status: stale ? "warn" : "pass", evidence };
}
/**
 * KST wall time of a KMA body's current observation, as the app derives it:
 * `current.stnDateTime` (YYYY.MM.DD.HH:MM), else `current.date` plus
 * `current.time` (an hour up to 24, or HHMM). Null when neither is usable.
 */
export function kmaObservationTime(json) {
  const current = json?.current;
  if (typeof current?.stnDateTime === "string" && current.stnDateTime.trim())
    return current.stnDateTime.trim();
  const date = String(current?.date ?? "").replaceAll("-", "");
  if (!/^\d{8}$/.test(date)) return null;
  let hour = Number(current.time ?? 0);
  let minute = 0;
  if (
    (typeof current.time === "string" && current.time.length >= 3) ||
    hour > 24
  ) {
    minute = hour % 100;
    hour = Math.floor(hour / 100);
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 24 || minute > 59)
    return null;
  const pad = (n) => String(n).padStart(2, "0");
  return date + pad(hour) + pad(minute);
}
/**
 * Freshness of a domestic (KMA) weather body. `observation` warns when the
 * current observation is older than 3 h or the page shows the app's stale
 * observation notice; `forecast` warns when `shortPubDate` is older than 24 h
 * or the page shows the stale forecast notice. A missing or unparseable time
 * warns; a non-KMA body is skipped. Times are KST wall times.
 */
export function domesticFreshness(
  json,
  { now = Date.now(), observationNotice = false, forecastNotice = false } = {},
) {
  if (json?.source !== "KMA") {
    const skip = {
      status: "skip",
      evidence: "source " + JSON.stringify(json?.source) + " is not KMA",
    };
    return { observation: skip, forecast: skip };
  }
  const judge = (time, limitHours, notice, field) => {
    const ageHours = observationAgeHours(time, now);
    const evidence = { field, time, ageHours, limitHours, pageNotice: notice };
    const reasons = [];
    if (ageHours === null) reasons.push("no parseable time");
    else if (ageHours > limitHours) reasons.push(`older than ${limitHours} h`);
    if (notice) reasons.push("the page shows the stale-data notice");
    return reasons.length
      ? { status: "warn", evidence: { ...evidence, note: reasons.join("; ") } }
      : { status: "pass", evidence };
  };
  return {
    observation: judge(
      kmaObservationTime(json),
      OBSERVATION_FRESH_HOURS,
      observationNotice,
      "current.stnDateTime | current.date+time",
    ),
    forecast: judge(
      typeof json.shortPubDate === "string" ? json.shortPubDate : null,
      FORECAST_FRESH_HOURS,
      forecastNotice,
      "shortPubDate",
    ),
  };
}
/**
 * The precache list of a service worker script: the built
 * `const ASSETS = [...]` or the source `ASSETS = /*__PRECACHE__*\/ [...]`.
 * Null when no list of absolute paths can be parsed.
 */
export function parsePrecache(text) {
  const m = String(text ?? "").match(
    /\bASSETS\s*=\s*(?:\/\*__PRECACHE__\*\/\s*)?(\[[\s\S]*?\])/,
  );
  if (!m) return null;
  let list;
  try {
    list = JSON.parse(m[1].replace(/,\s*\]$/, "]"));
  } catch {
    return null;
  }
  return Array.isArray(list) &&
    list.length &&
    list.every((p) => typeof p === "string" && p.startsWith("/"))
    ? list
    : null;
}
/** Same-origin absolute paths in index.html `src`/`href` attributes. */
export function shellReferences(html) {
  const paths = [
    ...String(html ?? "").matchAll(/\s(?:src|href)=["']?(\/[^"'\s>]*)/gi),
  ]
    .map((m) => m[1])
    .filter((p) => !p.startsWith("//"));
  return [...new Set(paths)];
}
const PRECACHE_TYPES = [
  [/(^\/|\.html)$/, /^text\/html/],
  [/\.m?js$/, /^(text|application)\/(java|ecma)script/],
  [/\.css$/, /^text\/css/],
  [/\.svg$/, /^image\/svg\+xml/],
  [/\.png$/, /^image\/png/],
  [/\.webmanifest$/, /^application\/(manifest\+)?json/],
  [/\.json$/, /json/],
  [/\.woff2$/, /^font\/woff2/],
];
/**
 * Why a precache entry would break the worker's all-or-nothing
 * `cache.addAll`, or null: a non-200 status, or a content type that does not
 * match the file (for example an HTML fallback served for a script).
 */
export function precacheEntryProblem(path, status, contentType) {
  if (status !== 200) return `${path} status ${status}`;
  const type = String(contentType ?? "")
    .trim()
    .toLowerCase();
  const expected = PRECACHE_TYPES.find(([file]) => file.test(path))?.[1];
  if (expected && !expected.test(type))
    return `${path} content-type ${contentType || "(none)"}`;
  return null;
}
// Evidence and names are data: escape every character Markdown or HTML acts on.
const cell = (text, max = 300) => {
  const flat = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return (flat.length > max ? flat.slice(0, max - 1) + "…" : flat).replace(
    /[\\`*_[\]()#!~|<>]/g,
    (c) => "\\" + c,
  );
};
/** Upstream bodies can name internal hosts; keep URLs out of public logs. */
export const redactUrls = (text) =>
  String(text ?? "").replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "[url]");
/**
 * Marks warnings listed in `known` (check name -> reason) as known and the
 * rest as new. Returns { known, new } counts.
 */
export function labelWarnings(checks, known = KNOWN_WARNINGS) {
  const counts = { known: 0, new: 0 };
  for (const c of checks) {
    if (c.status !== "warn") continue;
    const entry = Object.hasOwn(known, c.name) ? known[c.name] : undefined;
    const reason =
      typeof entry === "string"
        ? entry
        : entry && (!entry.match || entry.match(c.evidence))
          ? entry.reason
          : undefined;
    c.known = reason !== undefined;
    if (c.known) c.knownReason = reason;
    counts[c.known ? "known" : "new"]++;
  }
  return counts;
}
/**
 * Markdown job summary: the outcome, counts and every FAIL and WARN line.
 * New warnings are listed first and marked **NEW**; known ones name their
 * documented reason.
 */
export function summaryMarkdown(result, known = KNOWN_WARNINGS) {
  const lines = [];
  const checks = result.checks ?? [];
  const warnings = labelWarnings(checks, known);
  const outcome = result.passed ? "passed" : "FAILED";
  lines.push(`## Web live smoke ${outcome}`, "");
  lines.push(
    `Base ${cell(result.base ?? "(none)", 200)} (${cell(result.target ?? "setup", 40)})` +
      (result.release?.commit
        ? `, release ${cell(result.release.commit, 80)}`
        : "") +
      (result.expectCommit
        ? `, expected ${cell(result.expectCommit, 80)}`
        : "") +
      (result.startedAt ? `, started ${result.startedAt}` : "") +
      ".",
    "",
  );
  if (result.setupError) {
    lines.push(`**Setup failed:** ${cell(result.setupError)}`, "");
    return lines.join("\n") + "\n";
  }
  const c = result.counts ?? {};
  const f = result.failures ?? {};
  lines.push(
    "| pass | warn (new / known) | skip | fail (app / hosting / upstream) |",
    "| --- | --- | --- | --- |",
    `| ${c.pass ?? 0} | ${c.warn ?? 0} (${warnings.new} / ${warnings.known}) | ${c.skip ?? 0} | ${c.fail ?? 0} (${f.app ?? 0} / ${f.hosting ?? 0} / ${f.upstream ?? 0}) |`,
    "",
  );
  const line = (x, label) =>
    `- ${label} \`${x.category}\` ${cell(x.name, 160)}` +
    (x.evidence === undefined
      ? ""
      : " — " +
        cell(
          typeof x.evidence === "string"
            ? x.evidence
            : JSON.stringify(x.evidence),
        ));
  const failed = checks.filter((x) => x.status === "fail");
  if (failed.length)
    lines.push("### Failures", "", ...failed.map((x) => line(x, "FAIL")), "");
  const warned = checks.filter((x) => x.status === "warn");
  if (warned.length)
    lines.push(
      "### Warnings",
      "",
      ...warned.filter((x) => !x.known).map((x) => line(x, "**NEW** WARN")),
      ...warned
        .filter((x) => x.known)
        .map((x) => line(x, `WARN (known: ${cell(x.knownReason, 120)})`)),
      "",
    );
  if (!failed.length && !warned.length)
    lines.push("No warnings or failures.", "");
  return lines.join("\n") + "\n";
}
/** Screenshot path for a failed check, next to the --json output. */
export function failureScreenshotPath(json, name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return `${json}.fail-${slug || "check"}.png`;
}

export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--help" || key === "-h") options.help = true;
    else if (["--base", "--json", "--expect-commit"].includes(key)) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--"))
        throw Error("Missing value: " + key);
      const value = argv[++i];
      if (key === "--expect-commit") {
        options.expectCommit = value.toLowerCase();
        if (!/^[0-9a-f]{7,40}$/.test(options.expectCommit))
          throw Error(
            "--expect-commit must be 7 to 40 hexadecimal characters of a commit SHA",
          );
      } else options[key.slice(2)] = value;
    } else throw Error("Unknown option: " + key);
  }
  if (options.base) {
    const url = new URL(options.base);
    if (!/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search)
      throw Error(
        "--base must be an http(s) origin such as https://app.tdywx.xyz",
      );
    options.base = url.origin;
  }
  return options;
}
async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) =>
    server.once("error", fail).listen(0, "127.0.0.1", ok),
  );
  const { port } = server.address();
  await new Promise((ok) => server.close(ok));
  return port;
}
async function startPreview() {
  if (!existsSync(join(ROOT, "web/dist/index.html")))
    throw Error(
      "web/dist is missing; run `npm run build` first or pass --base",
    );
  const port = await freePort();
  const child = spawn(process.execPath, ["scripts/web-static-preview.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const base = "http://127.0.0.1:" + port;
  const deadline = Date.now() + STEP_TIMEOUT;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(base + "/index.html")).ok) return { base, child };
    } catch {}
    await delay(100);
  }
  await stopPreview(child);
  throw Error("Static preview did not start on " + base);
}
async function stopPreview(child) {
  if (!child?.pid || child.exitCode !== null) return;
  const exited = new Promise((ok) => child.once("exit", ok));
  process.kill(child.pid, "SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null) process.kill(child.pid, "SIGKILL");
  }, 5000);
  await exited;
  clearTimeout(timer);
}

class Skip extends Error {}
export async function runSmoke({ base, target, expectCommit, screenshots }) {
  const { chromium } = await import("@playwright/test");
  const result = {
    tool: "web-live-smoke",
    schemaVersion: 1,
    base,
    target,
    startedAt: new Date().toISOString(),
    readOnly: true,
    mocked: false,
    expectCommit: expectCommit ?? null,
    checks: [],
    api: [],
    apiFailures: [],
    csp: [],
    pageErrors: [],
  };
  let page = null;
  const shots = new Set();
  const record = async (name, status, category, evidence) => {
    const entry = { name, status, category, evidence };
    result.checks.push(entry);
    const shown =
      typeof evidence === "string" ? evidence : JSON.stringify(evidence);
    const known =
      status === "warn" && Object.hasOwn(KNOWN_WARNINGS, name)
        ? " (known)"
        : "";
    console.log(
      `${status.toUpperCase().padEnd(4)} [${category}]${known} ${name}${shown ? " — " + shown.slice(0, 240) : ""}`,
    );
    // A failed check keeps a full-page screenshot of the current page.
    if (status !== "fail" || !screenshots || !page) return;
    let path = failureScreenshotPath(screenshots, name);
    for (let n = 2; shots.has(path); n++)
      path = failureScreenshotPath(screenshots, `${name} ${n}`);
    shots.add(path);
    try {
      await page.screenshot({ path, fullPage: true, timeout: 10_000 });
      entry.screenshot = path;
      entry.screenshotUrl = page.url();
    } catch (error) {
      entry.screenshotError = String(error?.message ?? error).split("\n")[0];
    }
  };
  // Upstream evidence for an API path prefix: non-2xx or failed requests.
  const upstreamProblem = (prefix) => {
    const bad = [
      ...result.api
        .filter(
          (a) =>
            a.path.startsWith(prefix) && !(a.status >= 200 && a.status < 300),
        )
        .map((a) => `${a.status} ${a.path}`),
      ...result.apiFailures
        .filter((a) => a.path.startsWith(prefix))
        .map((a) => `${a.failure} ${a.path}`),
    ];
    return bad.length ? bad.join("; ") : null;
  };
  /**
   * Runs one check. `fn` returns evidence, or { status, evidence } for warn/skip.
   * A thrown error fails the check; when `upstream` names an API prefix with a
   * failed response, the failure is attributed to the upstream API.
   */
  const check = async (name, category, fn, upstream) => {
    try {
      const value = await fn();
      if (value && typeof value === "object" && "status" in value)
        await record(
          name,
          value.status,
          value.category ?? category,
          value.evidence,
        );
      else await record(name, "pass", category, value);
    } catch (error) {
      if (error instanceof Skip)
        return record(name, "skip", category, error.message);
      const message = String(error?.message ?? error).split("\n")[0];
      const cause =
        upstream && !error.category ? upstreamProblem(upstream) : null;
      await record(
        name,
        "fail",
        error.category ?? (cause ? "upstream" : category),
        cause ? `${message} (upstream: ${cause})` : message,
      );
    }
  };

  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: executablePath ? ["--no-sandbox"] : [],
  });
  try {
    const context = await browser.newContext({
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });
    const http = context.request;
    const get = (path) =>
      http.get(base + path, { timeout: STEP_TIMEOUT, maxRedirects: 0 });
    page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    page.setDefaultNavigationTimeout(STEP_TIMEOUT);
    const bodies = [];
    const sameOriginApi = [];
    // Status and headers of API responses as the browser received them, keyed
    // by URL. Chromium hides a CORS-blocked response from the page and from
    // Playwright's response event; the DevTools protocol still reports it.
    const received = new Map();
    try {
      const urls = new Map();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      cdp.on("Network.requestWillBeSent", (e) => {
        if (e.request.url.startsWith(API_ORIGIN + "/"))
          urls.set(e.requestId, e.request.url);
      });
      cdp.on("Network.responseReceivedExtraInfo", (e) => {
        const url = urls.get(e.requestId);
        if (!url) return;
        const headers = Object.fromEntries(
          Object.entries(e.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
        );
        received.set(url, {
          status: e.statusCode,
          contentType: headers["content-type"] ?? null,
          acao: headers["access-control-allow-origin"] ?? null,
        });
      });
      cdp.on("Network.loadingFailed", (e) => {
        const url = urls.get(e.requestId);
        if (url && e.corsErrorStatus)
          received.set(url, {
            ...received.get(url),
            corsError: e.corsErrorStatus.corsError,
          });
      });
    } catch {}
    page.on("console", (m) => {
      if (CSP_PATTERN.test(m.text())) result.csp.push(m.text().slice(0, 300));
    });
    page.on("pageerror", (e) =>
      result.pageErrors.push(e.message.slice(0, 300)),
    );
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.origin === base && u.pathname.startsWith("/api/"))
        sameOriginApi.push(u.pathname);
    });
    // Requests failed by the deliberate offline check are not API evidence.
    let offline = false;
    page.on("requestfailed", (r) => {
      const u = new URL(r.url());
      if (u.origin === API_ORIGIN && !offline)
        result.apiFailures.push({
          path: u.pathname,
          url: r.url(),
          failure: r.failure()?.errorText ?? "failed",
        });
    });
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (u.origin !== API_ORIGIN || r.request().method() === "OPTIONS") return;
      const entry = { path: u.pathname, status: r.status() };
      result.api.push(entry);
      bodies.push(
        (async () => {
          const headers = await r.allHeaders();
          entry.contentType = headers["content-type"] ?? null;
          entry.acao = headers["access-control-allow-origin"] ?? null;
          try {
            const body = await r.body();
            entry.bytes = body.length;
            entry.text = body.toString("utf8");
          } catch (error) {
            entry.bytes = Number(headers["content-length"]) || null;
            entry.bodyError = String(error?.message ?? error).split("\n")[0];
          }
        })().catch(() => {}),
      );
    });

    // --- Static hosting (HTTP only) ---
    for (const path of DEEP_LINKS)
      await check(
        `deep link ${path} returns the app shell (HTTP)`,
        "hosting",
        async () => {
          const r = await get(path);
          const type = r.headers()["content-type"] ?? "";
          const html = await r.text();
          if (r.status() !== 200) throw Error(`status ${r.status()}`);
          if (!type.includes("text/html")) throw Error("content-type " + type);
          if (!html.includes('id="root"')) throw Error("missing #root shell");
          return `200 ${type}`;
        },
      );
    await check(
      "unknown path /definitely-missing is a 404",
      "hosting",
      async () => {
        const r = await get("/definitely-missing");
        if (r.status() === 404)
          return `hosting 404 (${target === "preview" ? "preview route function" : "CloudFront viewer-request function"})`;
        if (r.status() === 200) {
          await page.goto(base + "/definitely-missing");
          await page.getByText("페이지를 찾을 수 없습니다").waitFor();
          return "app 404 page (HTTP 200)";
        }
        throw Error(`status ${r.status()}`);
      },
    );
    for (const path of ["/assets/missing.js", "/api/web/v1/weather"])
      await check(
        `missing ${path} does not return HTML`,
        "hosting",
        async () => {
          const r = await get(path);
          const type = r.headers()["content-type"] ?? "";
          const body = (await r.text()).trimStart().slice(0, 64).toLowerCase();
          if (r.status() < 400) throw Error(`status ${r.status()}`);
          if (
            type.includes("text/html") ||
            body.startsWith("<!doctype") ||
            body.startsWith("<html")
          )
            throw Error(`status ${r.status()} served HTML`);
          return `${r.status()} ${type || "(no content-type)"}`;
        },
      );
    await check(
      "release.json identifies a live/direct release",
      "hosting",
      async () => {
        const r = await get("/release.json");
        if (r.status() !== 200) throw Error(`status ${r.status()}`);
        const release = JSON.parse(await r.text());
        result.release = release;
        const problems = [];
        if (release.schemaVersion !== 1) problems.push("schemaVersion");
        if (release.mode !== "live") problems.push("mode " + release.mode);
        if (release.transport !== "direct")
          problems.push("transport " + release.transport);
        if (release.apiOrigin !== API_ORIGIN)
          problems.push("apiOrigin " + release.apiOrigin);
        if (problems.length) throw Error(problems.join(", "));
        const commit = releaseCommitStatus(release.commit, expectCommit);
        if (commit.status === "fail") return commit;
        if (release.builtAt === undefined)
          return {
            status: "warn",
            evidence:
              "release.json has no commit/builtAt (built before release identity was added)",
          };
        if (Number.isNaN(Date.parse(release.builtAt)))
          throw Error("builtAt " + release.builtAt);
        return {
          status: commit.status,
          evidence: `${commit.evidence}; builtAt ${release.builtAt}`,
        };
      },
    );
    await check("HTML, worker and asset headers", "hosting", async () => {
      const index = await get("/");
      const csp = index.headers()["content-security-policy"] ?? "";
      const connect = csp
        .split(";")
        .map((d) => d.trim().split(/\s+/))
        .find((d) => d[0]?.toLowerCase() === "connect-src");
      if (!connect?.includes(API_ORIGIN))
        throw Error("CSP connect-src lacks " + API_ORIGIN);
      const worker = await get("/sw.js");
      const workerCache = worker.headers()["cache-control"] ?? "";
      if (worker.status() !== 200 || !workerCache.includes("no-cache"))
        throw Error(`/sw.js ${worker.status()} cache-control ${workerCache}`);
      const asset = (await index.text()).match(/\/assets\/[^"']+\.js/)?.[0];
      if (!asset) throw Error("no hashed script in index.html");
      const script = await get(asset);
      const assetCache = script.headers()["cache-control"] ?? "";
      if (script.status() !== 200 || !assetCache.includes("immutable"))
        throw Error(`${asset} ${script.status()} cache-control ${assetCache}`);
      return `CSP connect-src ok; sw.js ${workerCache}; ${asset} ${assetCache}`;
    });
    // Every file the shell loads (theme script, hashed bundle, icons).
    const served = async (paths) => {
      const problems = [];
      for (const path of paths) {
        const r = await get(path).catch((error) => error);
        const problem =
          r instanceof Error
            ? `${path} ${String(r.message).split("\n")[0]}`
            : precacheEntryProblem(
                path,
                r.status(),
                r.headers()["content-type"],
              );
        if (problem) problems.push(problem);
      }
      return problems;
    };
    await check(
      "index.html references return 200 with their content type",
      "hosting",
      async () => {
        const index = await get("/index.html");
        if (index.status() !== 200)
          throw Error(`/index.html status ${index.status()}`);
        const paths = shellReferences(await index.text());
        if (!paths.length) throw Error("no src/href references in index.html");
        const problems = await served(paths);
        if (problems.length)
          throw Error(
            `${problems.length} of ${paths.length} references fail: ${problems.join(", ")}`,
          );
        return paths.join(", ");
      },
    );
    // The worker installs with an all-or-nothing cache.addAll: one missing or
    // mistyped entry (for example /theme.js) leaves the app without offline
    // support or update detection.
    let precacheOk = false;
    await check(
      "service worker precache entries return 200 with their content type",
      "hosting",
      async () => {
        const worker = await get("/sw.js");
        if (worker.status() !== 200)
          throw Error(`/sw.js status ${worker.status()}`);
        const assets = parsePrecache(await worker.text());
        if (!assets) throw Error("no precache list (ASSETS) in /sw.js");
        const problems = await served(assets);
        if (problems.length)
          throw Error(
            `${problems.length} of ${assets.length} entries would fail install: ${problems.join(", ")}`,
          );
        precacheOk = true;
        return `${assets.length} entries: ${assets.filter((p) => !p.startsWith("/assets/")).join(", ")} and ${assets.filter((p) => p.startsWith("/assets/")).length} hashed assets`;
      },
    );

    // --- Rendered app (browser, public API unmocked) ---
    // A page's checks are skipped when its shell did not load; checks inspect
    // the already-waited page without waiting again (bounded outage runtime).
    let pageLoaded = false;
    const visit = async (path, ready) => {
      pageLoaded = false;
      await check(
        `deep link ${path} renders the app shell (browser)`,
        "app",
        async () => {
          const response = await page.goto(base + path, {
            waitUntil: "domcontentloaded",
          });
          await page.locator(".app-shell").waitFor();
          const evidence = `${response?.status() ?? "no response"}${response?.fromServiceWorker() ? " (service worker)" : ""}`;
          if (response && response.status() !== 200)
            throw Error("status " + evidence);
          pageLoaded = true;
          return evidence;
        },
      );
      if (pageLoaded && ready)
        await page
          .locator(ready)
          .first()
          .waitFor({ timeout: STEP_TIMEOUT })
          .catch(() => {});
    };
    const rendered = async (selector) => {
      if (!pageLoaded) throw new Skip("page shell did not load");
      const error = page.locator(".empty-state.error");
      if (await error.count())
        throw Error(
          "error state: " +
            (await error.first().innerText())
              .replace(/\s+/g, " ")
              .slice(0, 200),
        );
      if (!(await page.locator(selector).count()))
        throw Error(`${selector} not rendered within ${STEP_TIMEOUT} ms`);
    };
    const weatherReady = ".temperature, .empty-state.error";
    /** Parsed JSON of the newest 200 response for an API path prefix. */
    const bodyJson = async (prefix) => {
      await Promise.all(bodies);
      const entry = result.api.findLast(
        (a) => a.path.startsWith(prefix) && a.status === 200 && a.text,
      );
      try {
        return entry ? JSON.parse(entry.text) : undefined;
      } catch {
        return undefined;
      }
    };
    /**
     * Fails a rendering check. When the captured weather body itself lacks the
     * data, the failure is the upstream API's; otherwise it is the app's (or,
     * through `check`, an upstream error response's).
     */
    const renderFailure = async (message, prefix) => {
      const json = await bodyJson(prefix);
      const problems = json === undefined ? [] : weatherBodyProblems(json);
      if (!problems.length) throw Error(message);
      throw Object.assign(
        Error(`${message} (upstream body: ${problems.join("; ")})`),
        { category: "upstream" },
      );
    };
    const temperatureText = async () =>
      (await page.locator(".temperature").first().innerText())
        .replace(/\s+/g, " ")
        .trim();
    const precipitationTexts = async () => {
      const panel = page.locator("section.panel", {
        has: page.getByRole("heading", { name: "강수·눈 예보" }),
      });
      const rows = await panel
        .locator(".detail-grid > div > span")
        .allInnerTexts();
      const metric = await page.locator(".metric span").allInnerTexts();
      return [...rows, ...metric].filter((t) => t.startsWith("강수"));
    };
    const rainCheck = (view) =>
      check(
        `Seoul ${view} precipitation rows use known labels`,
        "app",
        async () => {
          await rendered(".temperature");
          const texts = await precipitationTexts();
          if (!texts.length) throw Error("no precipitation rows");
          const unknown = unknownRainLabels(texts);
          if (unknown.length)
            throw Error("unknown labels " + JSON.stringify(unknown));
          return `${texts.length} rows: ${[...new Set(texts.map((t) => t.split(" · ")[1] ?? t.split(" ")[0]))].join(", ")}`;
        },
        "/weather/",
      );

    await visit("/");
    // --- Service worker: install, control after reload, offline shell ---
    let swControlled = false;
    await check(
      "service worker installs and controls the page after reload",
      "app",
      async () => {
        if (!pageLoaded) throw new Skip("page shell did not load");
        const state = await page.evaluate(async (timeout) => {
          if (!("serviceWorker" in navigator)) return { supported: false };
          const ready = await Promise.race([
            navigator.serviceWorker.ready.then(() => true),
            new Promise((ok) => setTimeout(() => ok(false), timeout)),
          ]);
          const reg = await navigator.serviceWorker.getRegistration();
          return {
            supported: true,
            ready,
            registered: !!reg,
            active: reg?.active?.state ?? null,
            installing: reg?.installing?.state ?? null,
            waiting: reg?.waiting?.state ?? null,
          };
        }, SW_TIMEOUT);
        // A failed precache entry explains a failed install: a hosting fault.
        const fault = (message) =>
          Object.assign(
            Error(
              precacheOk
                ? message
                : `${message} (the precache entry check failed)`,
            ),
            { category: precacheOk ? "app" : "hosting" },
          );
        if (!state.supported) throw fault("navigator.serviceWorker is missing");
        if (!state.ready)
          throw fault(
            `no active worker within ${SW_TIMEOUT} ms: ${JSON.stringify(state)}`,
          );
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator(".app-shell").waitFor();
        const controller = await page.evaluate(
          () => navigator.serviceWorker.controller?.scriptURL ?? null,
        );
        if (!controller) throw fault("the reloaded page is not controlled");
        swControlled = true;
        return `active; reloaded page controlled by ${new URL(controller).pathname}`;
      },
    );
    await visit("/locations", "input");
    await visit("/weather/seoul/hourly", weatherReady);
    await check(
      "Seoul weather is served by KMA",
      "upstream",
      async () => {
        await rendered(".temperature");
        const footer = await page.locator(".data-footer").innerText();
        if (!footer.includes("기상청"))
          throw Error(footer.replace(/\s+/g, " "));
        return footer.replace(/\s+/g, " ").slice(0, 120);
      },
      "/weather/",
    );
    await check(
      "Seoul observation stamp is parsed",
      "app",
      async () => {
        await rendered(".temperature");
        const stamp = (
          await page.locator(".data-footer .stamp").innerText()
        ).trim();
        if (dottedKmaTime(stamp)) throw Error("dotted KMA time: " + stamp);
        if (!/\d{1,2}:\d{2}/.test(stamp)) throw Error("no time: " + stamp);
        return stamp;
      },
      "/weather/",
    );
    // A stalled domestic collector keeps serving the last stored forecast with
    // a numeric temperature; only its times (and the app's notices) show it.
    const domestic = async (kind) => {
      const json = await bodyJson(SEOUL_WEATHER);
      if (json === undefined) throw new Skip("no Seoul weather body");
      const shown = async (text) =>
        pageLoaded && (await page.getByText(text).count()) > 0;
      return domesticFreshness(json, {
        observationNotice: await shown("관측 시각이 오래된 자료입니다"),
        forecastNotice: await shown("발표 후 오래된 예보입니다"),
      })[kind];
    };
    await check(
      `Seoul current observation is within ${OBSERVATION_FRESH_HOURS} h`,
      "upstream",
      () => domestic("observation"),
    );
    await check(
      `Seoul forecast publication is within ${FORECAST_FRESH_HOURS} h`,
      "upstream",
      () => domestic("forecast"),
    );
    await rainCheck("hourly");
    await check(
      "Seoul hourly view shows a numeric temperature and >=8 chart hours",
      "app",
      async () => {
        await rendered(".temperature");
        const temperature = await temperatureText();
        const hours = await page.locator(".chart-label").count();
        const problems = [];
        if (!/\d/.test(temperature))
          problems.push("temperature " + JSON.stringify(temperature));
        if (hours < 8) problems.push(`${hours} hourly chart labels (< 8)`);
        if (problems.length)
          await renderFailure(problems.join(", "), SEOUL_WEATHER);
        return `temperature ${temperature}, ${hours} hourly chart labels`;
      },
      "/weather/",
    );
    await check(
      "AirKorea credit on KMA weather",
      "app",
      async () => {
        await rendered(".temperature");
        const air = page.locator(".air-summary");
        const text = await air.innerText();
        if (text.includes("환경부/한국환경공단"))
          return "대기오염정보: 환경부/한국환경공단";
        if (
          text.includes("관측 자료 없음") &&
          !(await air.locator(".provider-air-summary").count())
        )
          return {
            status: "warn",
            category: "upstream",
            evidence:
              "no air observation or summary upstream; the credit is shown only with air data",
          };
        throw Error(
          "credit missing: " + text.replace(/\s+/g, " ").slice(0, 160),
        );
      },
      "/weather/",
    );
    // The daily list renders with the weather data; wait for its rows.
    await visit(
      "/weather/seoul/daily",
      ".daily-row, .empty-state:not([role=status]), .empty-state.error",
    );
    await check(
      "Seoul daily view renders >=3 daily rows",
      "app",
      async () => {
        await rendered(".temperature");
        const days = await page.locator(".daily-row").count();
        if (days < 3)
          await renderFailure(`${days} daily rows (< 3)`, SEOUL_WEATHER);
        return `${days} daily rows`;
      },
      "/weather/",
    );
    await rainCheck("daily");
    await visit("/air/seoul", ".data-footer, .empty-state.error");
    await check(
      "Seoul air page renders",
      "app",
      async () => {
        await rendered(".data-footer");
        if (await page.locator(".air-detail").count())
          return (
            await page.locator(".air-detail .air-orb").first().innerText()
          ).replace(/\s+/g, " ");
        if (await page.getByText("대기질 관측 자료가 없습니다").count())
          return {
            status: "warn",
            category: "upstream",
            evidence:
              "no air stations in the upstream response; empty state shown",
          };
        throw Error("no air detail or empty state");
      },
      "/weather/",
    );
    for (const kind of ["weather", "air"]) {
      await visit(`/nation/${kind}`, ".region-row, .empty-state.error");
      await check(
        `nation ${kind} renders rows`,
        "app",
        async () => {
          await rendered(".region-row");
          return `${await page.locator(".region-row").count()} rows`;
        },
        "/v000903/nation/",
      );
    }
    await visit(
      "/warnings",
      ".bulletin, .empty-state:not([role=status]), .empty-state.error",
    );
    await check(
      "warnings render bulletins or the empty state",
      "app",
      async () => {
        await rendered(".bulletin, .empty-state:not([role=status])");
        const count = await page.locator(".bulletin").count();
        if (count) return `${count} bulletins`;
        if (await page.getByText("제공된 특보가 없습니다").count())
          return "empty state";
        throw Error("no bulletins or empty-state text");
      },
      "/v000903/kma/special",
    );
    await visit("/settings");
    await visit("/help");

    // --- Non-KR place: the overseas (VC) path (a known upstream 501 until #2585 is deployed) ---
    await visit("/weather/tokyo/hourly", weatherReady);
    await check(
      "non-KR weather (Tokyo) renders or reports an upstream error",
      "upstream",
      async () => {
        if (!pageLoaded) throw new Skip("page shell did not load");
        await Promise.all(bodies);
        const entry = result.api.findLast((a) =>
          a.path.startsWith(TOKYO_WEATHER),
        );
        const failed = result.apiFailures.findLast((a) =>
          a.path.startsWith(TOKYO_WEATHER),
        );
        if (!entry && failed) {
          // The browser hides a response without CORS headers; repeat the
          // same GET outside the page to record its status and headers.
          const probe = await http
            .get(failed.url, {
              timeout: STEP_TIMEOUT,
              maxRedirects: 0,
              headers: { Accept: "application/json", Origin: base },
            })
            .then(async (r) => ({
              status: r.status(),
              contentType: r.headers()["content-type"] ?? null,
              acao: r.headers()["access-control-allow-origin"] ?? null,
              body: redactUrls(await r.text())
                .replace(/\s+/g, " ")
                .slice(0, 160),
            }))
            .catch((error) => ({
              error: String(error?.message ?? error).split("\n")[0],
            }));
          return {
            status: "warn",
            evidence: {
              path: failed.path,
              browserFailure: failed.failure,
              browserResponse: received.get(failed.url) ?? null,
              directProbe: probe,
              note: "the page could not read the response (network or CORS failure): browserResponse is what Chromium received, directProbe repeats the GET outside the browser; overseas weather is a known backend gap",
            },
          };
        }
        if (!entry)
          throw Object.assign(Error("no Tokyo weather request observed"), {
            category: "app",
          });
        const evidence = {
          path: entry.path,
          status: entry.status,
          contentType: entry.contentType ?? null,
          acao: entry.acao ?? null,
          bytes: entry.bytes ?? null,
        };
        if (entry.status !== 200)
          return {
            status: "warn",
            evidence: {
              ...evidence,
              body: redactUrls(entry.text).replace(/\s+/g, " ").slice(0, 160),
              note: "overseas weather is not served (known backend gap); the app shows its error state",
            },
          };
        let json;
        try {
          json = JSON.parse(entry.text ?? "");
        } catch {
          throw Error("200 body is not JSON");
        }
        const problems = weatherBodyProblems(json);
        if (problems.length) throw Error(problems.join("; "));
        await rendered(".temperature").catch((error) => {
          throw Object.assign(error, { category: "app" });
        });
        const temperature = await temperatureText();
        const credit = await page
          .locator(".data-footer .powered-by")
          .allInnerTexts();
        const appProblems = [];
        if (!/\d/.test(temperature))
          appProblems.push("temperature " + JSON.stringify(temperature));
        if (
          json.source === "VC" &&
          !credit.some((t) =>
            t.includes("Weather Data Provided by Visual Crossing"),
          )
        )
          appProblems.push("no Visual Crossing credit");
        if (appProblems.length)
          throw Object.assign(Error(appProblems.join(", ")), {
            category: "app",
          });
        return {
          status: "pass",
          evidence: { ...evidence, source: json.source, temperature, credit },
        };
      },
    );

    // --- Public API contract, observed from the page (with its CSP and CORS) ---
    const geocodeFetch = await page
      .evaluate(async (origin) => {
        const r = await fetch(
          origin + "/geocode/v000903/coord/37.567,126.978",
          {
            credentials: "omit",
            headers: { Accept: "application/json" },
          },
        );
        return { status: r.status };
      }, API_ORIGIN)
      .catch((error) => ({
        error: String(error?.message ?? error).split("\n")[0],
      }));
    await Promise.all(bodies);
    const contract = (name, prefix, validate) =>
      check(name, "upstream", async () => {
        const entry = result.api.find((a) => a.path.startsWith(prefix));
        if (!entry) {
          const failed = result.apiFailures.find((a) =>
            a.path.startsWith(prefix),
          );
          if (failed)
            throw Object.assign(Error(`${failed.failure} ${failed.path}`), {
              // A CSP block is the app's policy; other failures are upstream.
              category: /CSP/i.test(failed.failure) ? "app" : "upstream",
            });
          // The page never asked: an app (or page load) problem, not upstream.
          throw Object.assign(Error("no request observed"), {
            category: "app",
          });
        }
        if (entry.status !== 200)
          throw Error(`status ${entry.status} ${entry.contentType ?? ""}`);
        if (!entry.contentType?.includes("json"))
          throw Error("content-type " + entry.contentType);
        if (!entry.acao) throw Error("no access-control-allow-origin");
        let json;
        try {
          json = JSON.parse(entry.text ?? "");
        } catch {
          throw Error(
            "body is not JSON" +
              (entry.bodyError ? ": " + entry.bodyError : ""),
          );
        }
        return validate(json, entry);
      });
    await contract(
      "API weather/coord contract (Seoul forecast shape)",
      SEOUL_WEATHER,
      (json, e) => {
        if (typeof json.source !== "string") throw Error("no source field");
        const problems = weatherBodyProblems(json);
        if (problems.length) throw Error(problems.join("; "));
        return (
          `200 source ${json.source}, short ${rows(json.short)}, shortest ${rows(json.shortest)}, ` +
          `dailyData ${rows(json.midData?.dailyData)}, current.t1h ${json.current?.t1h}, ` +
          `${e.bytes} bytes, ACAO ${e.acao}`
        );
      },
    );
    await contract(
      "API nation/KR contract and size",
      "/v000903/nation/KR",
      (json, e) => {
        if (!json || typeof json !== "object") throw Error("not an object");
        if (!(e.bytes > 0)) throw Error("unknown body size");
        if (e.bytes >= NATION_MAX_BYTES)
          throw Error(
            `${e.bytes} bytes >= ${NATION_MAX_BYTES} (client limit 2,000,000)`,
          );
        const evidence = `200, ${e.bytes} bytes, ACAO ${e.acao}`;
        return e.bytes > NATION_WARN_BYTES
          ? {
              status: "warn",
              evidence: evidence + ` (above ${NATION_WARN_BYTES})`,
            }
          : evidence;
      },
    );
    await contract(
      "API kma/special contract",
      "/v000903/kma/special",
      (json, e) => {
        if (!Array.isArray(json)) throw Error("not an array");
        return `200, ${json.length} items, ACAO ${e.acao}`;
      },
    );
    await contract(
      "API geocode/coord contract",
      "/geocode/v000903/coord/",
      (json, e) => {
        if (
          !Number.isFinite(json.location?.lat) ||
          !Number.isFinite(json.location?.long)
        )
          throw Error("no numeric location");
        return (
          `200 ${json.name ?? ""}, ACAO ${e.acao}` +
          (geocodeFetch.error ? ` (page fetch: ${geocodeFetch.error})` : "")
        );
      },
    );

    // --- Data freshness (warnings only: stale data is shown with notices) ---
    await check(
      `nation air observation times are within ${FRESH_HOURS} h`,
      "upstream",
      async () => {
        const json = await bodyJson("/v000903/nation/KR");
        if (!Array.isArray(json?.air)) throw new Skip("no nation/KR air rows");
        return freshness(
          json.air.map((r) => {
            const last = r?.last ?? r;
            return last?.dataTime ?? last?.date ?? null;
          }),
          { basis: "any" },
        );
      },
    );
    await check(
      `newest warning announcement is within ${FRESH_HOURS} h`,
      "upstream",
      async () => {
        const json = await bodyJson("/v000903/kma/special");
        if (!Array.isArray(json)) throw new Skip("no kma/special array");
        return freshness(
          json.map((b) => b?.announcement ?? null),
          { basis: "newest" },
        );
      },
    );

    // --- Offline: a deep link reloads from the worker's cached shell ---
    await check(
      "offline deep link /weather/seoul/hourly renders the cached shell",
      "app",
      async () => {
        if (!swControlled)
          throw new Skip("no service worker controlled the page");
        const seoulRendered = result.checks.some(
          (c) =>
            c.name.startsWith("Seoul hourly view shows") && c.status === "pass",
        );
        // setOffline alone does not survive a navigation in headless
        // Chromium (navigator.onLine turns true again and requests go out),
        // so every http(s) request, including the worker's own fetches, is
        // also aborted as a disconnected network.
        const blocked = [];
        const disconnect = (route) => {
          blocked.push(new URL(route.request().url()).pathname);
          return route.abort("internetdisconnected");
        };
        offline = true;
        await context.setOffline(true);
        await context.route(/^https?:/, disconnect);
        try {
          const response = await page.goto(base + "/weather/seoul/hourly", {
            waitUntil: "domcontentloaded",
          });
          await page.locator(".app-shell").waitFor();
          if (!response?.fromServiceWorker())
            throw Error(
              "the navigation was not answered by the service worker",
            );
          // Seoul weather fetched online is kept as a snapshot for offline use.
          const notice = page.getByText("저장된 자료를 표시합니다");
          await notice
            .first()
            .waitFor({ timeout: 10_000 })
            .catch(() => {});
          const snapshot = (await notice.count()) > 0;
          const network = `${blocked.length} network requests blocked (${[...new Set(blocked)].join(", ")})`;
          if (seoulRendered && !snapshot)
            throw Error(
              `shell rendered, but no saved-data notice for Seoul; ${network}`,
            );
          return snapshot
            ? `${response.status()} from the service worker cache; saved Seoul weather shown; ${network}`
            : `${response.status()} from the service worker cache; no saved Seoul weather to show (it did not render online); ${network}`;
        } finally {
          await context.unroute(/^https?:/, disconnect);
          await context.setOffline(false);
          offline = false;
        }
      },
    );

    // --- Whole-run browser guards ---
    await check("no Content Security Policy violations", "app", async () => {
      if (result.csp.length) throw Error(result.csp.join(" | "));
      return "none";
    });
    await check("no page errors", "app", async () => {
      if (result.pageErrors.length) throw Error(result.pageErrors.join(" | "));
      return "none";
    });
    await check("no same-origin /api/ requests", "app", async () => {
      if (sameOriginApi.length) throw Error(sameOriginApi.join(", "));
      return "none";
    });
    for (const failure of result.apiFailures)
      if (received.has(failure.url))
        failure.browserResponse = received.get(failure.url);
    await context.close();
  } finally {
    await browser.close();
  }
  for (const entry of result.api) delete entry.text;
  result.finishedAt = new Date().toISOString();
  const count = (status) =>
    result.checks.filter((c) => c.status === status).length;
  result.counts = {
    pass: count("pass"),
    warn: count("warn"),
    skip: count("skip"),
    fail: count("fail"),
  };
  const failed = result.checks.filter((c) => c.status === "fail");
  result.failures = {
    app: failed.filter((c) => c.category === "app").length,
    hosting: failed.filter((c) => c.category === "hosting").length,
    upstream: failed.filter((c) => c.category === "upstream").length,
  };
  result.passed = failed.length === 0;
  result.warnings = labelWarnings(result.checks);
  return result;
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(
      "Usage: node scripts/web-live-smoke.mjs [--base <origin>] [--json <out>] [--expect-commit <sha>]",
    );
    return 0;
  }
  let preview;
  let result;
  try {
    if (!options.base) preview = await startPreview();
    const base = options.base ?? preview.base;
    console.log(
      `Live smoke against ${base} (${preview ? "local preview of web/dist" : "deployed"})` +
        (options.expectCommit
          ? `, expecting commit ${options.expectCommit}`
          : ""),
    );
    result = await runSmoke({
      base,
      target: preview ? "preview" : "deployed",
      expectCommit: options.expectCommit,
      screenshots: options.json,
    });
  } catch (error) {
    result = {
      tool: "web-live-smoke",
      schemaVersion: 1,
      base: options.base ?? preview?.base ?? null,
      passed: false,
      setupError: String(error?.message ?? error).split("\n")[0],
    };
    console.error("Setup failed: " + result.setupError);
  } finally {
    await stopPreview(preview?.child);
  }
  if (preview)
    result.previewStopped =
      preview.child.exitCode !== null || preview.child.signalCode !== null;
  if (options.json) {
    mkdirSync(dirname(resolve(options.json)), { recursive: true });
    writeFileSync(options.json, JSON.stringify(result, null, 2) + "\n");
  }
  // GitHub Actions sets GITHUB_STEP_SUMMARY; locally it is usually unset.
  if (process.env.GITHUB_STEP_SUMMARY)
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(result));
    } catch (error) {
      console.error("Job summary not written: " + (error?.message ?? error));
    }
  if (result.counts)
    console.log(
      `${result.passed ? "PASSED" : "FAILED"}: ${result.counts.pass} pass, ${result.counts.warn} warn (${result.warnings.new} new, ${result.warnings.known} known), ${result.counts.skip} skip, ${result.counts.fail} fail (app ${result.failures.app}, hosting ${result.failures.hosting}, upstream ${result.failures.upstream})`,
    );
  return result.passed ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    },
  );
