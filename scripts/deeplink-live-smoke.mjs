import assert from "node:assert/strict";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { AASA, ASSET_LINKS, CSP, LINK_HOST, associations } from "./deploy-deeplink-static.mjs";

const base = `https://${LINK_HOST}`;
const pwa = "https://app.todayweather.ai";

export async function smoke(identity, fetcher = fetch) {
  const expected = associations(identity);
  async function request(path, status, method = "GET") {
    const result = await fetcher(base + path, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(result.status, status, `${method} ${path}`);
    return result;
  }

  for (const key of [AASA, ASSET_LINKS]) {
    const result = await request("/" + key, 200);
    assert.match(result.headers.get("content-type") ?? "", /^application\/json(?:\s*;|$)/i, key);
    assert.equal(result.headers.get("cache-control"), "public, max-age=3600", key);
    assert.ok(isDeepStrictEqual(await result.json(), expected[key]), `${key} did not match configured identity and routes`);
  }
  for (const path of ["/", "/open", "/open/"]) {
    const result = await request(path, 200);
    assert.equal(result.headers.get("content-security-policy"), CSP, path);
    assert.match(result.headers.get("content-type") ?? "", /^text\/html(?:\s*;|$)/i, path);
    const html = await result.text();
    for (const marker of ["https://app.todayweather.ai/", "https://apps.apple.com/app/id1041700694",
      "https://play.google.com/store/apps/details?id=net.wizardfactory.todayweather",
      "og:title", "og:description", "og:image", "apple-itunes-app"]) {
      assert.ok(html.includes(marker), `${path} is missing ${marker}`);
    }
  }
  const image = await request("/assets/preview.png", 200, "HEAD");
  assert.equal(image.headers.get("content-type"), "image/png");
  const redirects = [
    ["/place/seoul", pwa + "/weather/seoul/hourly?from=link"],
    ["/place/seoul/?view=daily&utm_source=test", pwa + "/weather/seoul/daily?from=link"],
    ["/place/seoul?view=air&pollutant=pm25", pwa + "/air/seoul?pollutant=pm25&from=link"],
    ["/loc?lat=0&lon=0", pwa + "/loc?lat=0&lon=0&from=link"],
    ["/loc?lat=91&lon=0", base + "/open"],
    ["/air/seoul?pollutant=o3", pwa + "/air/seoul?pollutant=o3&from=link"],
    ["/nation/weather", pwa + "/nation/weather?from=link"],
    ["/nation/air", pwa + "/nation/air?from=link"],
    ["/warnings", pwa + "/warnings?from=link"],
  ];
  for (const [path, location] of redirects) {
    const result = await request(path, 302);
    assert.equal(result.headers.get("location"), location, path);
    await result.body?.cancel();
  }
  for (const path of ["/not-a-deep-link", "/mobile/privacy.html", "//", "/assets/missing.png"]) {
    const result = await request(path, 404);
    await result.body?.cancel();
  }
  // No request body. The viewer-request function must stop this before S3.
  const rejected = await request("/open", 405, "OPTIONS");
  assert.equal(rejected.headers.get("allow"), "GET, HEAD");
  await rejected.body?.cancel();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { help: { type: "boolean" } } });
    if (values.help) {
      console.log("APPLE_TEAM_ID and PLAY_APP_SIGNING_SHA256 must be set before running the live smoke");
    } else {
      await smoke({ teamId: process.env.APPLE_TEAM_ID, fingerprint: process.env.PLAY_APP_SIGNING_SHA256 });
      console.log(`${LINK_HOST} HTTP smoke passed`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
