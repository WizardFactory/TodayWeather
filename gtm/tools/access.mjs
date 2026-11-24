// Read-only access checks for every GTM source. Prints one status line per source and never prints a value.
// Usage: set -a; . "$HOME/.config/todayweather/gtm/gtm.env"; set +a; node gtm/tools/check-access.mjs
import { createPrivateKey, createSign } from "node:crypto";
import { readFileSync } from "node:fs";

export const APP_STORE_ID = "1041700694";
export const PACKAGE = "net.wizardfactory.todayweather";

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

export function missingVars(source, env) {
  return source.vars.filter((name) => !env[name]);
}

const b64url = (value) => Buffer.from(value).toString("base64url");

export function signJwt(header, claims, sign) {
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export function appStoreToken(env, now, read = readFileSync) {
  const key = createPrivateKey(read(env.TW_ASC_SALES_KEY_FILE));
  return signJwt(
    { alg: "ES256", kid: env.TW_ASC_SALES_KEY_ID, typ: "JWT" },
    { iss: env.TW_ASC_ISSUER_ID, iat: now, exp: now + 600, aud: "appstoreconnect-v1" },
    (text) => createSign("SHA256").update(text).sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url"),
  );
}

async function serviceAccountToken(env, now, scope, fetchImpl, read) {
  const account = JSON.parse(read(env.TW_PLAY_JSON_KEY, "utf8"));
  const assertion = signJwt(
    { alg: "RS256", typ: "JWT" },
    { iss: account.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 600 },
    (text) => createSign("RSA-SHA256").update(text).sign(account.private_key).toString("base64url"),
  );
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  return { status: response.status, token: (await response.json().catch(() => ({}))).access_token };
}

async function admobToken(env, fetchImpl, read) {
  const saved = JSON.parse(read(env.TW_ADMOB_OAUTH_FILE, "utf8"));
  const response = await fetchImpl(saved.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: saved.client_id, client_secret: saved.client_secret, refresh_token: saved.refresh_token }),
  });
  return { status: response.status, token: (await response.json().catch(() => ({}))).access_token };
}

/** A date in Pacific reporting days that Apple has published by now: three days back. */
export function publishedReportDate(nowMs) {
  return new Date(nowMs - 3 * 86400e3).toISOString().slice(0, 10);
}

/** Maps a response to ok or refused; a report that is not published yet still proves access. */
export function classify(status, body) {
  if (status >= 200 && status < 300) return "ok";
  const code = body?.errors?.[0]?.code;
  if (status === 404 && code === "NOT_FOUND") return "ok (report not published yet)";
  return `refused (HTTP ${status}${code ? ` ${code}` : ""})`;
}

async function call(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  const body = await response.json().catch(() => ({}));
  return classify(response.status, body);
}

/** One read-only request per source. `deps` are injected so tests can replace every external effect. */
export async function checkSource(name, env, deps) {
  const { fetchImpl, read, run, nowMs } = deps;
  const now = Math.floor(nowMs / 1000);
  switch (name) {
    case "appstore-sales": {
      const query = new URLSearchParams({
        "filter[frequency]": "DAILY", "filter[reportType]": "SALES", "filter[reportSubType]": "SUMMARY",
        "filter[vendorNumber]": env.TW_ASC_VENDOR_NUMBER, "filter[reportDate]": publishedReportDate(nowMs), "filter[version]": "1_0",
      });
      return call(fetchImpl, `https://api.appstoreconnect.apple.com/v1/salesReports?${query}`, {
        headers: { Authorization: `Bearer ${appStoreToken(env, now, read)}`, Accept: "application/a-gzip" },
      });
    }
    case "appstore-reviews":
      return call(fetchImpl, `https://api.appstoreconnect.apple.com/v1/apps/${APP_STORE_ID}/customerReviews?limit=1`, {
        headers: { Authorization: `Bearer ${appStoreToken(env, now, read)}` },
      });
    case "play-reviews": {
      const t = await serviceAccountToken(env, now, "https://www.googleapis.com/auth/androidpublisher", fetchImpl, read);
      if (!t.token) return `refused (token HTTP ${t.status})`;
      return call(fetchImpl, `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/reviews?maxResults=1`, {
        headers: { Authorization: `Bearer ${t.token}` },
      });
    }
    case "play-report-files": {
      const t = await serviceAccountToken(env, now, "https://www.googleapis.com/auth/devstorage.read_only", fetchImpl, read);
      if (!t.token) return `refused (token HTTP ${t.status})`;
      const bucket = env.TW_PLAY_REPORT_BUCKET.replace(/^gs:\/\//, "").replace(/\/$/, "");
      const prefix = encodeURIComponent(`stats/installs/installs_${PACKAGE}_`);
      return call(fetchImpl, `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=${prefix}&maxResults=1&fields=items(name)`, {
        headers: { Authorization: `Bearer ${t.token}` },
      });
    }
    case "admob-network": {
      const t = await admobToken(env, fetchImpl, read);
      if (!t.token) return `refused (token HTTP ${t.status})`;
      return call(fetchImpl, `https://admob.googleapis.com/v1/accounts/${env.TW_ADMOB_PUBLISHER_ID}`, {
        headers: { Authorization: `Bearer ${t.token}` },
      });
    }
    case "store-public":
      return call(fetchImpl, `https://itunes.apple.com/lookup?id=${APP_STORE_ID}&country=kr`, {});
    case "gtm-bucket": {
      const result = run("aws", ["s3api", "list-objects-v2", "--bucket", env.TW_GTM_S3_URI.replace(/^s3:\/\//, "").replace(/\/.*$/, ""), "--max-items", "1"], {
        env: { ...process.env, AWS_SHARED_CREDENTIALS_FILE: env.TW_GTM_AWS_CREDENTIALS, AWS_PROFILE: env.TW_GTM_AWS_PROFILE },
      });
      return result.status === 0 ? "ok" : `refused (aws exit ${result.status ?? "not run"})`;
    }
    default:
      throw new Error(`unknown source ${name}`);
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
      results.push({ name: source.name, status: `failed (${error.name})` });
    }
  }
  return results;
}

export const passed = (status) => status.startsWith("ok");
