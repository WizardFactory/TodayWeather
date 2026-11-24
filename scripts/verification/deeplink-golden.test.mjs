import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GOLDEN_PATH = path.join(ROOT, "specs/deeplink.golden.json");
const WEATHER_CORE_PATH = path.join(ROOT, "packages/weather-core/src/index.ts");
const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));

const { contract, catalog } = golden;
const SLUG_RE = new RegExp(contract.slugPattern);
const VALID_VIEWS = new Set(contract.validViews);
const VALID_POLLUTANTS = new Set(contract.validPollutants);
const STATIC_PASSTHROUGH = new Set([
  "/.well-known/apple-app-site-association",
  "/.well-known/assetlinks.json",
]);

function roundCoord(value) {
  const factor = 10 ** contract.coordinateDecimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function parseFiniteCoord(raw, min, max) {
  if (raw === null || raw === undefined || raw === "") return null;
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(raw.trim())) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return roundCoord(n);
}

function sanitizeName(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return null;
  const scalars = Array.from(cleaned);
  return scalars.slice(0, contract.maxNameLength).join("");
}

function normalizeView(raw) {
  return raw && VALID_VIEWS.has(raw) ? raw : "hourly";
}

function normalizePollutant(raw) {
  return raw && VALID_POLLUTANTS.has(raw) ? raw : "aqi";
}

function parseRawPathAndQuery(rawUrl) {
  const schemeEnd = rawUrl.indexOf("://");
  if (schemeEnd < 0) return null;
  const rest = rawUrl.slice(schemeEnd + 3);
  const slashIdx = rest.indexOf("/");
  const qIdx = rest.indexOf("?");
  let pathEnd = rest.length;
  if (qIdx >= 0) pathEnd = qIdx;
  const rawPath =
    slashIdx >= 0 && slashIdx < pathEnd ? rest.slice(slashIdx, pathEnd) : "/";
  const rawQuery = qIdx >= 0 ? rest.slice(qIdx + 1) : "";
  return { rawPath, rawQuery };
}

function decodeSafePath(rawPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (
    decoded.includes("..") ||
    decoded.includes("\\") ||
    decoded.includes("\u0000")
  ) {
    return null;
  }
  return decoded;
}

function referenceParseNative(rawUrl) {
  if (rawUrl.startsWith(`${contract.legacyScheme}://`)) {
    const rest = rawUrl.slice(`${contract.legacyScheme}://`.length);
    if (!rest) return null;
    if (rest.startsWith("widget?") || rest === "widget") {
      const parsed = new URL(rawUrl);
      return {
        kind: "legacyWidget",
        placeId: parsed.searchParams.get("place"),
      };
    }
    const idx = Number.parseInt(rest, 10);
    if (!Number.isNaN(idx)) {
      return { kind: "legacyWidgetIndex", index: idx };
    }
    return null;
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.hostname.toLowerCase() !== contract.canonicalHost) return null;

  const rawParts = parseRawPathAndQuery(rawUrl);
  if (!rawParts) return null;
  const decodedPath = decodeSafePath(rawParts.rawPath);
  if (decodedPath === null) return null;

  const trimmed =
    decodedPath.length > 1 && decodedPath.endsWith("/")
      ? decodedPath.slice(0, -1)
      : decodedPath;

  if (decodedPath === "/" || trimmed === "/open") {
    const rawLang = parsed.searchParams.get("lang")?.trim().toLowerCase() || null;
    const lang = rawLang && /^[a-z]{2,3}$/.test(rawLang) ? rawLang : null;
    return { kind: "open", lang };
  }

  if (trimmed === "/nation/weather") return { kind: "nationWeather" };
  if (trimmed === "/nation/air") return { kind: "nationAir" };
  if (trimmed === "/warnings") return { kind: "warnings" };

  if (trimmed.startsWith("/place/")) {
    const slug = trimmed.slice("/place/".length);
    if (!SLUG_RE.test(slug)) return null;
    const view = normalizeView(parsed.searchParams.get("view"));
    const pollutant =
      view === "air"
        ? normalizePollutant(parsed.searchParams.get("pollutant"))
        : null;
    return { kind: "place", slug, view, pollutant };
  }

  if (trimmed.startsWith("/air/")) {
    const slug = trimmed.slice("/air/".length);
    if (!SLUG_RE.test(slug)) return null;
    const pollutant = normalizePollutant(parsed.searchParams.get("pollutant"));
    return { kind: "place", slug, view: "air", pollutant };
  }

  if (trimmed === "/loc") {
    const lat = parseFiniteCoord(parsed.searchParams.get("lat"), -90, 90);
    const lon = parseFiniteCoord(parsed.searchParams.get("lon"), -180, 180);
    if (lat === null || lon === null) return null;
    const name = sanitizeName(parsed.searchParams.get("name"));
    const view = normalizeView(parsed.searchParams.get("view"));
    const pollutant =
      view === "air"
        ? normalizePollutant(parsed.searchParams.get("pollutant"))
        : null;
    return { kind: "coordinate", lat, lon, name, view, pollutant };
  }

  return null;
}

