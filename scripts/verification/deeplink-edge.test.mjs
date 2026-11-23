import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { AASA, ASSET_LINKS, associations } from "../deploy-deeplink-static.mjs";
import { smoke } from "../deeplink-live-smoke.mjs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const golden = JSON.parse(read("../../specs/deeplink.golden.json"));
const routeSource = read("../../infra/deeplink/route-request.js");
const handler = runInNewContext(routeSource + "\nhandler");

function request(uri, method = "GET", query = "", userAgent = "") {
  const querystring = Object.create(null);
  for (const pair of query ? query.split("&") : []) {
    const [key, ...value] = pair.split("=");
    querystring[key] ??= { value: value.join("=") };
  }
  const headers = userAgent ? { "user-agent": { value: userAgent } } : {};
  return handler({ request: { uri, method, querystring, headers } });
}

function summarize(uri, result, includeVary = false) {
  const status = result.statusCode ?? 200;
  if (status === 302) {
    const out = { action: "redirect", status, location: result.headers.location.value };
    if (includeVary && result.headers.vary?.value) out.vary = result.headers.vary.value;
    return out;
  }
  return status === 200
    ? { action: result.uri === uri ? "passthrough" : "rewrite", status, uri: result.uri }
    : { action: "error", status };
}

test("the CloudFront handler follows the golden routing vectors", () => {
  for (const { id, url, edge } of golden.parseCases.filter(({ edge }) => edge)) {
    // URL normalizes dot segments. Keep the raw path for malformed-path cases.
    const [, path, query] = /^https:\/\/[^/?]+([^?]*)(?:\?(.*))?$/i.exec(url);
    const uri = path || "/";
    const result = request(uri, "GET", query);
    assert.deepEqual(summarize(uri, result), edge, id);
  }
  for (const { id, url, userAgent, edge } of golden.edgeStoreFallbackCases) {
    const [, path, query] = /^https:\/\/[^/?]+([^?]*)(?:\?(.*))?$/i.exec(url);
    const uri = path || "/";
    const result = request(uri, "GET", query, userAgent);
    assert.deepEqual(summarize(uri, result, true), edge, id);
  }
  for (const { method, uri, status } of golden.edgeMethodCases) {
    assert.equal(request(uri, method).statusCode ?? 200, status, `${method} ${uri}`);
  }
});

test("unknown paths and removed fallback assets return 404", () => {
  for (const uri of ["//", "/open//", "/open.html", "/assets/preview.png", "/assets/open.js", "/.well-known/other"]) {
    assert.equal(request(uri).statusCode, 404, uri);
  }
});

const stack = JSON.parse(read("../../infra/deeplink/stack.json"));
test("the stack embeds the checked handler and isolates a read-only S3 origin", () => {
  const resources = stack.Resources;
  assert.equal(resources.Navigation.Properties.FunctionCode, routeSource);
  assert.equal(resources.Navigation.Properties.FunctionConfig.Runtime, "cloudfront-js-2.0");
  assert.equal(resources.Navigation.Properties.AutoPublish, true);
  const bucket = resources.Assets.Properties;
  assert.ok(Object.values(bucket.PublicAccessBlockConfiguration).every(Boolean));
  assert.equal(bucket.VersioningConfiguration.Status, "Enabled");
  assert.equal(bucket.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm, "AES256");
  assert.equal(resources.OriginAccess.Properties.OriginAccessControlConfig.SigningBehavior, "always");
  const read = resources.BucketPolicy.Properties.PolicyDocument.Statement.filter(({ Effect }) => Effect === "Allow");
  assert.deepEqual(read.map(({ Action }) => Action), ["s3:GetObject"]);
  assert.ok(read[0].Condition.StringEquals["AWS:SourceArn"]);
  const distribution = resources.Distribution.Properties.DistributionConfig;
  assert.equal(distribution.DefaultCacheBehavior.ViewerProtocolPolicy, "redirect-to-https");
  assert.equal(distribution.ViewerCertificate.MinimumProtocolVersion, "TLSv1.2_2021");
  assert.ok(distribution.CustomErrorResponses.every((entry) => !entry.ResponsePagePath && !entry.ResponseCode));
});

// CODEX-3155-2: the live smoke run against this handler, with the association files served as S3 would.
const identity = {
  teamId: "TESTTEAM00",
  fingerprint: Array(32).fill("00").join(":"),
};

function edgeFetcher({ dropVary = false } = {}) {
  const files = associations(identity);
  return async (url, init) => {
    const parsed = new URL(url);
    // The WHATWG URL collapses nothing in "//"; pass the raw path on as CloudFront does.
    const result = request(
      parsed.pathname,
      init.method,
      parsed.search.slice(1),
      init.headers["user-agent"] ?? "",
    );
    const status = result.statusCode ?? 200;
    if (status === 200) {
      const key = result.uri.slice(1);
      if (key !== AASA && key !== ASSET_LINKS) return new Response(null, { status: 404 });
      return new Response(JSON.stringify(files[key]), {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
      });
    }
    const headers = {};
    for (const [name, header] of Object.entries(result.headers ?? {})) {
      if (!(dropVary && name === "vary")) headers[name] = header.value;
    }
    return new Response(null, { status, headers });
  };
}

test("the live smoke passes against the handler and requires Vary: User-Agent on store fallbacks", async () => {
  await smoke(identity, edgeFetcher());
  await assert.rejects(smoke(identity, edgeFetcher({ dropVary: true })), /vary/i);
});
