import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A shared link.todayweather.ai link ends on the web app's shell, so messengers read its preview from
// web/index.html. The preview and the icons are the landing page's (todayweather.ai): same words, same share
// image, same app icon. These checks fail when the two drift apart.
const web = readFileSync("web/index.html", "utf8");
const landing = readFileSync("landing/ko/index.html", "utf8");
const meta = (html: string, property: string) =>
  new RegExp(
    `<meta (?:property|name)="${property}" content="([^"]*)"\\s*/?>`,
  ).exec(html)?.[1];
const link = (html: string, rel: string) =>
  new RegExp(`<link rel="${rel}"[^>]*href="([^"]*)"`).exec(html)?.[1];
const bytes = (path: string) => readFileSync(path);
/**
 * The repository file a landing page link names: a production URL is served from landing/root, any other href is
 * relative to the page. Reading the page's own links catches a landing page that switches to another file.
 */
const landingFile = (href: string) =>
  href.startsWith("https://todayweather.ai/")
    ? join("landing/root", href.slice("https://todayweather.ai/".length))
    : join("landing/ko", href);
/** Width and height of a PNG, from its IHDR chunk. */
const size = (path: string) => {
  const png = bytes(path);
  expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
};

describe("link preview and icons", () => {
  it("previews a shared link with the landing page's words", () => {
    for (const property of [
      "og:site_name",
      "og:title",
      "og:description",
      "og:locale",
      "og:image:width",
      "og:image:height",
      "og:image:alt",
      "twitter:card",
    ]) {
      expect(meta(landing, property), property).toBeTruthy();
      expect(meta(web, property), property).toBe(meta(landing, property));
    }
    expect(meta(web, "og:type")).toBe("website");
    // A static og:url would make crawlers treat every shared place as the home page.
    expect(meta(web, "og:url")).toBeUndefined();
  });

  it("previews a shared link with the landing page's share image", () => {
    const landingImage = meta(landing, "og:image")!;
    const name = /\/og\/(ko-[0-9a-f]{8}\.png)$/.exec(landingImage)![1];
    // Served from icons/, the one image directory the app host's edge function lets through.
    expect(meta(web, "og:image")).toBe(
      `https://app.todayweather.ai/icons/share-${name}`,
    );
    const copy = bytes(`web/public/icons/share-${name}`);
    expect(copy.equals(bytes(`landing/root/og/${name}`))).toBe(true);
    // Messengers cache previews by image URL: the name carries the content hash.
    expect(
      createHash("sha256").update(copy).digest("hex").slice(0, 8),
    ).toBe(/ko-([0-9a-f]{8})\.png/.exec(name)![1]);
    expect(size(`web/public/icons/share-${name}`)).toEqual([1200, 630]);
  });

  it("uses the store app icon, as the landing page does", () => {
    // Compared with the files the landing page's own links name (CODEX-3171-1).
    const landingIcon = landingFile(link(landing, "icon")!);
    const landingTouch = landingFile(link(landing, "apple-touch-icon")!);
    expect(link(web, "icon")).toBe("/icons/favicon.png");
    expect(
      bytes("web/public/icons/favicon.png").equals(bytes(landingIcon)),
    ).toBe(true);
    expect(link(web, "apple-touch-icon")).toBe("/icons/apple-touch-icon.png");
    expect(
      bytes("web/public/icons/apple-touch-icon.png").equals(bytes(landingTouch)),
    ).toBe(true);
    // The earlier drawn sun icon is gone from the shell and the build.
    expect(web).not.toContain("icon.svg");
    expect(existsSync("web/public/icon.svg")).toBe(false);
  });

  it("installs with the store app icon, with a padded copy for masked launchers", () => {
    const manifest = JSON.parse(
      readFileSync("web/public/manifest.webmanifest", "utf8"),
    );
    expect(
      manifest.icons.map((icon: { src: string; sizes: string; purpose: string }) => [
        icon.src,
        icon.sizes,
        icon.purpose,
      ]),
    ).toEqual([
      ["/icons/icon-192.png", "192x192", "any"],
      ["/icons/icon-512.png", "512x512", "any"],
      ["/icons/icon-maskable-512.png", "512x512", "maskable"],
    ]);
    expect(size("web/public/icons/icon-192.png")).toEqual([192, 192]);
    expect(size("web/public/icons/icon-512.png")).toEqual([512, 512]);
    expect(size("web/public/icons/icon-maskable-512.png")).toEqual([512, 512]);
    // The shell's page icon and the two `any` install icons are precached for offline use. The touch icon and the
    // maskable icon are read by the system at install time, and the share image only by crawlers: none is precached.
    const precache = readFileSync("scripts/web-precache.mjs", "utf8");
    for (const path of [
      "/icons/favicon.png",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
    ])
      expect(precache).toContain(`"${path}"`);
    expect(precache).not.toContain("icon.svg");
    for (const name of ["share-", "apple-touch-icon", "icon-maskable"])
      expect(precache).not.toContain(name);
  });
});