function resolveStoreFallback(params, userAgent = "") {
  if (params.get("fallback") !== "store") return null;
  if (/iPhone|iPad|iPod/i.test(userAgent)) return contract.appStoreUrl;
  if (/Android/i.test(userAgent)) return contract.playStoreUrl;
  const hint = params.get("store");
  if (hint === "ios") return contract.appStoreUrl;
  if (hint === "android") return contract.playStoreUrl;
  return null;
}

function referenceRouteEdge(method, rawUrl, userAgent = "") {
  if (method !== "GET" && method !== "HEAD") {
    return { action: "error", status: 405 };
  }
  const rawParts = parseRawPathAndQuery(rawUrl);
  if (!rawParts) return { action: "error", status: 400 };
  const decodedPath = decodeSafePath(rawParts.rawPath);
  if (decodedPath === null) return { action: "error", status: 400 };

  if (STATIC_PASSTHROUGH.has(decodedPath)) {
    return { action: "passthrough", status: 200, uri: decodedPath };
  }

  const trimmed =
    decodedPath.length > 1 && decodedPath.endsWith("/")
      ? decodedPath.slice(0, -1)
      : decodedPath;
  const params = new URLSearchParams(rawParts.rawQuery);
  const storeFallback = params.get("fallback") === "store";
  const storeUrl = resolveStoreFallback(params, userAgent);

  function redirectResult(pwaLocation) {
    const res = {
      action: "redirect",
      status: 302,
      location: storeUrl ?? pwaLocation,
    };
    if (storeFallback) res.vary = "User-Agent";
    return res;
  }

  if (decodedPath === "/" || trimmed === "/open") {
    return redirectResult(`${contract.pwaOrigin}/`);
  }

  if (trimmed === "/nation/weather") {
    return redirectResult(`${contract.pwaOrigin}/nation/weather?from=link`);
  }
  if (trimmed === "/nation/air") {
    return redirectResult(`${contract.pwaOrigin}/nation/air?from=link`);
  }
  if (trimmed === "/warnings") {
    return redirectResult(`${contract.pwaOrigin}/warnings?from=link`);
  }
  if (trimmed.startsWith("/place/")) {
    const slug = trimmed.slice("/place/".length);
    if (!SLUG_RE.test(slug)) return { action: "error", status: 404 };
    const view = normalizeView(params.get("view"));
    if (view === "air") {
      const pollutant = normalizePollutant(params.get("pollutant"));
      const q = pollutant !== "aqi" ? `pollutant=${pollutant}&from=link` : "from=link";
      return redirectResult(`${contract.pwaOrigin}/air/${slug}?${q}`);
    }
    return redirectResult(`${contract.pwaOrigin}/weather/${slug}/${view}?from=link`);
  }
  if (trimmed.startsWith("/air/")) {
    const slug = trimmed.slice("/air/".length);
    if (!SLUG_RE.test(slug)) return { action: "error", status: 404 };
    const pollutant = normalizePollutant(params.get("pollutant"));
    const q = pollutant !== "aqi" ? `pollutant=${pollutant}&from=link` : "from=link";
    return redirectResult(`${contract.pwaOrigin}/air/${slug}?${q}`);
  }
  if (trimmed === "/loc") {
    const lat = parseFiniteCoord(params.get("lat"), -90, 90);
    const lon = parseFiniteCoord(params.get("lon"), -180, 180);
    if (lat === null || lon === null) {
      return redirectResult(`${contract.pwaOrigin}/`);
    }
    const name = sanitizeName(params.get("name"));
    const view = normalizeView(params.get("view"));
    const pollutant =
      view === "air" ? normalizePollutant(params.get("pollutant")) : null;
    const parts = [`lat=${lat}`, `lon=${lon}`];
    if (name) parts.push(`name=${encodeURIComponent(name)}`);
    if (view !== "hourly") parts.push(`view=${view}`);
    if (view === "air" && pollutant && pollutant !== "aqi") {
      parts.push(`pollutant=${pollutant}`);
    }
    parts.push("from=link");
    return redirectResult(`${contract.pwaOrigin}/loc?${parts.join("&")}`);
  }
  return { action: "error", status: 404 };
}

