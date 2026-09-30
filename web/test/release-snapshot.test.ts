import { it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
// @ts-expect-error standalone snapshot tool
import { snapshot } from "../../scripts/web-release-snapshot.mjs";
const config = {
  bucket: "test-live-bucket",
  distribution: "D123",
  backupBucket: "test-private-backup",
  snapshotId: "123-1",
  account: "123456789012",
  preflightReference: "inventory-20260930",
};
const object = { Key: "../original.html", Size: 3, ETag: '"abc"' };
const metadata = {
  ContentLength: 3,
  ContentType: "text/html",
  CacheControl: "no-cache",
  Metadata: { source: "placeholder" },
  VersionId: "v1",
};
const cf = {
  ETag: "config1",
  DistributionConfig: {
    Aliases: { Items: ["app.todayweather.ai"] },
    Origins: {
      Items: [
        {
          Id: "s3",
          DomainName: config.bucket + ".s3.ap-northeast-2.amazonaws.com",
          OriginAccessControlId: "oac",
        },
      ],
    },
    ViewerCertificate: {
      ACMCertificateArn: "cert",
      SslSupportMethod: "sni-only",
      MinimumProtocolVersion: "TLSv1.2_2021",
    },
    DefaultCacheBehavior: {
      TargetOriginId: "s3",
      ViewerProtocolPolicy: "redirect-to-https",
      FunctionAssociations: {
        Items: [
          {
            EventType: "viewer-request",
            FunctionARN: "arn:aws:cloudfront::123456789012:function/route",
          },
        ],
      },
      ResponseHeadersPolicyId: "headers",
      CachePolicyId: "cache",
    },
  },
};
function fake(failure = "") {
  const calls: string[][] = [];
  const saved: Record<string, Buffer> = {};
  let lists = 0;
  const run = (args: string[]) => {
    calls.push(args);
    const op = args.slice(0, 2).join(" ");
    const val = (n: string) => args[args.indexOf(n) + 1];
    if (op === failure) throw Error("isolated failure");
    if (op === "sts get-caller-identity")
      return JSON.stringify({ Account: config.account });
    if (op === "cloudfront get-distribution-config") return JSON.stringify(cf);
    if (op === "cloudfront get-function") {
      writeFileSync(
        args.at(-1)!,
        readFileSync("infra/web/static/route-request.js"),
      );
      return "{}";
    }
    if (op === "cloudfront get-response-headers-policy")
      return JSON.stringify({
        ResponseHeadersPolicy: {
          ResponseHeadersPolicyConfig: {
            SecurityHeadersConfig: {
              ContentSecurityPolicy: {
                ContentSecurityPolicy:
                  "connect-src https://todayweather.wizardfactory.net",
              },
            },
          },
        },
      });
    if (op === "cloudfront get-cache-policy")
      return JSON.stringify({
        CachePolicy: {
          CachePolicyConfig: {
            MinTTL: 0,
            DefaultTTL: 0,
            MaxTTL: 31536000,
            ParametersInCacheKeyAndForwardedToOrigin: {
              CookiesConfig: { CookieBehavior: "none" },
              HeadersConfig: { HeaderBehavior: "none" },
              QueryStringsConfig: { QueryStringBehavior: "none" },
            },
          },
        },
      });
    if (op === "acm describe-certificate")
      return JSON.stringify({
        Certificate: {
          Status: "ISSUED",
          NotAfter: "2099-01-01",
          DomainName: "app.todayweather.ai",
        },
      });
    if (op === "s3api get-bucket-versioning") return '{"Status":"Enabled"}';
    if (op === "s3api get-public-access-block")
      return JSON.stringify({
        PublicAccessBlockConfiguration: Object.fromEntries(
          [
            "BlockPublicAcls",
            "IgnorePublicAcls",
            "BlockPublicPolicy",
            "RestrictPublicBuckets",
          ].map((k) => [k, true]),
        ),
      });
    if (op === "s3api list-objects-v2") {
      if (val("--bucket") === config.backupBucket) return "{}";
      lists++;
      return JSON.stringify({
        Contents: [
          failure === "drift" && lists > 1
            ? { ...object, ETag: '"changed"' }
            : object,
        ],
      });
    }
    if (op === "s3api list-object-versions") return '{"Versions":[]}';
    if (op === "s3api head-object") return JSON.stringify(metadata);
    if (op === "s3api get-object") {
      writeFileSync(args.at(-1)!, "old");
      return "{}";
    }
    if (op === "s3api put-object") {
      saved[val("--key")] = readFileSync(val("--body"));
      expect(val("--if-none-match")).toBe("*");
      expect(val("--checksum-sha256")).toMatch(/^[A-Za-z0-9+/]+=*$/);
      return "{}";
    }
    throw Error("Unexpected call: " + op);
  };
  return { run, calls, saved };
}
it("backs up complete original bytes/metadata under safe numbered keys, writing completion last", async () => {
  const f = fake();
  const receipt = await snapshot(f.run, config);
  expect(receipt.metadata[object.Key]).toEqual(metadata);
  expect(receipt.checksums[object.Key].object).toBe("objects/0");
  expect(f.saved["webapp-rollbacks/123-1/objects/0"].toString()).toBe("old");
  const puts = f.calls.filter((a) => a[1] === "put-object");
  expect(puts.at(-1)!.join(" ")).toContain("snapshot.json");
  expect(
    puts.every((a) => a[a.indexOf("--bucket") + 1] === config.backupBucket),
  ).toBe(true);
  expect(
    f.calls.some(
      (a) =>
        a[0] === "s3" ||
        /delete|update-distribution|create-invalidation/.test(a[1]),
    ),
  ).toBe(false);
});
it("does not complete a snapshot on read/write failure or concurrent live drift", async () => {
  for (const failure of ["s3api get-object", "s3api put-object", "drift"]) {
    const f = fake(failure);
    await expect(snapshot(f.run, config)).rejects.toThrow();
    expect(f.saved["webapp-rollbacks/123-1/snapshot.json"]).toBeUndefined();
  }
  for (const patch of [
    { backupBucket: config.bucket },
    { account: "" },
    { preflightReference: "" },
    { snapshotId: "../escape" },
  ]) {
    const f = fake();
    await expect(snapshot(f.run, { ...config, ...patch })).rejects.toThrow();
    expect(f.calls).toEqual([]);
  }
});
