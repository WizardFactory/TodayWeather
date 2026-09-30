/** Private complete pre-write snapshot. No production write or resource provisioning. */
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { preflight } from "./deploy-web-static.mjs";
const check = (ok, message) => {
  if (!ok) throw Error(message);
};
export function checkHosting(run, distribution) {
  const cf = JSON.parse(
    run(["cloudfront", "get-distribution-config", "--id", distribution]),
  ).DistributionConfig;
  const behavior = cf.DefaultCacheBehavior;
  check(
    !(cf.CustomErrorResponses?.Items ?? []).some(
      (e) => e.ResponseCode === "200" || e.ResponsePagePath,
    ),
    "Remove error-to-HTML/200 fallback before rollout",
  );
  const cache = behavior.CachePolicyId
    ? JSON.parse(
        run(["cloudfront", "get-cache-policy", "--id", behavior.CachePolicyId]),
      ).CachePolicy.CachePolicyConfig
    : behavior;
  check(
    cache.MinTTL === 0 && cache.DefaultTTL === 0 && cache.MaxTTL >= 31536000,
    "Cache TTL policy does not honor upload headers",
  );
  if (behavior.CachePolicyId) {
    const key = cache.ParametersInCacheKeyAndForwardedToOrigin;
    check(
      key.CookiesConfig.CookieBehavior === "none" &&
        key.HeadersConfig.HeaderBehavior === "none" &&
        key.QueryStringsConfig.QueryStringBehavior === "none",
      "Cache policy must not vary by cookie/header/query",
    );
  } else
    check(
      behavior.ForwardedValues?.QueryString === false &&
        behavior.ForwardedValues?.Cookies?.Forward === "none" &&
        !behavior.ForwardedValues?.Headers?.Quantity,
      "Legacy cache policy differs from static policy",
    );
  const cert = cf.ViewerCertificate;
  check(
    cert?.ACMCertificateArn &&
      cert.SslSupportMethod === "sni-only" &&
      /^TLSv1\.[23]_(202[1-9]|20[3-9][0-9])$/.test(cert.MinimumProtocolVersion),
    "Expected modern ACM viewer certificate",
  );
  const details = JSON.parse(
    run([
      "acm",
      "describe-certificate",
      "--region",
      "us-east-1",
      "--certificate-arn",
      cert.ACMCertificateArn,
    ]),
  ).Certificate;
  check(
    details.Status === "ISSUED" &&
      Date.parse(details.NotAfter) > Date.now() &&
      [details.DomainName, ...(details.SubjectAlternativeNames ?? [])].some(
        (n) => n === "app.todayweather.ai" || n === "*.todayweather.ai",
      ),
    "Certificate is not issued/unexpired for the app",
  );
}
export async function snapshot(run, config) {
  const {
    bucket,
    distribution,
    backupBucket,
    snapshotId,
    account,
    preflightReference,
  } = config;
  check(
    /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket ?? "") &&
      /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(backupBucket ?? "") &&
      bucket !== backupBucket &&
      /^[A-Z0-9]+$/.test(distribution ?? ""),
    "Verified separate production and private backup destinations required",
  );
  check(
    /^\d+-\d+$/.test(snapshotId ?? "") &&
      /^\d{12}$/.test(account ?? "") &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(preflightReference ?? ""),
    "Snapshot identity, account and operator DNS/preflight reference required",
  );
  const json = (args) => JSON.parse(run([...args, "--output", "json"]));
  check(
    json(["sts", "get-caller-identity"]).Account === account,
    "AWS account mismatch",
  );
  preflight(run, { bucket, distribution });
  checkHosting(run, distribution);
  check(
    json(["s3api", "get-bucket-versioning", "--bucket", backupBucket])
      .Status === "Enabled",
    "Private backup bucket versioning must be Enabled",
  );
  const block = json([
    "s3api",
    "get-public-access-block",
    "--bucket",
    backupBucket,
  ]).PublicAccessBlockConfiguration;
  check(
    [
      "BlockPublicAcls",
      "IgnorePublicAcls",
      "BlockPublicPolicy",
      "RestrictPublicBuckets",
    ].every((k) => block[k] === true),
    "Backup bucket must block all public access",
  );
  // Explicit service-page handling avoids relying on CLI aggregation or wrappers.
  const listAll = (operation, extra = []) => {
    const versions = operation === "list-object-versions";
    const fields = versions ? ["Versions", "DeleteMarkers"] : ["Contents"];
    const result = Object.fromEntries(fields.map((field) => [field, []]));
    let markers = [];
    const seen = new Set();
    for (;;) {
      const page = json(["s3api", operation, "--bucket", bucket, ...extra,
        "--no-paginate", ...markers]);
      for (const field of fields) result[field].push(...(page[field] ?? []));
      check(fields.reduce((n, field) => n + result[field].length, 0) <= 10000,
        "Oversized paginated inventory; use operator runbook");
      if (!page.IsTruncated) return result;
      const token = versions ? page.NextKeyMarker : page.NextContinuationToken;
      const versionToken = versions ? page.NextVersionIdMarker : undefined;
      const identity = JSON.stringify([token, versionToken]);
      check(typeof token === "string" && token.length > 0 && !seen.has(identity),
        "Incomplete or repeated pagination marker; stop before upload");
      seen.add(identity);
      markers = versions ? ["--key-marker", token,
        ...(versionToken ? ["--version-id-marker", versionToken] : [])]
        : ["--continuation-token", token];
    }
  };
  const prefix = `webapp-rollbacks/${snapshotId}/`;
  check(
    !(
      json([
        "s3api",
        "list-objects-v2",
        "--bucket",
        backupBucket,
        "--prefix",
        prefix,
      ]).Contents ?? []
    ).length,
    "Snapshot prefix already exists; never overwrite rollback",
  );
  const list = () => listAll("list-objects-v2");
  const inventory = list();
  const objects = inventory.Contents ?? [];
  check(
    objects.length > 0 &&
      objects.length <= 10000 &&
      objects.reduce((n, o) => n + o.Size, 0) <= 500000000,
    "Empty or oversized inventory; use operator runbook",
  );
  const distributionBefore = json([
    "cloudfront",
    "get-distribution-config",
    "--id",
    distribution,
  ]);
  const versions = listAll("list-object-versions");
  const versioning = json([
    "s3api",
    "get-bucket-versioning",
    "--bucket",
    bucket,
  ]);
  const tmp = await mkdtemp(join(tmpdir(), "tw-private-snapshot-"));
  try {
    const metadata = {};
    const checksums = {};
    const put = async (file, key) => {
      const bytes = await readFile(file);
      const hash = createHash("sha256").update(bytes).digest("base64");
      run([
        "s3api",
        "put-object",
        "--bucket",
        backupBucket,
        "--key",
        prefix + key,
        "--body",
        file,
        "--if-none-match",
        "*",
        "--checksum-sha256",
        hash,
      ]);
    };
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      const file = join(tmp, String(i)); // Keys never become local paths.
      metadata[o.Key] = json([
        "s3api",
        "head-object",
        "--bucket",
        bucket,
        "--key",
        o.Key,
        "--if-match",
        o.ETag,
      ]);
      run([
        "s3api",
        "get-object",
        "--bucket",
        bucket,
        "--key",
        o.Key,
        "--if-match",
        o.ETag,
        file,
      ]);
      const bytes = await readFile(file);
      check(bytes.length === o.Size, "Backup byte count mismatch");
      checksums[o.Key] = {
        object: `objects/${i}`,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.length,
      };
      await put(file, `objects/${i}`);
    }
    // Repeat inventory AND metadata: same ETag can still have changed headers.
    check(
      JSON.stringify(list().Contents ?? []) === JSON.stringify(objects),
      "Live inventory changed during snapshot; stop and reconcile",
    );
    for (const o of objects)
      check(
        JSON.stringify(
          json([
            "s3api",
            "head-object",
            "--bucket",
            bucket,
            "--key",
            o.Key,
            "--if-match",
            o.ETag,
          ]),
        ) === JSON.stringify(metadata[o.Key]),
        "Live metadata changed during snapshot",
      );
    check(
      json(["cloudfront", "get-distribution-config", "--id", distribution])
        .ETag === distributionBefore.ETag,
      "Distribution changed during snapshot",
    );
    const contents = {
      schemaVersion: 1,
      snapshotId,
      preflightReference,
      createdAt: new Date().toISOString(),
      inventory,
      metadata,
      checksums,
      versions,
      versioning,
      distributionBefore,
    };
    const file = join(tmp, "snapshot.json");
    await writeFile(file, JSON.stringify(contents, null, 2));
    // Completion manifest is written LAST. No manifest means incomplete backup.
    await put(file, "snapshot.json");
    console.log(
      `Private rollback snapshot ${snapshotId} complete (${objects.length} objects)`,
    );
    return contents;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
export async function main() {
  const run = (args) => {
    const result = spawnSync(process.env.AWS_CLI ?? "aws", args, {
      encoding: "utf8",
      env: { ...process.env, AWS_PAGER: "" },
    });
    if (result.error || result.status !== 0)
      throw Error(
        "AWS snapshot/preflight command failed; production upload must stop",
      );
    return result.stdout;
  };
  await snapshot(run, {
    bucket: process.env.WEB_BUCKET,
    distribution: process.env.WEB_DISTRIBUTION,
    backupBucket: process.env.WEB_BACKUP_BUCKET,
    snapshotId: process.env.WEB_SNAPSHOT_ID,
    account: process.env.WEB_AWS_ACCOUNT,
    preflightReference: process.env.WEB_PREFLIGHT_REFERENCE,
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
