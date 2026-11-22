import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const golden = JSON.parse(read("../../specs/deeplink.golden.json"));
const routeSource = read("../../infra/deeplink/route-request.js");
const handler = runInNewContext(routeSource + "\nhandler");

function request(uri, method = "GET", query = "") {
  const querystring = Object.create(null);
  for (const pair of query ? query.split("&") : []) {
    const [key, ...value] = pair.split("=");
    querystring[key] ??= { value: value.join("=") };
  }
  return handler({ request: { uri, method, querystring } });
}

test("the CloudFront handler follows the golden routing vectors", () => {
  for (const { id, url, edge } of golden.parseCases.filter(({ edge }) => edge)) {
    // URL normalizes dot segments. Keep the raw path for malformed-path cases.
    const [, path, query] = /^https:\/\/[^/?]+([^?]*)(?:\?(.*))?$/i.exec(url);
    const uri = path || "/";
    const result = request(uri, "GET", query);
    const status = result.statusCode ?? 200;
    const actual = status === 302
      ? { action: "redirect", status, location: result.headers.location.value }
      : status === 200
        ? { action: result.uri === uri ? "passthrough" : "rewrite", status, uri: result.uri }
        : { action: "error", status };
    assert.deepEqual(actual, edge, id);
  }
  for (const { method, uri, status } of golden.edgeMethodCases) {
    assert.equal(request(uri, method).statusCode ?? 200, status, `${method} ${uri}`);
  }
});

test("unknown paths and unregistered assets return 404", () => {
  for (const uri of ["//", "/open//", "/assets/missing.png", "/.well-known/other"]) {
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
