import { it, expect } from "vitest";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { readTransportSettings } from "../src/transport-config";
// @ts-expect-error standalone JavaScript deployment command
import { planUpload } from "../../scripts/deploy-web-static.mjs";
const code = readFileSync("infra/web/static/route-request.js", "utf8");
const handler = runInNewContext(code + "\nhandler;");
it("rewrites known deep links while preserving API, asset, malformed and unknown errors", () => {
  for (const uri of [
    "/",
    "/locations",
    "/weather/p_37.567_126.978/hourly",
    "/settings",
    "/nation/air",
  ])
    expect(handler({ request: { uri, method: "GET" } }).uri).toBe(
      "/index.html",
    );
  for (const uri of ["/api/web/v1/weather", "/unknown"])
    expect(handler({ request: { uri, method: "GET" } }).statusCode).toBe(404);
  for (const uri of ["/assets/missing.js", "/sw.js"])
    expect(handler({ request: { uri, method: "GET" } }).uri).toBe(uri);
  expect(handler({ request: { uri: "/%ZZ", method: "GET" } }).statusCode).toBe(
    400,
  );
  expect(
    handler({ request: { uri: "/settings/../secret", method: "GET" } })
      .statusCode,
  ).toBe(400);
  expect(handler({ request: { uri: "/", method: "POST" } }).statusCode).toBe(
    405,
  );
});
it("provisions an isolated private static origin and deployable function with no error-to-HTML mapping", () => {
  const t = JSON.parse(readFileSync("infra/web/static/stack.json", "utf8"));
  const r = t.Resources;
  expect(r.Navigation.Properties.FunctionCode).toBe(code);
  expect(
    r.Assets.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy,
  ).toBe(true);
  expect(
    r.OriginAccess.Properties.OriginAccessControlConfig.SigningBehavior,
  ).toBe("always");
  expect(t.Parameters?.AppDomainName?.Default).toBe("app.tdywx.xyz");
  expect(r.Distribution.Properties.DistributionConfig.Aliases).toEqual([
    { Ref: "AppDomainName" },
  ]);
  expect(r.DnsA.Properties.Name).toEqual({ Ref: "AppDomainName" });
  expect(r.DnsAAAA.Properties.Name).toEqual({ Ref: "AppDomainName" });
  expect(JSON.stringify({ r, o: t.Outputs })).not.toContain("app.tdywx.xyz");
  expect(r.Cache.Properties.CachePolicyConfig.MinTTL).toBe(0);
  expect(
    r.Distribution.Properties.DistributionConfig.CustomErrorResponses.every(
      (x: any) => !x.ResponsePagePath,
    ),
  ).toBe(true);
  expect(
    r.Headers.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig
      .ContentSecurityPolicy.ContentSecurityPolicy,
  ).toContain("connect-src 'self' https://todayweather.wizardfactory.net");
});
it("rejects ambiguous or unsafe transport build settings", () => {
  expect(readTransportSettings({}).transport).toBe("direct");
  for (const env of [
    { VITE_WEB_TRANSPORT: "typo" },
    { VITE_WEB_MODE: "typo" },
    { VITE_WEATHER_API_ORIGIN: "http://example.com" },
    { VITE_WEATHER_API_ORIGIN: "https://u:p@example.com" },
    { VITE_WEATHER_API_ORIGIN: "https://example.com/api" },
  ])
    expect(() => readTransportSettings(env)).toThrow();
});
const release = {
  schemaVersion: 1,
  siteOrigin: "https://app.tdywx.xyz",
  apiOrigin: "https://todayweather.wizardfactory.net",
  mode: "live",
  transport: "direct",
};
function makeDist(dir: string) {
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, "icons"));
  for (const f of [
    "index.html",
    "manifest.webmanifest",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "assets/app-abc.js",
  ])
    writeFileSync(join(dir, f), "fixture");
  writeFileSync(join(dir, "sw.js"), 'const VERSION="abc";');
  writeFileSync(join(dir, "release.json"), JSON.stringify(release));
}
it("previews uploads without AWS execution, orders assets first, retains old files and rejects demo builds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tw-static-upload-"));
  try {
    makeDist(dir);
    const commands = await planUpload({
      dir,
      bucket: "test-static-bucket",
      distribution: "D123",
    });
    expect(commands[0][3]).toBe("s3://test-static-bucket/assets/app-abc.js");
    expect(commands.at(-2)[3]).toBe("s3://test-static-bucket/sw.js");
    expect(commands.at(-1).slice(0, 2)).toEqual([
      "cloudfront",
      "create-invalidation",
    ]);
    expect(JSON.stringify(commands)).not.toContain("--delete");
    const dry = spawnSync(
      process.execPath,
      [
        "scripts/deploy-web-static.mjs",
        "--dir",
        dir,
        "--bucket",
        "test-static-bucket",
        "--distribution",
        "D123",
      ],
      { encoding: "utf8", env: { ...process.env, AWS_CLI: "/does-not-exist" } },
    );
    expect(dry.status, dry.stderr).toBe(0);
    expect(JSON.parse(dry.stdout).dryRun).toBe(true);
    writeFileSync(
      join(dir, "release.json"),
      JSON.stringify({ ...release, mode: "demo" }),
    );
    await expect(
      planUpload({ dir, bucket: "test-static-bucket", distribution: "D123" }),
    ).rejects.toThrow("live/direct");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("runs CI for root TypeScript configuration changes", () => {
  // Minimal reader for `on.<event>.paths` in flow or block list form.
  const paths: Record<string, string[]> = {};
  let event = "";
  let inPaths = false;
  const unquote = (v: string) => v.trim().replace(/^["']|["']$/g, "");
  for (const line of readFileSync(".github/workflows/web.yml", "utf8").split(
    "\n",
  )) {
    const trigger = line.match(/^ {2}([a-z_]+):/);
    if (trigger) [event, inPaths] = [trigger[1], false];
    const list = line.match(/^ {4}paths:\s*(.*)$/);
    if (list) {
      inPaths = !list[1];
      paths[event] = list[1]
        ? list[1]
            .replace(/^\[|\]$/g, "")
            .split(",")
            .map(unquote)
        : [];
    } else if (inPaths && /^ {6}- /.test(line))
      paths[event].push(unquote(line.slice(8)));
    else if (!/^ {6}/.test(line)) inPaths = false;
  }
  for (const event of ["pull_request", "push"]) {
    expect(paths[event]).toContain("web/**");
    expect(paths[event]).toContain("tsconfig.json");
  }
});
const fakeAws = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const fx = JSON.parse(fs.readFileSync(process.env.FAKE_AWS_FIXTURE, "utf8"));
fs.appendFileSync(process.env.FAKE_AWS_LOG, JSON.stringify(args) + "\\n");
const out = (value) => process.stdout.write(JSON.stringify(value));
const fail = (message) => {
  process.stderr.write(message);
  process.exit(254);
};
const cmd = args.slice(0, 2).join(" ");
if (cmd === "cloudfront get-distribution-config")
  out({ ETag: "E1", DistributionConfig: fx.distributionConfig });
else if (cmd === "cloudfront get-function") {
  const outfile = args.at(-1);
  if (outfile.startsWith("-")) fail("missing outfile");
  fs.writeFileSync(outfile, fx.functionCode);
  out({ ETag: "F1", ContentType: "application/octet-stream" });
} else if (cmd === "cloudfront get-response-headers-policy")
  out({
    ETag: "H1",
    ResponseHeadersPolicy: {
      Id: args[args.indexOf("--id") + 1],
      ResponseHeadersPolicyConfig: fx.headersConfig,
    },
  });
else if (cmd === "s3 cp" || cmd === "cloudfront create-invalidation") out({});
else fail("unexpected command " + cmd);
`;
const functionArn =
  "arn:aws:cloudfront::141248341265:function/tdywx-app-navigation";
const matching = () => ({
  distributionConfig: {
    Aliases: { Quantity: 1, Items: ["app.tdywx.xyz"] },
    Origins: {
      Quantity: 1,
      Items: [
        {
          Id: "static-assets",
          DomainName: "test-static-bucket.s3.ap-northeast-2.amazonaws.com",
          OriginPath: "",
          OriginAccessControlId: "E2OAC",
          S3OriginConfig: { OriginAccessIdentity: "" },
        },
      ],
    },
    DefaultCacheBehavior: {
      TargetOriginId: "static-assets",
      ViewerProtocolPolicy: "redirect-to-https",
      ResponseHeadersPolicyId: "hp-123",
      FunctionAssociations: {
        Quantity: 1,
        Items: [{ FunctionARN: functionArn, EventType: "viewer-request" }],
      },
    } as Record<string, any>,
  },
  // Published code may differ from the repository file only in whitespace.
  functionCode: code.replace(/\n/g, "\r\n  ").replace(/ {2}/g, "\t"),
  headersConfig: {
    SecurityHeadersConfig: {
      ContentSecurityPolicy: {
        Override: true,
        ContentSecurityPolicy:
          "default-src 'self'; connect-src 'self' https://todayweather.wizardfactory.net; object-src 'none'",
      },
    },
  },
});
function runExecute(fixture: ReturnType<typeof matching>) {
  const dir = mkdtempSync(join(tmpdir(), "tw-static-preflight-"));
  try {
    const dist = join(dir, "dist");
    mkdirSync(dist);
    makeDist(dist);
    const cli = join(dir, "aws.cjs");
    writeFileSync(cli, fakeAws, { mode: 0o755 });
    writeFileSync(join(dir, "fixture.json"), JSON.stringify(fixture));
    writeFileSync(join(dir, "log.jsonl"), "");
    const p = spawnSync(
      process.execPath,
      [
        "scripts/deploy-web-static.mjs",
        "--dir",
        dist,
        "--bucket",
        "test-static-bucket",
        "--distribution",
        "D123",
        "--execute",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          AWS_CLI: cli,
          FAKE_AWS_FIXTURE: join(dir, "fixture.json"),
          FAKE_AWS_LOG: join(dir, "log.jsonl"),
        },
      },
    );
    const calls: string[][] = readFileSync(join(dir, "log.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { status: p.status, stderr: p.stderr, stdout: p.stdout, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const uploads = (calls: string[][]) =>
  calls.filter(
    (c) =>
      (c[0] === "s3" && c[1] === "cp") ||
      (c[0] === "cloudfront" && c[1] === "create-invalidation"),
  );
it("verifies the LIVE route function, CSP policy and origin path before uploading", () => {
  const run = runExecute(matching());
  expect(run.status, run.stderr).toBe(0);
  const getFunction = run.calls.find(
    (c) => c[0] === "cloudfront" && c[1] === "get-function",
  );
  expect(getFunction).toBeDefined();
  expect(getFunction).toEqual(
    expect.arrayContaining(["--name", "tdywx-app-navigation"]),
  );
  expect(getFunction![getFunction!.indexOf("--stage") + 1]).toBe("LIVE");
  const policyCall = run.calls.findIndex(
    (c) => c[0] === "cloudfront" && c[1] === "get-response-headers-policy",
  );
  expect(policyCall).toBeGreaterThan(-1);
  expect(run.calls[policyCall]).toEqual(
    expect.arrayContaining(["--id", "hp-123"]),
  );
  const firstUpload = run.calls.findIndex((c) => c[0] === "s3");
  expect(firstUpload).toBeGreaterThan(policyCall);
  expect(uploads(run.calls)).toHaveLength(8);
});
it.each([
  [
    "a missing viewer-request function association",
    (f: ReturnType<typeof matching>) => {
      f.distributionConfig.DefaultCacheBehavior.FunctionAssociations = {
        Quantity: 1,
        Items: [{ FunctionARN: functionArn, EventType: "viewer-response" }],
      };
    },
    /no viewer-request CloudFront Function/,
  ],
  [
    "LIVE function code that differs from route-request.js",
    (f: ReturnType<typeof matching>) => {
      f.functionCode = code.replace('"/index.html"', '"/other.html"');
    },
    /LIVE code does not match infra\/web\/static\/route-request\.js/,
  ],
  [
    "a missing response headers policy",
    (f: ReturnType<typeof matching>) => {
      delete f.distributionConfig.DefaultCacheBehavior.ResponseHeadersPolicyId;
    },
    /no response headers policy/,
  ],
  [
    "a CSP whose connect-src omits the API origin",
    (f: ReturnType<typeof matching>) => {
      f.headersConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy =
        "default-src 'self' https://todayweather.wizardfactory.net; connect-src 'self'";
    },
    /connect-src does not include https:\/\/todayweather\.wizardfactory\.net/,
  ],
  [
    "a non-empty OriginPath",
    (f: ReturnType<typeof matching>) => {
      f.distributionConfig.Origins.Items[0].OriginPath = "/releases";
    },
    /OriginPath/,
  ],
])("stops before any upload for %s", (_name, mutate, message) => {
  const fixture = matching();
  mutate(fixture);
  const run = runExecute(fixture);
  expect(run.status).toBe(1);
  expect(run.stderr).toMatch(message);
  expect(uploads(run.calls)).toEqual([]);
});
