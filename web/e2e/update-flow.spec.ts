import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import weather from "../src/demo/weather.json" with { type: "json" };

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// G3/F11: an open app notices a new deployment on its own, offers the update
// and reloads into the new worker; another open tab is not reloaded and
// drops its now-stale update offer.
test("an open app detects a new release, offers it and reloads into it", async ({
  browser,
}) => {
  const root = await mkdtemp(join(tmpdir(), "tw-update-"));
  const csp = JSON.parse(await readFile("infra/web/static/stack.json", "utf8"))
    .Resources.Headers.Properties.ResponseHeadersPolicyConfig
    .SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
  await cp("web/dist", root, { recursive: true });
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, "http://local").pathname;
    const file =
      path.startsWith("/assets/") || extname(path) ? path : "/index.html";
    try {
      const body = await readFile(
        join(root, file === "/" ? "/index.html" : file),
      );
      res.setHeader(
        "Content-Type",
        types[extname(file)] ?? "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Security-Policy", csp);
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + (server.address() as any).port;
  const context = await browser.newContext();
  await context.route("https://todayweather.wizardfactory.net/**", (r) =>
    r.fulfill({ json: weather }),
  );
  const violations: string[] = [];
  context.on("page", (p) =>
    p.on("console", (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text()))
        violations.push(m.text());
    }),
  );
  const page = await context.newPage();
  try {
    await page.goto(origin + "/weather/tokyo/hourly");
    await expect(page.locator(".temperature")).toBeVisible();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const firstWorker = await page.evaluate(
      async () =>
        (await navigator.serviceWorker.getRegistration())!.active!.scriptURL,
    );
    const other = await context.newPage();
    await other.goto(origin + "/help");
    // A reload request left over from an earlier page load must not count.
    await other.evaluate(() =>
      sessionStorage.setItem("tw.web.v1.update-requested", "1"),
    );
    await other.reload();
    await other.evaluate(() => ((window as any).untouched = true));
    let navigations = 0;
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) navigations++;
    });
    const sw = await readFile(join(root, "sw.js"), "utf8");
    await writeFile(join(root, "sw.js"), sw + "\n// next release\n");
    // The app itself must check for updates when it becomes visible again.
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    const banner = page.getByText("새 버전이 준비됐습니다");
    await expect(banner).toBeVisible({ timeout: 15000 });
    // The other tab sees the same waiting worker.
    await expect(other.getByText("새 버전이 준비됐습니다")).toBeVisible({
      timeout: 15000,
    });
    expect(navigations, "no reload before the user chooses").toBe(0);
    const reloaded = page.waitForEvent("load");
    await page.getByRole("button", { name: "업데이트", exact: true }).click();
    await reloaded;
    await expect(page.locator(".temperature")).toBeVisible();
    await expect(banner).toHaveCount(0);
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration())!.waiting,
      ),
    ).toBeNull();
    expect(firstWorker).toContain("/sw.js");
    // The other tab keeps its state and is told a new version is active.
    await expect(other.getByText("새 버전이 적용됐습니다")).toBeVisible();
    // R3-1: the stale "ready" offer disappears with nothing left to apply.
    await expect(other.getByText("새 버전이 준비됐습니다")).toHaveCount(0);
    expect(await other.evaluate(() => (window as any).untouched)).toBe(true);
    expect(violations).toEqual([]);
  } finally {
    await context.close();
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
