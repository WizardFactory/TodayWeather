/** Explicit static artifact uploader. Defaults to dry-run; never provisions AWS resources. */
import { readFile, readdir } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
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
    release.apiOrigin !== "https://todayweather.wizardfactory.net" ||
    release.siteOrigin !== "https://app.tdywx.xyz"
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
        { dryRun: true, site: "https://app.tdywx.xyz", commands },
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
  const cf = JSON.parse(
    run([
      "cloudfront",
      "get-distribution-config",
      "--id",
      options.distribution,
      "--output",
      "json",
    ]),
  ).DistributionConfig;
  const target = cf.Origins.Items.find(
    (o) => o.Id === cf.DefaultCacheBehavior.TargetOriginId,
  );
  if (
    !cf.Aliases?.Items?.includes("app.tdywx.xyz") ||
    !target?.DomainName?.startsWith(options.bucket + ".s3.") ||
    !target.OriginAccessControlId ||
    cf.DefaultCacheBehavior.ViewerProtocolPolicy !== "redirect-to-https"
  )
    throw Error(
      "Destination does not match the private app.tdywx.xyz static stack",
    );
  for (const command of commands) run(command);
  console.log(
    "Uploaded static release and requested CloudFront invalidation. Verify https://app.tdywx.xyz after invalidation completes.",
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
