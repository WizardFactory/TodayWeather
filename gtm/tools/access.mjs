// Read-only access checks for every GTM source. Each source is reported as `ok`, `refused (...)` or
// `not configured (...)`. Reasons are fixed texts and numeric HTTP codes only: no response body, error
// message or configured value is ever printed.
// Usage: set -a; . "$HOME/.config/todayweather/gtm/gtm.env"; set +a; node gtm/tools/check-access.mjs
import { createPrivateKey, createSign } from "node:crypto";
import { readFileSync } from "node:fs";

export const APP_STORE_ID = "1041700694";
export const PACKAGE = "net.wizardfactory.todayweather";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GTM_BUCKET_REGION = "ap-northeast-2";

/** Variables each source needs; a source with a missing variable is reported as not configured. */
export const SOURCES = [
  { name: "appstore-sales", vars: ["TW_ASC_ISSUER_ID", "TW_ASC_SALES_KEY_ID", "TW_ASC_SALES_KEY_FILE", "TW_ASC_VENDOR_NUMBER"] },
  { name: "appstore-reviews", vars: ["TW_ASC_ISSUER_ID", "TW_ASC_SALES_KEY_ID", "TW_ASC_SALES_KEY_FILE"] },
  { name: "play-reviews", vars: ["TW_PLAY_JSON_KEY"] },
  { name: "play-report-files", vars: ["TW_PLAY_JSON_KEY", "TW_PLAY_REPORT_BUCKET"] },
  { name: "admob-network", vars: ["TW_ADMOB_OAUTH_FILE", "TW_ADMOB_PUBLISHER_ID"] },
  { name: "store-public", vars: [] },
  { name: "gtm-bucket", vars: ["TW_GTM_S3_URI", "TW_GTM_AWS_CREDENTIALS", "TW_GTM_AWS_PROFILE"] },
];

// AWS variables a parent shell may carry. The bucket check removes them so only the collector profile can answer.
export const INHERITED_AWS = [
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN", "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE", "AWS_CONFIG_FILE", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_ROLE_ARN",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN",
];

export const OK = "ok";
export const refused = (reason) => `refused (${reason})`;
export const passed = (status) => status === OK;

/** A failure whose reason is a fixed text, safe to print. */
class Refusal extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

export function missingVars(source, env) {
  return source.vars.filter((name) => !env[name]);
}

const b64url = (value) => Buffer.from(value).toString("base64url");

export function signJwt(header, claims, sign) {
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  return `${unsigned}.${sign(unsigned)}`;
}

function readKey(read, path, what) {
  try {
    return read(path, "utf8");
  } catch {
    throw new Refusal(`cannot read ${what}`);
  }
}

function appStoreToken(env, now, read) {
  let key;
  try {
    key = createPrivateKey(readKey(read, env.TW_ASC_SALES_KEY_FILE, "App Store key file"));
  } catch (error) {
    throw error instanceof Refusal ? error : new Refusal("invalid App Store key file");
  }
  return signJwt(
    { alg: "ES256", kid: env.TW_ASC_SALES_KEY_ID, typ: "JWT" },
    { iss: env.TW_ASC_ISSUER_ID, iat: now, exp: now + 600, aud: "appstoreconnect-v1" },
    (text) => createSign("SHA256").update(text).sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url"),
  );
}

