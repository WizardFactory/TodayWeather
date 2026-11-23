import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { join } from "node:path";
import {
  AASA, ASSET_LINKS, CSP, LINK_HOST, planUpload, upload,
} from "../deploy-deeplink-static.mjs";

const identity = { teamId: "TESTTEAM00", fingerprint: Array(32).fill("00").join(":") };
const target = { bucket: "fixture-bucket", distribution: "fixture-distribution" };
const route = readFileSync(new URL("../../infra/deeplink/route-request.js", import.meta.url), "utf8");
const files = planUpload(identity);

test("association objects contain only the declared app identities and routes", () => {
  assert.deepEqual(files.map(({ key }) => key), [AASA, ASSET_LINKS]);
  const byKey = new Map(files.map((file) => [file.key, file]));
  for (const key of [AASA, ASSET_LINKS]) {
    assert.equal(byKey.get(key).contentType, "application/json");
    assert.equal(byKey.get(key).cacheControl, "public, max-age=3600");
  }
  const aasa = JSON.parse(byKey.get(AASA).body).applinks.details[0];
  assert.deepEqual(aasa.appIDs, ["TESTTEAM00.net.wizardfactory.todayweather"]);
  assert.deepEqual(aasa.components.map((component) => component["/"]), [
    "/", "/open", "/open/", "/place/*", "/loc", "/loc/", "/air/*",
    "/nation/weather", "/nation/weather/", "/nation/air", "/nation/air/", "/warnings", "/warnings/",
  ]);
  const [android] = JSON.parse(byKey.get(ASSET_LINKS).body);
  assert.deepEqual(android.target, {
    namespace: "android_app", package_name: "net.wizardfactory.todayweather",
    sha256_cert_fingerprints: [identity.fingerprint],
  });
  assert.throws(() => planUpload({ ...identity, teamId: "invalid" }), /APPLE_TEAM_ID/);
  assert.throws(() => planUpload({ ...identity, fingerprint: "invalid" }), /PLAY_APP_SIGNING_SHA256/);
});

function fakeAws(change = () => {}) {
  const origin = {
    Id: "static", DomainName: target.bucket + ".s3.us-east-1.amazonaws.com", OriginAccessControlId: "fixture",
    S3OriginConfig: { OriginAccessIdentity: "" },
  };
  const config = {
    Enabled: true, Aliases: { Items: [LINK_HOST] }, Origins: { Items: [origin] },
    ViewerCertificate: { SSLSupportMethod: "sni-only", MinimumProtocolVersion: "TLSv1.2_2021" },
    DefaultCacheBehavior: {
      TargetOriginId: "static", ViewerProtocolPolicy: "redirect-to-https",
      ResponseHeadersPolicyId: "fixture", CachePolicyId: "fixture",
      AllowedMethods: { Items: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"] },
      FunctionAssociations: { Items: [{ EventType: "viewer-request", FunctionARN: "arn:aws:cloudfront::example:function/route" }] },
    },
  };
  const oac = { SigningBehavior: "always", SigningProtocol: "sigv4", OriginAccessControlOriginType: "s3" };
  const csp = { ContentSecurityPolicy: CSP, Override: true };
  const responses = {
    "get-distribution": { Distribution: { DistributionConfig: config, Status: "Deployed" } },
    "get-origin-access-control": { OriginAccessControl: { OriginAccessControlConfig: oac } },
    "get-response-headers-policy": { ResponseHeadersPolicy: {
      ResponseHeadersPolicyConfig: { SecurityHeadersConfig: { ContentSecurityPolicy: csp } },
    } },
    "get-cache-policy": { CachePolicy: { CachePolicyConfig: {
      MinTTL: 0, MaxTTL: 86400,
      ParametersInCacheKeyAndForwardedToOrigin: { QueryStringsConfig: { QueryStringBehavior: "none" } },
    } } },
    "get-public-access-block": { PublicAccessBlockConfiguration: {
      BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true,
    } },
    "get-bucket-versioning": { Status: "Enabled" },
    "get-bucket-location": { LocationConstraint: null },
    "create-invalidation": { Invalidation: { Id: "fixture-invalidation" } },
  };
  const state = { origin, config, oac, csp, source: route, corruptHead: false, responses };
  change(state);
  const writes = [];
  const uploads = new Map();
  function run(args) {
    const command = args[1];
    const option = (name) => args[args.indexOf(name) + 1];
    switch (command) {
      case "get-function":
        assert.equal(option("--stage"), "LIVE");
        writeFileSync(args.at(-1), state.source);
        return "";
      case "put-object":
        writes.push(command);
        uploads.set(option("--key"), {
          ContentType: option("--content-type"), CacheControl: option("--cache-control"),
          ContentLength: readFileSync(option("--body")).length,
        });
        return "{}";
      case "head-object":
        return JSON.stringify(state.corruptHead ? {} : uploads.get(option("--key")));
      case "create-invalidation":
      case "wait":
        writes.push(command);
        return JSON.stringify(responses[command] ?? {});
      default:
        assert.ok(responses[command], `Unexpected AWS command ${command}`);
        return JSON.stringify(responses[command]);
    }
  }
  return { run, writes, uploads };
}

const failedPreflights = [
  ["wrong alias", ({ config }) => { config.Aliases.Items.push("todayweather.ai"); }, /dedicated/],
  ["wrong bucket", ({ origin }) => { origin.DomainName = "another.s3.example"; }, /selected S3 bucket/],
  ["different bucket with overlapping DNS prefix", ({ origin }) => {
    origin.DomainName = target.bucket + ".s3.other.s3.us-east-1.amazonaws.com";
  }, /selected S3 bucket/],
  ["different region for the selected bucket", ({ origin }) => {
    origin.DomainName = target.bucket + ".s3.eu-west-1.amazonaws.com";
  }, /selected S3 bucket/],
  ["missing OAC", ({ origin }) => { delete origin.OriginAccessControlId; }, /using OAC/],
  ["unsigned OAC", ({ oac }) => { oac.SigningBehavior = "never"; }, /SigV4/],
  ["origin path", ({ origin }) => { origin.OriginPath = "/production"; }, /bucket root/],
  ["error page", ({ config }) => { config.CustomErrorResponses = { Items: [{ ResponseCode: "200" }] }; }, /error-page/],
  ["stale routing", (state) => { state.source = "function handler() {}"; }, /LIVE routing/],
  ["weaker CSP", ({ csp }) => { csp.ContentSecurityPolicy = "default-src *"; }, /CSP differs/],
  ["missing versioning", ({ responses }) => { responses["get-bucket-versioning"] = {}; }, /versioning/],
];

for (const [name, change, error] of failedPreflights) {
  test(`preflight rejects ${name} before making writes`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), "tw-deeplink-test-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const aws = fakeAws(change);
    assert.throws(() => upload(aws.run, target, files, directory), error);
    assert.deepEqual(aws.writes, []);
  });
}

test("upload verifies object metadata and waits for the exact invalidation", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "tw-deeplink-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const aws = fakeAws();
  upload(aws.run, target, files, directory);
  assert.deepEqual([...aws.uploads.keys()], files.map(({ key }) => key));
  assert.deepEqual(aws.writes.slice(-2), ["create-invalidation", "wait"]);
});

test("a metadata mismatch stops the upload before invalidation", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "tw-deeplink-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const aws = fakeAws((state) => { state.corruptHead = true; });
  assert.throws(() => upload(aws.run, target, files, directory), /Unexpected metadata/);
  assert.deepEqual(aws.writes, ["put-object"]);
});
