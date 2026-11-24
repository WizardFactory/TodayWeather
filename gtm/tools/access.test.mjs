import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { checkAll, GOOGLE_TOKEN_URL, INHERITED_AWS, passed, publishedReportDate, SOURCES } from "./access.mjs";
import { main } from "./check-access.mjs";

const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
const files = {
  "/k/asc.p8": ec,
  "/k/play.json": JSON.stringify({ client_email: "sa@example.iam.gserviceaccount.com", private_key: rsa }),
  "/k/admob.json": JSON.stringify({ client_id: "cid-value", client_secret: "csecret-value", refresh_token: "rtoken-value", token_uri: "https://evil.example/token" }),
};
const env = {
  TW_ASC_ISSUER_ID: "issuer-value", TW_ASC_SALES_KEY_ID: "KEYIDVALUE", TW_ASC_SALES_KEY_FILE: "/k/asc.p8", TW_ASC_VENDOR_NUMBER: "80000000",
  TW_PLAY_JSON_KEY: "/k/play.json", TW_PLAY_REPORT_BUCKET: "gs://pubsite_prod_rev_example",
  TW_ADMOB_OAUTH_FILE: "/k/admob.json", TW_ADMOB_PUBLISHER_ID: "pub-999",
  TW_GTM_S3_URI: "s3://bucket-x", TW_GTM_AWS_CREDENTIALS: "/k/aws", TW_GTM_AWS_PROFILE: "collector",
};
const SECRETS = ["issuer-value", "KEYIDVALUE", "80000000", "pubsite_prod_rev_example", "pub-999", "bucket-x", "cid-value", "csecret-value", "rtoken-value", "access-value", "/k/"];
const read = (path) => {
  if (!(path in files)) throw new Error(`ENOENT ${path}`);
  return files[path];
};
const json = (status, body) => ({ status, json: async () => body, text: async () => JSON.stringify(body) });
const html = (status, text) => ({ status, json: async () => { throw new Error("not json"); }, text: async () => text });

/** Default answers of every service; `override(url, init)` may return a response to replace one. */
function deps(override = () => null, runStatus = 0) {
  const calls = [];
  return {
    calls,
    nowMs: Date.parse("2026-11-24T00:00:00Z"),
    read,
    processEnv: { PATH: "/usr/bin", AWS_ACCESS_KEY_ID: "inherited-key", AWS_PROFILE: "admin", HOME: "/home/x" },
    run: (cmd, args, options) => { calls.push({ cmd, args, options }); return { status: runStatus }; },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      const replaced = override(url, init);
      if (replaced) return replaced;
      if (url === GOOGLE_TOKEN_URL) return json(200, { access_token: "access-value" });
      if (url.includes("storage.googleapis.com") && url.includes("alt=media")) return json(206, {});
      if (url.includes("storage.googleapis.com")) {
        const kind = decodeURIComponent(url).includes("stats/ratings/") ? "ratings" : "installs";
        return json(200, { items: [{ name: `stats/${kind}/${kind}_x_202610_country.csv` }, { name: `stats/${kind}/${kind}_x_202611_country.csv` }] });
      }
      if (url.includes("itunes.apple.com")) return json(200, { resultCount: 1, results: [{}] });
      if (url.includes("play.google.com/store")) return html(200, '<script>{"ratingValue":"3.2"}</script>');
      return json(200, { data: [] });
    },
  };
}

async function runMain(d, e = env) {
  const lines = [];
  const code = await main({ env: e, deps: d, out: (line) => lines.push(line) });
  return { code, text: lines.join("\n"), lines };
}

test("every source passes when each service answers as expected", async () => {
  const d = deps();
  const { code, lines } = await runMain(d);
  assert.equal(code, 0);
  assert.equal(lines.length, SOURCES.length);
  assert.ok(lines.every((line) => line.endsWith(" ok")), lines.join("\n"));
});

test("statuses are only ok, refused or not configured", async () => {
  const d = deps((url) => (url.includes("customerReviews") ? json(500, {}) : null));
  const results = await checkAll({ ...env, TW_ADMOB_OAUTH_FILE: "" }, d);
  for (const { status } of results) assert.match(status, /^(ok|refused \(.+\)|not configured \(.+\))$/);
});

test("CODEX-3146-1: response bodies never reach the output, even when they echo a configured value", async () => {
  const echo = { errors: [{ code: "80000000", detail: "issuer-value KEYIDVALUE" }], error: { message: "pub-999 rtoken-value" } };
  const d = deps((url) => (url === GOOGLE_TOKEN_URL ? json(400, echo) : json(403, echo)), 254);
  const { code, text } = await runMain(d);
  assert.equal(code, 1);
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `leaked ${secret}`);
  assert.match(text, /appstore-sales +refused \(HTTP 403\)/);
  assert.match(text, /play-reviews +refused \(token HTTP 400\)/);
});

test("CODEX-3146-2: only the sales report may treat 404 NOT_FOUND as not published yet", async () => {
  const notFound = json(404, { errors: [{ code: "NOT_FOUND" }] });
  const d = deps((url) => (url.includes("salesReports") || url.includes("customerReviews") ? notFound : null));
  const results = Object.fromEntries((await checkAll(env, d)).map((r) => [r.name, r.status]));
  assert.equal(results["appstore-sales"], "ok");
  assert.equal(results["appstore-reviews"], "refused (HTTP 404)");
});