function referenceBuildShareUrl(input) {
  const view = normalizeView(input.view);
  const pollutant = view === "air" ? normalizePollutant(input.pollutant) : null;
  const latValid =
    typeof input.lat === "number" &&
    Number.isFinite(input.lat) &&
    input.lat >= -90 &&
    input.lat <= 90;
  const lonValid =
    typeof input.lon === "number" &&
    Number.isFinite(input.lon) &&
    input.lon >= -180 &&
    input.lon <= 180;

  let matchedSlug = null;
  if (input.placeId && catalog.some((c) => c.id === input.placeId)) {
    matchedSlug = input.placeId;
  } else if (latValid && lonValid) {
    const nearby = catalog.find(
      (c) =>
        Math.abs(c.lat - input.lat) < contract.catalogMatchDegrees &&
        Math.abs(c.lon - input.lon) < contract.catalogMatchDegrees,
    );
    if (nearby) matchedSlug = nearby.id;
  }

  if (matchedSlug) {
    if (view === "air") {
      const suffix = pollutant && pollutant !== "aqi" ? `?pollutant=${pollutant}` : "";
      return `${contract.canonicalOrigin}/air/${matchedSlug}${suffix}`;
    }
    const suffix = view === "daily" ? "?view=daily" : "";
    return `${contract.canonicalOrigin}/place/${matchedSlug}${suffix}`;
  }

  if (!latValid || !lonValid) {
    return `${contract.canonicalOrigin}/open`;
  }

  const lat = roundCoord(input.lat);
  const lon = roundCoord(input.lon);
  const name = sanitizeName(input.name);
  const parts = [`lat=${lat}`, `lon=${lon}`];
  if (name) parts.push(`name=${encodeURIComponent(name)}`);
  if (view !== "hourly") parts.push(`view=${view}`);
  if (view === "air" && pollutant && pollutant !== "aqi") {
    parts.push(`pollutant=${pollutant}`);
  }
  return `${contract.canonicalOrigin}/loc?${parts.join("&")}`;
}

test("golden catalog matches packages/weather-core PLACES exactly", () => {
  const source = fs.readFileSync(WEATHER_CORE_PATH, "utf8");
  const blockMatch = source.match(/export const PLACES: Place\[\] = \[([\s\S]*?)\]\.map/);
  assert.ok(blockMatch, "PLACES block not found in weather-core");
  const rowRe = /\["([^"]+)",\s*"[^"]+",\s*"[^"]+",\s*"[^"]+",\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\]/g;
  const actual = [];
  for (const m of blockMatch[1].matchAll(rowRe)) {
    actual.push({ id: m[1], lat: Number(m[2]), lon: Number(m[3]) });
  }
  assert.deepEqual(catalog, actual);
});

