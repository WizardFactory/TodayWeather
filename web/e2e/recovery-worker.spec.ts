import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import weather from "../src/demo/weather.json" with { type: "json" };

test("placeholder rollback recovers enrolled tabs without deleting user data", async ({
  browser,
}) => {
  let recovering = false;
  const recovery = await readFile("infra/web/static/recovery-worker.js");
  const placeholder =
    "<!doctype html><html><head><title>Recovery</title></head><body><h1>Service preparation</h1></body></html>";
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  const csp = JSON.parse(await readFile("infra/web/static/stack.json", "utf8"))
    .Resources.Headers.Properties.ResponseHeadersPolicyConfig
    .SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, "http://local").pathname;
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Security-Policy", csp);
    if (recovering && path === "/sw.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(recovery);
      return;
    }
    const file = extname(path) ? path : "/index.html";
    if (recovering && file === "/index.html") {
      res.setHeader("Content-Type", "text/html");
      res.end(placeholder);
      return;
    }
    try {
      res.setHeader(
        "Content-Type",
        types[extname(file)] ?? "application/octet-stream",
      );
      res.end(await readFile(join("web/dist", file)));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + (server.address() as any).port;
  const context = await browser.newContext({ locale: "ko-KR" });
  await context.route("https://todayweather.wizardfactory.net/**", (r) =>
    r.fulfill({ json: weather }),
  );
  const page = await context.newPage();
  try {
    await page.goto(origin + "/weather/tokyo/hourly");
    await expect(page.locator(".temperature")).toBeVisible();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const other = await context.newPage();
    await other.goto(origin + "/help");
    await other.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.evaluate(async () => {
      await (
        await caches.open("unrelated-cache")
      ).put("/other", new Response("keep"));
      localStorage.setItem("recovery-preserve", "keep");
    });
    const preferences = await page.evaluate(() =>
      localStorage.getItem("tw.web.v1.preferences"),
    );
    expect(
      preferences,
      "the app must persist real preferences before recovery",
    ).not.toBeNull();
    expect(JSON.parse(preferences!).settings).toBeDefined();
    // Abort origin reads as well as offline emulation to prove the old cached shell serves navigation.
    await context.setOffline(true);
    await page.route(origin + "/**", (r) => r.abort("internetdisconnected"));
    await page.reload();
    await expect(page.locator("#root")).not.toBeEmpty();
    expect(await page.evaluate(() => caches.keys())).toEqual(
      expect.arrayContaining(["unrelated-cache"]),
    );
    await page.unroute(origin + "/**");
    await context.setOffline(false);
    recovering = true;
    // Use the same browser update mechanism used by the app on focus/revisit.
    await page
      .evaluate(() =>
        navigator.serviceWorker.getRegistration().then((r) => r!.update()),
      )
      .catch((e) => {
        // The recovery worker can navigate the page before update() resolves.
        if (!/context.*destroyed|navigation/i.test(String(e))) throw e;
      });
    for (const tab of [page, other]) {
      await expect(
        tab.getByRole("heading", { name: "Service preparation" }),
      ).toBeVisible();
      await expect(tab).toHaveURL(origin + "/");
      await tab.waitForFunction(
        async () =>
          (await navigator.serviceWorker.getRegistrations()).length === 0,
      );
      await tab.reload();
      expect(
        await tab.evaluate(() => !!navigator.serviceWorker.controller),
      ).toBe(false);
    }
    const retained = await page.evaluate(async () => ({
      caches: await caches.keys(),
      other: await (await (
        await caches.open("unrelated-cache")
      ).match("/other"))!.text(),
      marker: localStorage.getItem("recovery-preserve"),
      preferences: localStorage.getItem("tw.web.v1.preferences"),
    }));
    expect(
      retained.caches.filter((key) => key.startsWith("tw-shell-")),
    ).toEqual([]);
    expect(retained.other).toBe("keep");
    expect(retained.marker).toBe("keep");
    expect(retained.preferences).toBe(preferences);
    const fresh = await browser.newContext();
    try {
      const newcomer = await fresh.newPage();
      await newcomer.goto(origin);
      await expect(
        newcomer.getByRole("heading", { name: "Service preparation" }),
      ).toBeVisible();
      expect(
        await newcomer.evaluate(() =>
          navigator.serviceWorker.getRegistrations().then((r) => r.length),
        ),
      ).toBe(0);
    } finally {
      await fresh.close();
    }
  } finally {
    await context.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
