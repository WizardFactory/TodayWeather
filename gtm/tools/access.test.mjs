import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { checkAll, classify, passed, publishedReportDate, SOURCES } from "./access.mjs";

const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
const files = {
  "/k/asc.p8": ec,
  "/k/play.json": JSON.stringify({ client_email: "sa@example.iam.gserviceaccount.com", private_key: rsa }),
  "/k/admob.json": JSON.stringify({ client_id: "cid", client_secret: "csecret-value", refresh_token: "rtoken-value" }),
};
const env = {
  TW_ASC_ISSUER_ID: "issuer-value", TW_ASC_SALES_KEY_ID: "KEYIDVALUE", TW_ASC_SALES_KEY_FILE: "/k/asc.p8", TW_ASC_VENDOR_NUMBER: "80000000",
  TW_PLAY_JSON_KEY: "/k/play.json", TW_PLAY_REPORT_BUCKET: "gs://pubsite_prod_rev_123",
  TW_ADMOB_OAUTH_FILE: "/k/admob.json", TW_ADMOB_PUBLISHER_ID: "pub-999",
  TW_GTM_S3_URI: "s3://bucket-x", TW_GTM_AWS_CREDENTIALS: "/k/aws", TW_GTM_AWS_PROFILE: "p",
};
const read = (path) => { if (!(path in files)) throw Object.assign(new Error("ENOENT"), { name: "Error" }); return files[path]; };
const response = (status, body = {}) => ({ status, json: async () => body });

function deps(statusFor, runStatus = 0) {
  const calls = [];
  return {
    calls,
    nowMs: Date.parse("2026-11-24T00:00:00Z"),
    read,
    run: (cmd, args, options) => { calls.push({ cmd, args, options }); return { status: runStatus }; },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.startsWith("https://oauth2.googleapis.com/token")) return response(200, { access_token: "access-value" });
      return response(...statusFor(url));
    },
  };
}

test("every source passes when each service answers 200", async () => {
  const d = deps(() => [200, { data: [] }]);
  const results = await checkAll(env, d);
  assert.deepEqual(results.map((r) => r.name), SOURCES.map((s) => s.name));
  assert.ok(results.every((r) => passed(r.status)), JSON.stringify(results));
  const s3 = d.calls.find((c) => c.cmd === "aws");
  assert.deepEqual(s3.args.slice(0, 3), ["s3api", "list-objects-v2", "--bucket"]);
  assert.equal(s3.args[3], "bucket-x");
  assert.equal(s3.options.env.AWS_SHARED_CREDENTIALS_FILE, "/k/aws");
});

test("a refused source is reported with its status and the others still run", async () => {
  const d = deps((url) => (url.includes("storage.googleapis.com") ? [403, { error: { message: "no access" } }] : [200, {}]));
  const results = await checkAll(env, d);
  const files = results.find((r) => r.name === "play-report-files");
  assert.equal(files.status, "refused (HTTP 403)");
  assert.equal(results.filter((r) => !passed(r.status)).length, 1);
});

test("an unpublished Apple report still proves access", () => {
  assert.equal(classify(404, { errors: [{ code: "NOT_FOUND" }] }), "ok (report not published yet)");
  assert.equal(classify(403, { errors: [{ code: "FORBIDDEN_ERROR" }] }), "refused (HTTP 403 FORBIDDEN_ERROR)");
});

test("missing variables are reported per source without calling it", async () => {
  const d = deps(() => [200, {}]);
  const partial = { ...env, TW_ADMOB_OAUTH_FILE: "", TW_ASC_VENDOR_NUMBER: undefined };
  const results = await checkAll(partial, d);
  assert.equal(results.find((r) => r.name === "admob-network").status, "not configured (missing TW_ADMOB_OAUTH_FILE)");
  assert.equal(results.find((r) => r.name === "appstore-sales").status, "not configured (missing TW_ASC_VENDOR_NUMBER)");
  assert.ok(passed(results.find((r) => r.name === "appstore-reviews").status));
  assert.ok(!d.calls.some((c) => c.url?.includes("admob.googleapis.com") || c.url?.includes("salesReports")));
});

test("an unreadable key file fails that source only", async () => {
  const d = deps(() => [200, {}]);
  const results = await checkAll({ ...env, TW_ASC_SALES_KEY_FILE: "/k/missing.p8" }, d);
  assert.equal(results.find((r) => r.name === "appstore-sales").status, "failed (Error)");
  assert.ok(passed(results.find((r) => r.name === "play-reviews").status));
});

test("results never contain a configured value", async () => {
  const d = deps((url) => (url.includes("admob") ? [401, {}] : [200, {}]), 255);
  const text = JSON.stringify(await checkAll(env, d));
  for (const value of ["issuer-value", "KEYIDVALUE", "80000000", "pubsite_prod_rev_123", "pub-999", "bucket-x", "csecret-value", "rtoken-value", "access-value"]) {
    assert.ok(!text.includes(value), value);
  }
});

test("the sales report date is three days back in UTC", () => {
  assert.equal(publishedReportDate(Date.parse("2026-11-24T00:30:00Z")), "2026-11-21");
});