test("golden vector IDs are unique and contain no legacy Branch URLs or secrets", () => {
  const raw = fs.readFileSync(GOLDEN_PATH, "utf8");
  assert.equal(raw.includes("twa.app.link"), false);
  const ids = [
    ...golden.parseCases.map((c) => c.id),
    ...golden.shareBuildCases.map((c) => c.id),
  ];
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(contract.canonicalHost, "link.todayweather.ai");
  assert.deepEqual(contract.excludedHosts, ["todayweather.ai", "app.todayweather.ai"]);
});

test("store fallbacks carry the share-link campaign for App Store Connect and Google Play", () => {
  const apple = new URL(contract.appStoreUrl);
  assert.equal(apple.origin + apple.pathname, "https://apps.apple.com/app/apple-store/id1041700694");
  assert.match(apple.searchParams.get("pt") ?? "", /^\d+$/);
  assert.equal(apple.searchParams.get("ct"), "sharelink");
  assert.ok(apple.searchParams.get("ct").length <= 40);
  assert.equal(apple.searchParams.get("mt"), "8");

  const play = new URL(contract.playStoreUrl);
  assert.equal(play.origin + play.pathname, "https://play.google.com/store/apps/details");
  assert.equal(play.searchParams.get("id"), "net.wizardfactory.todayweather");
  const referrer = play.searchParams.get("referrer");
  assert.ok(encodeURIComponent(referrer).length <= 512);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(referrer)), {
    utm_source: "link.todayweather.ai",
    utm_medium: "share",
    utm_campaign: "sharelink",
  });
  // The referrer is a single query value: its own separators stay encoded.
  assert.equal([...play.searchParams.keys()].join(","), "id,referrer");
});

test("every parseCase matches the reference native parser and edge router", () => {
  for (const tc of golden.parseCases) {
    const target = referenceParseNative(tc.url);
    assert.deepEqual(
      target,
      tc.native,
      `native mismatch on case ${tc.id}`,
    );
    if (tc.catalogResolved !== undefined) {
      assert.equal(target?.kind, "place", `catalog resolution requires a place on ${tc.id}`);
      assert.equal(catalog.some(({ id }) => id === target.slug), tc.catalogResolved, tc.id);
    }
    if (tc.edge !== null) {
      const actual = referenceRouteEdge("GET", tc.url);
      if (tc.edge.vary === undefined) delete actual.vary;
      assert.deepEqual(
        actual,
        tc.edge,
        `edge mismatch on case ${tc.id}`,
      );
    }
  }
});

test("every edgeStoreFallbackCase routes by User-Agent or iPadOS hint", () => {
  for (const tc of golden.edgeStoreFallbackCases) {
    assert.deepEqual(
      referenceRouteEdge("GET", tc.url, tc.userAgent),
      tc.edge,
      `store fallback mismatch on case ${tc.id}`,
    );
  }
});

test("every edgeMethodCase returns the expected HTTP status", () => {
  for (const tc of golden.edgeMethodCases) {
    const res = referenceRouteEdge(tc.method, `${contract.canonicalOrigin}${tc.uri}`);
    assert.equal(res.status, tc.status, `method ${tc.method} ${tc.uri}`);
  }
});

test("every shareBuildCase matches canonical share URL generation and round-trips", () => {
  for (const tc of golden.shareBuildCases) {
    const built = referenceBuildShareUrl(tc.input);
    assert.equal(built, tc.url, `share URL mismatch on case ${tc.id}`);
    assert.ok(built.startsWith(contract.canonicalOrigin));
    const reparsed = referenceParseNative(built);
    assert.ok(reparsed !== null, `built URL failed to parse on case ${tc.id}`);
  }
});