/** Every request refuses redirects, so credentials never follow a Location header. */
async function request(fetchImpl, url, init = {}) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, redirect: "error" });
  } catch {
    throw new Refusal("network error");
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function expectOk({ status }) {
  if (status < 200 || status >= 300) throw new Refusal(`HTTP ${status}`);
}

async function googleToken(fetchImpl, form) {
  const r = await request(fetchImpl, GOOGLE_TOKEN_URL, { method: "POST", body: new URLSearchParams(form) });
  if (r.status !== 200 || typeof r.body?.access_token !== "string") throw new Refusal(`token HTTP ${r.status}`);
  return r.body.access_token;
}

function serviceAccountToken(env, now, scope, fetchImpl, read) {
  let account;
  try {
    account = JSON.parse(readKey(read, env.TW_PLAY_JSON_KEY, "Google Play key file"));
  } catch (error) {
    throw error instanceof Refusal ? error : new Refusal("invalid Google Play key file");
  }
  let assertion;
  try {
    assertion = signJwt(
      { alg: "RS256", typ: "JWT" },
      { iss: account.client_email, scope, aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 600 },
      (text) => createSign("RSA-SHA256").update(text).sign(account.private_key).toString("base64url"),
    );
  } catch {
    throw new Refusal("invalid Google Play key file");
  }
  return googleToken(fetchImpl, { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
}

function admobToken(env, fetchImpl, read) {
  let saved;
  try {
    saved = JSON.parse(readKey(read, env.TW_ADMOB_OAUTH_FILE, "AdMob token file"));
  } catch (error) {
    throw error instanceof Refusal ? error : new Refusal("invalid AdMob token file");
  }
  // The endpoint is fixed: a token_uri in the file is ignored, so the secret cannot be sent elsewhere.
  return googleToken(fetchImpl, {
    grant_type: "refresh_token", client_id: saved.client_id, client_secret: saved.client_secret, refresh_token: saved.refresh_token,
  });
}

/** A day Apple has published by now: three days back (reports use Pacific days and appear the next morning). */
export function publishedReportDate(nowMs) {
  return new Date(nowMs - 3 * 86400e3).toISOString().slice(0, 10);
}

function utcDayParts(nowMs, daysBack) {
  const d = new Date(nowMs - daysBack * 86400e3);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

async function checkAppStoreSales(env, deps, now) {
  const query = new URLSearchParams({
    "filter[frequency]": "DAILY", "filter[reportType]": "SALES", "filter[reportSubType]": "SUMMARY",
    "filter[vendorNumber]": env.TW_ASC_VENDOR_NUMBER, "filter[reportDate]": publishedReportDate(deps.nowMs), "filter[version]": "1_0",
  });
  const r = await request(deps.fetchImpl, `https://api.appstoreconnect.apple.com/v1/salesReports?${query}`, {
    headers: { Authorization: `Bearer ${appStoreToken(env, now, deps.read)}`, Accept: "application/a-gzip" },
  });
  // Only the sales report may answer "not published yet"; Apple returns 404 NOT_FOUND for that day.
  if (r.status === 404 && r.body?.errors?.[0]?.code === "NOT_FOUND") return OK;
  expectOk(r);
  return OK;
}

async function checkAppStoreReviews(env, deps, now) {
  const r = await request(deps.fetchImpl, `https://api.appstoreconnect.apple.com/v1/apps/${APP_STORE_ID}/customerReviews?limit=1`, {
    headers: { Authorization: `Bearer ${appStoreToken(env, now, deps.read)}` },
  });
  expectOk(r);
  if (!Array.isArray(r.body?.data)) throw new Refusal("unexpected response");
  return OK;
}

async function checkPlayReviews(env, deps, now) {
  const token = await serviceAccountToken(env, now, "https://www.googleapis.com/auth/androidpublisher", deps.fetchImpl, deps.read);
  const r = await request(deps.fetchImpl, `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/reviews?maxResults=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expectOk(r);
  return OK;
}

/** Lists the installs and ratings files and reads one byte of each newest file, so object reads are proven too. */
async function checkPlayReportFiles(env, deps, now) {
  const token = await serviceAccountToken(env, now, "https://www.googleapis.com/auth/devstorage.read_only", deps.fetchImpl, deps.read);
  const bucket = env.TW_PLAY_REPORT_BUCKET.replace(/^gs:\/\//, "").replace(/\/.*$/, "");
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`;
  for (const kind of ["installs", "ratings"]) {
    const prefix = encodeURIComponent(`stats/${kind}/${kind}_${PACKAGE}_`);
    const list = await request(deps.fetchImpl, `${base}?prefix=${prefix}&fields=items(name)`, { headers: { Authorization: `Bearer ${token}` } });
    expectOk(list);
    const names = (list.body?.items ?? []).map((item) => item.name).filter((name) => typeof name === "string").sort();
    if (!names.length) throw new Refusal(`no ${kind} files`);
    const object = await request(deps.fetchImpl, `${base}/${encodeURIComponent(names.at(-1))}?alt=media`, {
      headers: { Authorization: `Bearer ${token}`, Range: "bytes=0-0" },
    });
    expectOk(object);
  }
  return OK;
}

/** Generates a one-day network report: the read the collector needs, not just account metadata. */
async function checkAdmob(env, deps) {
  const token = await admobToken(env, deps.fetchImpl, deps.read);
  const day = utcDayParts(deps.nowMs, 3);
  const r = await request(deps.fetchImpl, `https://admob.googleapis.com/v1/accounts/${encodeURIComponent(env.TW_ADMOB_PUBLISHER_ID)}/networkReport:generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reportSpec: { dateRange: { startDate: day, endDate: day }, dimensions: ["DATE"], metrics: ["IMPRESSIONS"] } }),
  });
  expectOk(r);
  return OK;
}

async function checkStorePublic(deps) {
  const apple = await request(deps.fetchImpl, `https://itunes.apple.com/lookup?id=${APP_STORE_ID}&country=kr`);
  expectOk(apple);
  if (!(apple.body?.resultCount >= 1)) throw new Refusal("App Store lookup returned no app");
  let play;
  try {
    play = await deps.fetchImpl(`https://play.google.com/store/apps/details?id=${PACKAGE}&hl=ko&gl=KR`, { redirect: "error" });
  } catch {
    throw new Refusal("network error");
  }
  if (play.status !== 200) throw new Refusal(`Google Play listing HTTP ${play.status}`);
  const html = await play.text().catch(() => "");
  if (!/"ratingValue"/.test(html)) throw new Refusal("Google Play listing has no rating");
  return OK;
}

function checkBucket(env, deps) {
  const childEnv = { ...deps.processEnv };
  for (const name of INHERITED_AWS) delete childEnv[name];
  childEnv.AWS_SHARED_CREDENTIALS_FILE = env.TW_GTM_AWS_CREDENTIALS;
  childEnv.AWS_CONFIG_FILE = "/dev/null";
  const bucket = env.TW_GTM_S3_URI.replace(/^s3:\/\//, "").replace(/\/.*$/, "");
  const result = deps.run("aws", [
    "s3api", "list-objects-v2", "--bucket", bucket, "--max-items", "1",
    "--profile", env.TW_GTM_AWS_PROFILE, "--region", GTM_BUCKET_REGION,
  ], { env: childEnv });
  if (result.status !== 0) throw new Refusal(result.status == null ? "aws CLI not run" : `aws exit ${result.status}`);
  return OK;
}

/** One read-only check per source. `deps` are injected so tests can replace every external effect. */
export async function checkSource(name, env, deps) {
  const now = Math.floor(deps.nowMs / 1000);
  switch (name) {
    case "appstore-sales": return checkAppStoreSales(env, deps, now);
    case "appstore-reviews": return checkAppStoreReviews(env, deps, now);
    case "play-reviews": return checkPlayReviews(env, deps, now);
    case "play-report-files": return checkPlayReportFiles(env, deps, now);
    case "admob-network": return checkAdmob(env, deps);
    case "store-public": return checkStorePublic(deps);
    case "gtm-bucket": return checkBucket(env, deps);
    default: throw new Refusal("unknown source");
  }
}

export async function checkAll(env, deps) {
  const results = [];
  for (const source of SOURCES) {
    const missing = missingVars(source, env);
    if (missing.length) {
      results.push({ name: source.name, status: `not configured (missing ${missing.join(", ")})` });
      continue;
    }
    try {
      results.push({ name: source.name, status: await checkSource(source.name, env, deps) });
    } catch (error) {
      results.push({ name: source.name, status: refused(error instanceof Refusal ? error.reason : "unexpected error") });
    }
  }
  return results;
}
