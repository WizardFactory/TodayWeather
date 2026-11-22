import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = new URL("../infra/deeplink/", import.meta.url);
const source = readFileSync(new URL("route-request.js", root), "utf8");
const stack = JSON.parse(readFileSync(new URL("stack.json", root), "utf8"));
const securityHeaders = stack.Resources.Headers.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig;
export const CSP = securityHeaders.ContentSecurityPolicy.ContentSecurityPolicy;
export const LINK_HOST = "link.todayweather.ai";
export const AASA = ".well-known/apple-app-site-association";
export const ASSET_LINKS = ".well-known/assetlinks.json";
const BUNDLE_ID = "net.wizardfactory.todayweather";
const ASSOCIATION_CACHE = "public, max-age=3600";

const staticFiles = [
  ["assets/icon.svg", "image/svg+xml"],
  ["assets/preview.png", "image/png"],
  ["assets/open.css", "text/css; charset=utf-8"],
  ["assets/open.js", "text/javascript; charset=utf-8"],
  ["open.html", "text/html; charset=utf-8"],
];

export function associations({ teamId, fingerprint }) {
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? "")) {
    throw Error("APPLE_TEAM_ID must be 10 uppercase alphanumeric characters");
  }
  if (!/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(fingerprint ?? "")) {
    throw Error("PLAY_APP_SIGNING_SHA256 must be an uppercase colon-separated SHA-256 fingerprint");
  }
  const paths = ["/", "/open", "/open/", "/place/*", "/loc", "/loc/", "/air/*",
    "/nation/weather", "/nation/weather/", "/nation/air", "/nation/air/", "/warnings", "/warnings/"];
  const aasa = { applinks: { details: [{
    appIDs: [`${teamId}.${BUNDLE_ID}`],
    components: paths.map((path) => ({ "/": path })),
  }] } };
  const assetLinks = [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: BUNDLE_ID,
      sha256_cert_fingerprints: [fingerprint],
    },
  }];
  return { [AASA]: aasa, [ASSET_LINKS]: assetLinks };
}

export function planUpload(identity) {
  if (stack.Resources.Navigation.Properties.FunctionCode !== source) {
    throw Error("stack.json must embed the exact route-request.js source");
  }
  const files = staticFiles.map(([key, contentType]) => ({
    key, contentType, cacheControl: "no-cache", body: readFileSync(new URL(key, root)),
  }));
  for (const [key, value] of Object.entries(associations(identity))) {
    const body = Buffer.from(JSON.stringify(value, null, 2) + "\n");
    if (key === AASA && body.length > 128 * 1024) throw Error("AASA exceeds 128 KiB");
    files.push({ key, contentType: "application/json", cacheControl: ASSOCIATION_CACHE, body });
  }
  return files;
}