test("CODEX-3146-3: the AdMob secret goes only to Google's token endpoint and no request follows redirects", async () => {
  const d = deps();
  await checkAll(env, d);
  const fetches = d.calls.filter((c) => c.url);
  assert.ok(fetches.every((c) => c.init.redirect === "error"));
  const withSecret = fetches.filter((c) => String(c.init.body ?? "").includes("csecret-value"));
  assert.equal(withSecret.length, 1);
  assert.equal(withSecret[0].url, GOOGLE_TOKEN_URL);
  assert.ok(!fetches.some((c) => c.url.includes("evil.example")));
});

test("CODEX-3146-4: the bucket check uses only the collector profile", async () => {
  const d = deps();
  await checkAll(env, d);
  const s3 = d.calls.find((c) => c.cmd === "aws");
  assert.deepEqual(s3.args.slice(0, 4), ["s3api", "list-objects-v2", "--bucket", "bucket-x"]);
  assert.equal(s3.args[s3.args.indexOf("--profile") + 1], "collector");
  for (const name of INHERITED_AWS) if (name !== "AWS_CONFIG_FILE") assert.equal(s3.options.env[name], undefined, name);
  assert.equal(s3.options.env.AWS_SHARED_CREDENTIALS_FILE, "/k/aws");
  assert.equal(s3.options.env.AWS_CONFIG_FILE, "/dev/null");
  assert.equal(s3.options.env.PATH, "/usr/bin");
});

test("CODEX-3146-5: Play report files need both kinds listed and readable; AdMob generates a report", async () => {
  const empty = deps((url) => (url.includes("storage.googleapis.com") && decodeURIComponent(url).includes("stats/ratings/") && !url.includes("alt=media") ? json(200, {}) : null));
  assert.equal((await checkAll(env, empty)).find((r) => r.name === "play-report-files").status, "refused (no ratings files)");
  const unreadable = deps((url) => (url.includes("alt=media") ? json(403, {}) : null));
  assert.equal((await checkAll(env, unreadable)).find((r) => r.name === "play-report-files").status, "refused (HTTP 403)");
  const ok = deps();
  await checkAll(env, ok);
  const reads = ok.calls.filter((c) => c.url?.includes("alt=media"));
  assert.equal(reads.length, 2);
  assert.ok(reads.every((c) => c.init.headers.Range === "bytes=0-0" && c.url.includes("202611")));
  const admob = ok.calls.find((c) => c.url?.includes("admob.googleapis.com"));
  assert.ok(admob.url.endsWith("/networkReport:generate"));
  assert.equal(admob.init.method, "POST");
  const report = deps((url) => (url.includes("networkReport") ? json(403, {}) : null));
  assert.equal((await checkAll(env, report)).find((r) => r.name === "admob-network").status, "refused (HTTP 403)");
});

test("CODEX-3146-6: public ratings need the Apple app and the Google Play listing", async () => {
  const noApp = deps((url) => (url.includes("itunes.apple.com") ? json(200, { resultCount: 0, results: [] }) : null));
  assert.equal((await checkAll(env, noApp)).find((r) => r.name === "store-public").status, "refused (App Store lookup returned no app)");
  const noPlay = deps((url) => (url.includes("play.google.com/store") ? html(404, "") : null));
  assert.equal((await checkAll(env, noPlay)).find((r) => r.name === "store-public").status, "refused (Google Play listing HTTP 404)");
});

test("CODEX-3146-7: unreadable keys and network errors are refusals with fixed reasons", async () => {
  const d = deps((url) => (url.includes("androidpublisher") ? Promise.reject(new Error("ECONNRESET issuer-value")) : null));
  const { code, text } = await runMain(d, { ...env, TW_ASC_SALES_KEY_FILE: "/k/missing.p8" });
  assert.equal(code, 1);
  assert.match(text, /appstore-sales +refused \(cannot read App Store key file\)/);
  assert.match(text, /play-reviews +refused \(network error\)/);
  assert.match(text, /play-report-files +ok/);
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `leaked ${secret}`);
});

test("missing variables are reported per source without calling it", async () => {
  const d = deps();
  const results = await checkAll({ ...env, TW_ADMOB_OAUTH_FILE: "", TW_ASC_VENDOR_NUMBER: undefined }, d);
  assert.equal(results.find((r) => r.name === "admob-network").status, "not configured (missing TW_ADMOB_OAUTH_FILE)");
  assert.equal(results.find((r) => r.name === "appstore-sales").status, "not configured (missing TW_ASC_VENDOR_NUMBER)");
  assert.ok(passed(results.find((r) => r.name === "appstore-reviews").status));
  assert.ok(!d.calls.some((c) => c.url?.includes("admob.googleapis.com") || c.url?.includes("salesReports")));
});

test("the sales report date is three days back in UTC", () => {
  assert.equal(publishedReportDate(Date.parse("2026-11-24T00:30:00Z")), "2026-11-21");
});
