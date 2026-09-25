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
  expect(r.Distribution.Properties.DistributionConfig.Aliases).toEqual([
    "app.tdywx.xyz",
  ]);
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
it("previews uploads without AWS execution, orders assets first, retains old files and rejects demo builds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tw-static-upload-"));
  try {
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
    const release = {
      schemaVersion: 1,
      siteOrigin: "https://app.tdywx.xyz",
      apiOrigin: "https://todayweather.wizardfactory.net",
      mode: "live",
      transport: "direct",
    };
    writeFileSync(join(dir, "release.json"), JSON.stringify(release));
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
