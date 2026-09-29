import { it, expect, vi, afterEach } from "vitest";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
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
  expect(t.Parameters?.AppDomainName?.Default).toBe("app.todayweather.ai");
  expect(r.Distribution.Properties.DistributionConfig.Aliases).toEqual([
    { Ref: "AppDomainName" },
  ]);
  expect(r.DnsA.Properties.Name).toEqual({ Ref: "AppDomainName" });
  expect(r.DnsAAAA.Properties.Name).toEqual({ Ref: "AppDomainName" });
  expect(JSON.stringify({ r, o: t.Outputs })).not.toContain(
    "app.todayweather.ai",
  );
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
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const release = {
  schemaVersion: 1,
  commit: COMMIT,
  builtAt: "2026-09-26T00:00:00.000Z",
  siteOrigin: "https://app.todayweather.ai",
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

it("rejects an artifact built for the previous production origin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tw-legacy-origin-"));
  try {
    makeDist(dir);
    writeFileSync(
      join(dir, "release.json"),
      JSON.stringify({
        ...release,
        siteOrigin: "https://app.tdywx.xyz",
      }),
    );
    await expect(
      planUpload({ dir, bucket: "test-static-bucket", distribution: "D123" }),
    ).rejects.toThrow("live/direct app.todayweather.ai");
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
const errorResponse = (code: number) => ({
  ErrorCode: code,
  ResponsePagePath: "",
  ResponseCode: "",
  ErrorCachingMinTTL: 10,
});
const functionArn =
  "arn:aws:cloudfront::141248341265:function/tdywx-app-navigation";
const matching = () => ({
  distributionConfig: {
    Aliases: { Quantity: 1, Items: ["app.todayweather.ai"] },
    Origins: {
      Quantity: 1,
      Items: [
        {
          Id: "static-assets",
          DomainName: "test-static-bucket.s3.ap-northeast-2.amazonaws.com",
          OriginPath: "",
          OriginAccessControlId: "E2OAC" as string | undefined,
          S3OriginConfig: { OriginAccessIdentity: "" },
        },
      ],
    },
    // The CLI reports unset page paths and codes as empty strings.
    CustomErrorResponses: { Quantity: 1, Items: [errorResponse(404)] } as {
      Quantity: number;
      Items: Record<string, unknown>[];
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
  [
    "a distribution without the app.todayweather.ai alias",
    (f: ReturnType<typeof matching>) => {
      f.distributionConfig.Aliases = {
        Quantity: 1,
        Items: ["app.tdywx.xyz"],
      };
    },
    /does not have the app\.todayweather\.ai alias/,
  ],
  [
    "a default behavior that targets another bucket",
    (f: ReturnType<typeof matching>) => {
      f.distributionConfig.Origins.Items[0].DomainName =
        "other-bucket.s3.ap-northeast-2.amazonaws.com";
    },
    /does not target the S3 bucket test-static-bucket/,
  ],
  [
    "an S3 origin without Origin Access Control",
    (f: ReturnType<typeof matching>) => {
      f.distributionConfig.Origins.Items[0].OriginAccessControlId = "";
    },
    /has no Origin Access Control/,
  ],
  [
    "a viewer protocol policy that allows HTTP",
    (f: ReturnType<typeof matching>) => {
      f.distributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy =
        "allow-all";
    },
    /ViewerProtocolPolicy allow-all; redirect-to-https is required/,
  ],
  [
    "a custom error response that serves a page",
    (f: ReturnType<typeof matching>) => {
      f.distributionConfig.CustomErrorResponses = {
        Quantity: 2,
        Items: [
          errorResponse(404),
          {
            ...errorResponse(403),
            ResponsePagePath: "/index.html",
            ResponseCode: "200",
          },
        ],
      };
    },
    /CustomErrorResponses maps 403 to ResponsePagePath \/index\.html/,
  ],
])("stops before any upload for %s", (_name, mutate, message) => {
  const fixture = matching();
  mutate(fixture);
  const run = runExecute(fixture);
  expect(run.status).toBe(1);
  expect(run.stderr).toMatch(message);
  expect(uploads(run.calls)).toEqual([]);
});

it("reports the release commit in dry-run and execute output", () => {
  const dir = mkdtempSync(join(tmpdir(), "tw-static-release-id-"));
  try {
    makeDist(dir);
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
    expect(JSON.parse(dry.stdout).release).toEqual({
      commit: COMMIT,
      builtAt: release.builtAt,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const run = runExecute(matching());
  expect(run.status, run.stderr).toBe(0);
  expect(run.stdout).toContain(COMMIT);
});
afterEach(() => {
  vi.unstubAllEnvs();
});
async function emittedRelease() {
  const { default: config } = await import("../vite.config");
  const resolved = (config as Function)({
    mode: "production",
    command: "build",
  });
  const plugin = resolved.plugins.find(
    (p: { name?: string }) => p?.name === "static-release",
  );
  let source = "";
  plugin.generateBundle.call({
    emitFile: (file: { fileName: string; source: string }) => {
      if (file.fileName === "release.json") source = file.source;
    },
  });
  return JSON.parse(source);
}
it("identifies each built release by commit and build time", async () => {
  vi.stubEnv("GITHUB_SHA", COMMIT);
  vi.stubEnv("SOURCE_DATE_EPOCH", "1790000000");
  const pinned = await emittedRelease();
  expect(pinned).toMatchObject({
    schemaVersion: 1,
    siteOrigin: "https://app.todayweather.ai",
    transport: "direct",
    mode: "live",
    apiOrigin: "https://todayweather.wizardfactory.net",
    commit: COMMIT,
    builtAt: new Date(1790000000 * 1000).toISOString(),
  });
  vi.stubEnv("GITHUB_SHA", "");
  vi.stubEnv("SOURCE_DATE_EPOCH", "");
  const local = await emittedRelease();
  expect(local.commit).toMatch(/^([0-9a-f]{40}(-dirty)?|unknown)$/);
  expect(new Date(local.builtAt).toISOString()).toBe(local.builtAt);
});
/** Minimal reader for `on.<event>.paths` in flow or block list form. */
function workflowPaths(file: string) {
  const paths: Record<string, string[]> = {};
  let event = "";
  let inPaths = false;
  const unquote = (v: string) => v.trim().replace(/^["']|["']$/g, "");
  for (const line of readFileSync(file, "utf8").split("\n")) {
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
  return paths;
}
const globMatch = (glob: string, path: string) =>
  new RegExp(
    "^" +
      glob
        .split("**")
        .map((part) =>
          part
            .split("*")
            .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
            .join("[^/]*"),
        )
        .join(".*") +
      "$",
  ).test(path);
it("runs CI when a file read or imported by the web tests changes", () => {
  const used = new Set<string>();
  for (const dir of ["web/test", "web/e2e"])
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(join(dir, name), "utf8");
      for (const [, rel] of text.matchAll(/["']((?:\.\.\/)+[^"']+)["']/g))
        used.add(relative(".", resolve(dir, rel)));
      for (const [, path] of text.matchAll(
        /["']((?:docs|infra|packages|scripts|\.github\/workflows)\/[^"'*]+\.[a-z]+)["']/g,
      ))
        used.add(path);
    }
  expect([...used]).toContain("docs/rewrite/examples/client-kma-response.json");
  // Workflow files read by the tests must trigger the workflow that runs them.
  expect([...used]).toContain(".github/workflows/web-live-smoke.yml");
  expect([...used]).toContain(".github/workflows/web.yml");
  const paths = workflowPaths(".github/workflows/web.yml");
  for (const event of ["pull_request", "push"]) {
    const uncovered = [...used].filter(
      (file) => !paths[event].some((glob) => globMatch(glob, file)),
    );
    expect(uncovered, event).toEqual([]);
  }
});
it("retains the static artifact and keeps the live smoke off pull requests", () => {
  const web = readFileSync(".github/workflows/web.yml", "utf8");
  const upload = web
    .split(/\n(?= {6}- )/)
    .find((step) => /name: web-static-dist/.test(step));
  expect(upload).toMatch(/retention-days: 90/);
  const file = ".github/workflows/web-live-smoke.yml";
  expect(existsSync(file)).toBe(true);
  const smoke = readFileSync(file, "utf8");
  const on = smoke.slice(
    smoke.indexOf("\non:"),
    smoke.indexOf("\npermissions:"),
  );
  expect(on).toMatch(/\n {2}schedule:/);
  expect(on).toMatch(/\n {2}workflow_dispatch:/);
  expect(on).not.toMatch(/pull_request|\n {2}push:/);
  expect(smoke).toMatch(/permissions:\n {2}contents: read/);
  expect(smoke).toContain("scripts/web-live-smoke.mjs");
  expect(smoke).toContain("--json");
  // Manual post-deploy runs can pin the expected commit; inputs reach the
  // shell through env, never through inline expression interpolation.
  expect(on).toMatch(/\n {6}expect_commit:/);
  expect(smoke).toMatch(/EXPECT_COMMIT: \$\{\{ inputs\.expect_commit \}\}/);
  expect(smoke).toContain('--expect-commit "$EXPECT_COMMIT"');
  const steps = smoke.split(/\n(?= {6}- )/);
  for (const step of steps.filter((s) => /\n {8}run: /.test(s)))
    expect(step.slice(step.indexOf("run: ")), step).not.toContain("${{");
  // The JSON result and failure screenshots are uploaded even when it fails.
  const smokeUpload = steps.find((s) => /name: web-live-smoke\n/.test(s)) ?? "";
  expect(smokeUpload).toMatch(/if: always\(\)/);
  expect(smokeUpload).toContain("test-results/web-live-smoke.json");
  expect(smokeUpload).toContain("test-results/web-live-smoke.json.fail-*.png");
});
it("checks the forecast shape of weather responses in the live smoke", async () => {
  // @ts-expect-error standalone JavaScript smoke command
  const smoke = await import("../../scripts/web-live-smoke.mjs");
  const read = (f: string) =>
    JSON.parse(readFileSync("docs/rewrite/examples/" + f, "utf8")).response;
  const kma = read("client-kma-response.json");
  const dsf = read("client-world-response.json");
  expect(smoke.weatherBodyProblems(kma)).toEqual([]);
  expect(smoke.weatherBodyProblems(dsf)).toEqual([]);
  expect(smoke.weatherBodyProblems({})).not.toEqual([]);
  expect(smoke.weatherBodyProblems(null)).not.toEqual([]);
  const drift = (patch: object) =>
    smoke.weatherBodyProblems({ ...kma, ...patch });
  expect(drift({ short: [], shortest: [] }).join()).toMatch(/short/);
  expect(drift({ short: undefined, shortest: [{}] })).toEqual([]);
  expect(
    drift({ midData: { dailyData: kma.midData.dailyData.slice(0, 2) } }).join(),
  ).toMatch(/dailyData/);
  expect(drift({ midData: undefined }).join()).toMatch(/dailyData/);
  for (const t1h of [null, "", "abc", -999])
    expect(drift({ current: { ...kma.current, t1h } }).join()).toMatch(/t1h/);
  expect(drift({ current: { ...kma.current, t1h: -3.5 } })).toEqual([]);
  expect(smoke.weatherBodyProblems({ ...dsf, hourly: [] }).join()).toMatch(
    /hourly/,
  );
  expect(
    smoke.weatherBodyProblems({ ...dsf, daily: dsf.daily.slice(0, 2) }).join(),
  ).toMatch(/daily/);
  expect(
    smoke.weatherBodyProblems({ ...dsf, thisTime: [dsf.thisTime[0]] }).join(),
  ).toMatch(/thisTime/);
});
it("compares the deployed release commit when the smoke expects one", async () => {
  // @ts-expect-error standalone JavaScript smoke command
  const smoke = await import("../../scripts/web-live-smoke.mjs");
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const other = "f".repeat(40);
  const status = (commit: unknown, expect?: string) =>
    smoke.releaseCommitStatus(commit, expect).status;
  expect(status(sha)).toBe("pass");
  expect(status("unknown")).toBe("pass");
  expect(status(sha, sha)).toBe("pass");
  expect(status(sha, sha.slice(0, 7))).toBe("pass");
  expect(status(sha, other)).toBe("fail");
  expect(status(sha, other.slice(0, 7))).toBe("fail");
  expect(status("unknown", sha)).toBe("fail");
  expect(status(undefined, sha)).toBe("fail");
  expect(status(sha + "-dirty")).toBe("warn");
  expect(status(sha + "-dirty", sha)).toBe("fail");
  expect(status(sha + "-dirty", sha.slice(0, 7))).toBe("fail");
  for (const bad of ["abc", sha.toUpperCase(), sha + "-wip", 42])
    expect(status(bad)).toBe("fail");
  expect(smoke.releaseCommitStatus(sha, other).evidence).toContain(other);
  expect(smoke.parseArgs(["--expect-commit", "ABCDEF1"]).expectCommit).toBe(
    "abcdef1",
  );
  for (const bad of ["abcdef", "xyz1234", sha + "0"])
    expect(() => smoke.parseArgs(["--expect-commit", bad])).toThrow(
      /expect-commit/,
    );
  expect(() => smoke.parseArgs(["--expect-commit"])).toThrow(/Missing value/);
});
it("warns on stale observation and announcement times in the live smoke", async () => {
  // @ts-expect-error standalone JavaScript smoke command
  const smoke = await import("../../scripts/web-live-smoke.mjs");
  const now = Date.parse("2026-09-26T13:00:00+09:00");
  const age = (v: unknown) => smoke.observationAgeHours(v, now);
  expect(age("2026-09-26 12:00")).toBe(1);
  expect(age("2026-09-26T12:00")).toBe(1);
  expect(age("2026.09.26.12:00")).toBe(1);
  expect(age("202609261200")).toBe(1);
  expect(age("2026-09-26T03:00:00.000Z")).toBe(1);
  expect(age("2026-09-25 12:30")).toBe(24.5);
  for (const bad of [null, "", "yesterday", "2026-13-40 99:99", 5])
    expect(age(bad)).toBeNull();
  const fresh = ["2026-09-26 12:00", "2026-09-26 11:00"];
  const any = smoke.freshness(fresh, { now, basis: "any" });
  expect(any.status).toBe("pass");
  expect(any.evidence).toMatchObject({
    parsed: 2,
    newestAgeHours: 1,
    oldestAgeHours: 2,
    olderThanLimit: 0,
  });
  const stale = [...fresh, "2026-09-24 12:00", null];
  expect(smoke.freshness(stale, { now, basis: "any" })).toMatchObject({
    status: "warn",
    evidence: { count: 4, parsed: 3, olderThanLimit: 1, oldestAgeHours: 49 },
  });
  expect(smoke.freshness(stale, { now, basis: "newest" }).status).toBe("pass");
  expect(
    smoke.freshness(["2021-06-16T21:00:00.000Z"], { now, basis: "newest" })
      .status,
  ).toBe("warn");
  expect(smoke.freshness([null, "x"], { now, basis: "any" }).status).toBe(
    "warn",
  );
  expect(smoke.freshness([], { now, basis: "newest" }).status).toBe("pass");
  expect(
    smoke.failureScreenshotPath(
      "out/smoke.json",
      "Seoul daily view renders ≥3 daily rows",
    ),
  ).toBe("out/smoke.json.fail-seoul-daily-view-renders-3-daily-rows.png");
  expect(
    smoke.failureScreenshotPath("s.json", "deep link /weather/seoul/hourly"),
  ).toBe("s.json.fail-deep-link-weather-seoul-hourly.png");
});
it("accepts only the known precipitation labels in the live smoke", async () => {
  expect(existsSync("scripts/web-live-smoke.mjs")).toBe(true);
  // @ts-expect-error standalone JavaScript smoke command
  const smoke = await import("../../scripts/web-live-smoke.mjs");
  expect(
    smoke.unknownRainLabels([
      "강수 —",
      "강수확률 30%",
      "강수확률 —",
      "강수 0.5 mm · 1시간 관측",
      "강수 1 mm · 3시간 관측",
      "강수 0 mm · 지금까지 관측",
      "강수 2 mm · 관측 누적",
      "강수 약 1 mm · 1시간 예보(근사)",
      "강수 4 mm · 3시간 예보",
      "강수 3 mm · 예보",
      "강수량",
      "강수량 · 1시간 관측",
    ]),
  ).toEqual([]);
  expect(
    smoke.unknownRainLabels([
      "강수 1 mm",
      "강수 1 mm · 6시간",
      "강수량 · 3시간",
      "강수 1 mm · 관측",
    ]),
  ).toEqual([
    "강수 1 mm",
    "강수 1 mm · 6시간",
    "강수량 · 3시간",
    "강수 1 mm · 관측",
  ]);
  expect(smoke.dottedKmaTime("관측 시각 2026.09.26.14:00")).toBe(true);
  expect(smoke.dottedKmaTime("관측 시각 2026-09-26 14:00")).toBe(false);
});
