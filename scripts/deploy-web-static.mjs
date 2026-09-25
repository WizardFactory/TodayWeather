/** Explicit static artifact uploader. Defaults to dry-run; never provisions AWS resources. */
import { readFile, readdir } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, extname, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
/** Must match web/vite.config.ts release.json and web/src/transport-config.ts defaults. */
export const SITE_DOMAIN = "app.tdywx.xyz";
export const API_ORIGIN = "https://todayweather.wizardfactory.net";
const ROUTE_FUNCTION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../infra/web/static/route-request.js",
);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
export async function planUpload({ dir = "web/dist", bucket, distribution }) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket ?? ""))
    throw new Error("Supply --bucket with the stack BucketName output");
  if (!/^[A-Z0-9]+$/.test(distribution ?? ""))
    throw new Error(
      "Supply --distribution with the stack DistributionId output",
    );
  const release = JSON.parse(await readFile(join(dir, "release.json"), "utf8"));
  if (
    release.schemaVersion !== 1 ||
    release.mode !== "live" ||
    release.transport !== "direct" ||
    release.apiOrigin !== API_ORIGIN ||
    release.siteOrigin !== "https://" + SITE_DOMAIN
  )
    throw new Error(
      "Deployment requires a live/direct app.tdywx.xyz build using the existing API",
    );
  const files = [];
  async function walk(path = "") {
    for (const entry of await readdir(join(dir, path), {
      withFileTypes: true,
    })) {
      const rel = path ? path + "/" + entry.name : entry.name;
      if (entry.isSymbolicLink())
        throw new Error("Symlinks are not deployment artifacts");
      if (entry.isDirectory()) await walk(rel);
      else files.push(rel);
    }
  }
  await walk();
  for (const required of [
    "index.html",
    "sw.js",
    "manifest.webmanifest",
    "icons/icon-192.png",
    "icons/icon-512.png",
  ])
    if (!files.includes(required))
      throw new Error("Missing artifact: " + required);
  const worker = await readFile(join(dir, "sw.js"), "utf8");
  if (
    worker.includes("__BUILD_VERSION__") ||
    worker.includes("/*__PRECACHE__*/")
  )
    throw new Error("Run the complete web build including precache generation");
  for (const file of files)
    if (
      !types[extname(file)] ||
      (!file.startsWith("assets/") &&
        !file.startsWith("icons/") &&
        ![
          "index.html",
          "sw.js",
          "manifest.webmanifest",
          "icon.svg",
          "release.json",
        ].includes(file))
    )
      throw new Error("Unexpected artifact: " + file);
  const priority = (f) =>
    f === "sw.js"
      ? 3
      : f === "index.html"
        ? 2
        : f.startsWith("assets/")
          ? 0
          : 1;
  files.sort((a, b) => priority(a) - priority(b) || a.localeCompare(b));
  return files
    .map((file) => [
      "s3",
      "cp",
      resolve(dir, file),
      `s3://${bucket}/${file}`,
      "--content-type",
      types[extname(file)],
      "--cache-control",
      file.startsWith("assets/")
        ? "public,max-age=31536000,immutable"
        : "no-cache",
      "--only-show-errors",
    ])
    .concat([
      [
        "cloudfront",
        "create-invalidation",
        "--distribution-id",
        distribution,
        "--paths",
        "/*",
      ],
    ]);
}
const normalize = (text) => text.replace(/\s+/g, " ").trim();
/**
 * Read-only destination checks run before any upload command. `run` executes
 * one AWS CLI invocation and returns stdout. Every failure throws.
 */
export function preflight(run, { bucket, distribution }) {
  const cf = JSON.parse(
    run([
      "cloudfront",
      "get-distribution-config",
      "--id",
      distribution,
      "--output",
      "json",
    ]),
  ).DistributionConfig;
  const behavior = cf.DefaultCacheBehavior;
  const target = cf.Origins.Items.find((o) => o.Id === behavior.TargetOriginId);
  if (
    !cf.Aliases?.Items?.includes(SITE_DOMAIN) ||
    !target?.DomainName?.startsWith(bucket + ".s3.") ||
    !target.OriginAccessControlId ||
    behavior.ViewerProtocolPolicy !== "redirect-to-https"
  )
    throw Error(
      `Destination does not match the private ${SITE_DOMAIN} static stack`,
    );
  if (target.OriginPath)
    throw Error(
      `S3 origin ${target.Id} has OriginPath ${JSON.stringify(target.OriginPath)}; the uploader writes to the bucket root and requires an empty OriginPath`,
    );
  const association = behavior.FunctionAssociations?.Items?.find(
    (f) => f.EventType === "viewer-request",
  );
  const functionName =
    association?.FunctionARN?.match(/:function\/([^/]+)$/)?.[1];
  if (!functionName)
    throw Error(
      "Default cache behavior has no viewer-request CloudFront Function association; publish infra/web/static/route-request.js and attach it",
    );
  if (!behavior.ResponseHeadersPolicyId)
    throw Error(
      "Default cache behavior has no response headers policy; attach a policy with the app CSP",
    );
  // get-function streams the code to a required outfile and prints metadata on stdout.
  const tmp = mkdtempSync(join(tmpdir(), "tw-cf-function-"));
  let live;
  try {
    const outfile = join(tmp, "function.js");
    run([
      "cloudfront",
      "get-function",
      "--name",
      functionName,
      "--stage",
      "LIVE",
      "--output",
      "json",
      outfile,
    ]);
    live = readFileSync(outfile, "utf8");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (normalize(live) !== normalize(readFileSync(ROUTE_FUNCTION, "utf8")))
    throw Error(
      `Viewer-request function ${functionName} LIVE code does not match infra/web/static/route-request.js; publish the repository version first`,
    );
  const policy = JSON.parse(
    run([
      "cloudfront",
      "get-response-headers-policy",
      "--id",
      behavior.ResponseHeadersPolicyId,
      "--output",
      "json",
    ]),
  ).ResponseHeadersPolicy?.ResponseHeadersPolicyConfig;
  const csp =
    policy?.SecurityHeadersConfig?.ContentSecurityPolicy
      ?.ContentSecurityPolicy ?? "";
  const connect = csp
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find((d) => d[0].toLowerCase() === "connect-src");
  if (!connect?.slice(1).includes(API_ORIGIN))
    throw Error(
      `Response headers policy ${behavior.ResponseHeadersPolicyId} CSP connect-src does not include ${API_ORIGIN}`,
    );
}
export async function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--execute") options.execute = true;
    else if (["--bucket", "--distribution", "--dir"].includes(key)) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--"))
        throw Error("Missing value: " + key);
      options[key.slice(2)] = argv[++i];
    } else throw Error("Unknown option: " + key);
  }
  const commands = await planUpload(options);
  if (!options.execute) {
    console.log(
      JSON.stringify(
        { dryRun: true, site: "https://" + SITE_DOMAIN, commands },
        null,
        2,
      ),
    );
    return;
  }
  const run = (args) => {
    const p = spawnSync(process.env.AWS_CLI ?? "aws", args, {
      encoding: "utf8",
      env: { ...process.env, AWS_PAGER: "" },
    });
    if (p.error) throw p.error;
    if (p.status !== 0) throw Error(p.stderr || "AWS CLI failed");
    return p.stdout;
  };
  preflight(run, options);
  for (const command of commands) run(command);
  console.log(
    `Uploaded static release and requested CloudFront invalidation. Verify https://${SITE_DOMAIN} after invalidation completes.`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
