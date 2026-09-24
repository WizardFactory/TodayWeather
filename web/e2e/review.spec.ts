import { test, expect } from "./fixtures";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import rawWeather from "../../web-api/fixtures/weather.json" with { type: "json" };
test("first worker claim preserves an edited notification form", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = navigator.serviceWorker.register.bind(
      navigator.serviceWorker,
    );
    navigator.serviceWorker.register = (...args) =>
      new Promise((resolve, reject) => {
        (window as any).startWorker = () =>
          original(...args).then(resolve, reject);
      });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/notifications/seoul");
  await page.getByRole("button", { name: "일", exact: true }).click();
  await page.evaluate(async () => {
    const claimed = new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => setTimeout(resolve, 0),
        { once: true },
      );
    });
    (window as any).startWorker();
    await claimed;
  });
  await expect(
    page.getByRole("button", { name: "일", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});
test("missing rain hides the period while explicit snow remains visible", async ({
  page,
}) => {
  await page.route(
    "https://todayweather.wizardfactory.net/weather/**",
    async (route) => {
      const data: any = structuredClone(rawWeather);
      for (const key of ["rn1", "r06", "r03", "r1d"])
        delete data.thisTime[1][key];
      data.thisTime[1].sn1 = 2;
      await route.fulfill({ json: data });
    },
  );
  await page.goto("/weather/seoul/hourly");
  const rain = page.locator(".metric").filter({ hasText: "강수량" }).first();
  await expect(rain).not.toContainText("시간");
  await expect(
    page.locator(".metric").filter({ hasText: /적설량|눈 강수량/ }),
  ).toContainText("2 mm");
  await expect(
    page.getByRole("heading", { name: "강수·눈 예보" }),
  ).toBeVisible();
});
test("static favorites delete without notification or capability network calls", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "서울", exact: true }).first().click();
  await expect(page.locator(".temperature")).toBeVisible();
  await page.goto("/locations");
  await page.getByRole("button", { name: "서울 삭제", exact: true }).click();
  await expect(page.locator(".location-card")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".location-card")).toHaveCount(0);
});
test("worker upgrade serves the new shell and retains an old tab chunk", async ({
  browser,
}) => {
  const source = await readFile("web/public/sw.js", "utf8");
  let version = 1;
  const server = createServer((req, res) => {
    const path = new URL(req.url!, "http://fixture").pathname;
    res.setHeader("Cache-Control", "no-store");
    if (path === "/sw.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(
        source
          .replace("__BUILD_VERSION__", "v" + version)
          .replace(
            /\/\*__PRECACHE__\*\/\s*\[[\s\S]*?\]/,
            JSON.stringify([
              "/",
              "/index.html",
              "/icon.svg",
              "/manifest.webmanifest",
              "/assets/v" + version + ".js",
            ]),
          ),
      );
    } else if (path === "/manifest.webmanifest") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ name: "version-" + version }));
    } else if (path === "/icon.svg") {
      res.setHeader("Content-Type", "image/svg+xml");
      res.end(
        '<svg xmlns="http://www.w3.org/2000/svg"><title>icon-' +
          version +
          "</title></svg>",
      );
    } else if (path.startsWith("/assets/")) {
      res.statusCode = path === "/assets/v" + version + ".js" ? 200 : 404;
      res.end("chunk-" + version);
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end("<h1>shell-" + version + "</h1>");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + (server.address() as any).port;
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(origin);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    expect(
      await page.evaluate(() =>
        fetch("/manifest.webmanifest").then((r) => r.json()),
      ),
    ).toEqual({ name: "version-1" });
    version = 2;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration!.update();
    });
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            !!(await navigator.serviceWorker.getRegistration())?.waiting,
        ),
      )
      .toBe(true);
    await page.evaluate(async () => {
      const changed = new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => resolve(),
          { once: true },
        ),
      );
      (await navigator.serviceWorker.getRegistration())!.waiting!.postMessage({
        type: "SKIP_WAITING",
      });
      await changed;
    });
    expect(
      await page.evaluate(() =>
        fetch("/manifest.webmanifest").then((r) => r.json()),
      ),
    ).toEqual({ name: "version-2" });
    expect(
      await page.evaluate(() => fetch("/icon.svg").then((r) => r.text())),
    ).toContain("icon-2");
    expect(
      await page.evaluate(() => fetch("/assets/v1.js").then((r) => r.text())),
    ).toBe("chunk-1");
    await context.setOffline(true);
    await page.goto(origin + "/weather/seoul/hourly");
    await expect(page.getByRole("heading")).toHaveText("shell-2");
  } finally {
    await context.close();
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }
});