const getJson = (run, args) => JSON.parse(run([...args, "--output", "json"]));
export function preflight(run, { bucket, distribution }, directory) {
  const meta = getJson(run, ["cloudfront", "get-distribution", "--id", distribution]).Distribution;
  const config = meta.DistributionConfig;
  const behavior = config.DefaultCacheBehavior;
  const origin = config.Origins.Items.find(({ Id }) => Id === behavior.TargetOriginId);
  if (meta.Status !== "Deployed" || !config.Enabled ||
      config.Aliases?.Items?.length !== 1 || config.Aliases.Items[0] !== LINK_HOST) {
    throw Error(`Expected a deployed distribution dedicated to ${LINK_HOST}`);
  }
  const { LocationConstraint: location } = getJson(run, ["s3api", "get-bucket-location", "--bucket", bucket]);
  // S3 reports null for us-east-1 and the legacy value EU for eu-west-1.
  const region = location === "EU" ? "eu-west-1" : (location ?? "us-east-1");
  const originDomain = `${bucket}.s3.${region}.amazonaws.com`;
  if (origin?.DomainName !== originDomain ||
      !origin.S3OriginConfig || origin.S3OriginConfig.OriginAccessIdentity ||
      !origin.OriginAccessControlId || origin.OriginPath) {
    throw Error("CloudFront must point to the selected S3 bucket root using OAC");
  }
  const oac = getJson(run, ["cloudfront", "get-origin-access-control", "--id", origin.OriginAccessControlId])
    .OriginAccessControl.OriginAccessControlConfig;
  if (oac.SigningBehavior !== "always" || oac.SigningProtocol !== "sigv4" ||
      oac.OriginAccessControlOriginType !== "s3") throw Error("S3 OAC must always sign with SigV4");
  if (behavior.ViewerProtocolPolicy !== "redirect-to-https" ||
      config.ViewerCertificate?.SSLSupportMethod !== "sni-only" ||
      !/^TLSv1\.[23]_/.test(config.ViewerCertificate?.MinimumProtocolVersion ?? "") ||
      config.CacheBehaviors?.Quantity || config.DefaultRootObject ||
      config.CustomErrorResponses?.Items?.some((entry) => entry.ResponsePagePath || entry.ResponseCode)) {
    throw Error("Distribution TLS, routing or error-page configuration differs from the dedicated stack");
  }
  const expectedMethods = stack.Resources.Distribution.Properties.DistributionConfig.DefaultCacheBehavior.AllowedMethods;
  if (!expectedMethods.every((method) => behavior.AllowedMethods?.Items?.includes(method))) {
    throw Error("CloudFront must pass supported HTTP methods to the viewer-request function");
  }
  const names = behavior.FunctionAssociations?.Items?.filter((entry) => entry.EventType === "viewer-request");
  const functionName = names?.length === 1 && names[0].FunctionARN.match(/:function\/([^/]+)$/)?.[1];
  if (!functionName) throw Error("Missing viewer-request CloudFront Function");
  const functionPath = join(directory, "live.js");
  run(["cloudfront", "get-function", "--name", functionName, "--stage", "LIVE", functionPath]);
  if (readFileSync(functionPath, "utf8") !== source) throw Error("LIVE routing code differs from route-request.js");
  if (!behavior.ResponseHeadersPolicyId) throw Error("Missing CloudFront response headers policy");
  const headers = getJson(run, ["cloudfront", "get-response-headers-policy", "--id", behavior.ResponseHeadersPolicyId])
    .ResponseHeadersPolicy.ResponseHeadersPolicyConfig.SecurityHeadersConfig;
  if (!headers?.ContentSecurityPolicy?.Override ||
      headers.ContentSecurityPolicy.ContentSecurityPolicy !== CSP) {
    throw Error("CloudFront CSP differs from the dedicated stack");
  }
  const cache = getJson(run, ["cloudfront", "get-cache-policy", "--id", behavior.CachePolicyId]).CachePolicy.CachePolicyConfig;
  if (cache.MinTTL !== 0 || cache.MaxTTL < 3600 ||
      cache.ParametersInCacheKeyAndForwardedToOrigin.QueryStringsConfig.QueryStringBehavior !== "none") {
    throw Error("CloudFront cache policy must honor object TTLs without varying by query string");
  }
  const block = getJson(run, ["s3api", "get-public-access-block", "--bucket", bucket]).PublicAccessBlockConfiguration;
  if (!["BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"]
    .every((key) => block?.[key] === true)) throw Error("S3 public access is not fully blocked");
  if (getJson(run, ["s3api", "get-bucket-versioning", "--bucket", bucket]).Status !== "Enabled") {
    throw Error("S3 bucket versioning must be enabled before uploading");
  }
}

export function upload(run, target, files, directory) {
  preflight(run, target, directory);
  for (const [index, file] of files.entries()) {
    const bodyPath = join(directory, `object-${index}`);
    writeFileSync(bodyPath, file.body, { mode: 0o600 });
    const object = ["--bucket", target.bucket, "--key", file.key];
    run(["s3api", "put-object", ...object, "--body", bodyPath, "--server-side-encryption", "AES256",
      "--content-type", file.contentType, "--cache-control", file.cacheControl]);
    const head = getJson(run, ["s3api", "head-object", ...object]);
    if (head.ContentType !== file.contentType || head.CacheControl !== file.cacheControl ||
        head.ContentLength !== file.body.length) {
      throw Error(`Unexpected metadata for ${file.key}`);
    }
  }
  const paths = ["/", "/open", "/open/", ...files.map(({ key }) => "/" + key)];
  const invalidation = getJson(run, ["cloudfront", "create-invalidation", "--distribution-id",
    target.distribution, "--paths", ...paths]);
  run(["cloudfront", "wait", "invalidation-completed", "--distribution-id",
    target.distribution, "--id", invalidation.Invalidation.Id]);
}

function main(argv) {
  const { values } = parseArgs({ args: argv, options: {
    bucket: { type: "string" },
    distribution: { type: "string" },
    profile: { type: "string" },
    execute: { type: "boolean" },
    help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("node scripts/deploy-deeplink-static.mjs [--execute --bucket NAME --distribution ID --profile PROFILE]");
    return;
  }
  const files = planUpload({
    teamId: process.env.APPLE_TEAM_ID,
    fingerprint: process.env.PLAY_APP_SIGNING_SHA256,
  });
  if (!values.execute) {
    console.log(JSON.stringify(files.map(({ key, contentType, cacheControl, body }) => ({
      key, contentType, cacheControl, bytes: body.length,
    })), null, 2));
    return;
  }
  if (!values.bucket || !values.distribution) throw Error("--execute requires --bucket and --distribution");
  const directory = mkdtempSync(join(tmpdir(), "tw-deeplink-"));
  const run = (args) => execFileSync("aws", [
    ...args, "--no-cli-pager", ...(values.profile ? ["--profile", values.profile] : []),
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    upload(run, values, files, directory);
    console.log("Deep-link objects uploaded, verified and invalidated");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    // Omit captured AWS request details and association file contents.
    console.error(error.status === undefined ? error.message : "AWS CLI failed. Check access and the deployment runbook.");
    process.exitCode = 1;
  }
}
