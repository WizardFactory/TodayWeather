/** Android comparison. --emulator seeds only an isolated AVD; physical data is retained. */
import { chromium } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const serial = process.argv[2],
  out = resolve(process.argv[3] ?? "reports/pwa-android-d3");
if (!serial) throw Error("Usage: node pwa-android-d3.mjs <adb-serial> <out>");
const emulator = process.argv.includes("--emulator");
mkdirSync(out, { recursive: true });
const adb =
  process.env.ADB ??
  `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const run = (...args) =>
  execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8" }).trim();
if (
  emulator &&
  (!serial.startsWith("emulator-") ||
    run("shell", "getprop", "ro.kernel.qemu") !== "1")
)
  throw Error("Fixture seeding requires an isolated Android emulator");
const original = run("shell", "settings", "get", "system", "font_scale");
const fixture = JSON.parse(
  readFileSync("docs/rewrite/examples/client-kma-response.json"),
).response;
const preview = spawn(process.execPath, ["scripts/web-static-preview.mjs"], {
  env: { ...process.env, PORT: "4179" },
  stdio: ["ignore", "pipe", "inherit"],
});
const records = [];
let chrome, page, savedStorage;
let snapshotRestore;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function native() {
  const pid = run("shell", "pidof", "net.wizardfactory.todayweather").split(
    " ",
  )[0];
  const sockets = [`@webview_devtools_remote_${pid}`];
  for (const sock of sockets) {
    run("forward", "tcp:9349", `localabstract:${sock.slice(1)}`);
    const targets = await (
      await fetch("http://127.0.0.1:9349/json/list")
    ).json();
    if (!targets.some((p) => p.url.startsWith("https://localhost/"))) continue;
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9349", {
      noDefaults: true,
      timeout: 10000,
    });
    return {
      browser,
      page: browser
        .contexts()[0]
        .pages()
        .find((p) => p.url().startsWith("https://localhost/")),
    };
  }
  throw Error("Existing Cordova debug WebView unavailable");
}
function metrics() {
  const q = (s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const c = getComputedStyle(e);
    return {
      font: c.fontSize,
      lineHeight: c.lineHeight,
      width: e.getBoundingClientRect().width,
    };
  };
  const texts = [...document.querySelectorAll("svg text,.tab-title")]
    .filter((e) => e.getBoundingClientRect().width > 0)
    .map((e) => ({
      class: e.getAttribute("class"),
      font: getComputedStyle(e).fontSize,
      width: e.getBoundingClientRect().width,
    }));
  return {
    viewport: [innerWidth, innerHeight],
    root: q("html"),
    body: q("body"),
    title: q("h1"),
    tab: q(".tab-title"),
    hero: q(".temperature"),
    labels: texts,
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
  };
}
try {
  await new Promise((r, j) => {
    preview.stdout.once("data", r);
    preview.once("exit", j);
  });
  run("reverse", "tcp:4179", "tcp:4179");
  run(
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    "http://127.0.0.1:4179/settings#d3",
    "-p",
    "com.android.chrome",
  );
  await wait(1500);
  run("forward", "tcp:9350", "localabstract:chrome_devtools_remote");
  chrome = await chromium.connectOverCDP("http://127.0.0.1:9350");
  page = chrome
    .contexts()[0]
    .pages()
    .find((p) => p.url().startsWith("http://127.0.0.1:4179/"));
  if (!page) throw Error("D3 Chrome page missing");
  savedStorage = await page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]),
    ),
  );
  if (emulator) {
    // The isolated AVD has external networking disabled. Exercise the real offline
    // snapshot path rather than overriding navigator.onLine or application CSS.
    const { build } = await import("esbuild");
    const bundle = await build({
      entryPoints: ["packages/weather-core/src/index.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
    });
    const { normalizeWeather } = await import(
      `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
    );
    const weather = normalizeWeather(fixture, {
      location: {
        id: "p_37.567_126.978",
        name: "서울",
        lat: 37.567,
        lon: 126.978,
        address: fixture.address,
        country: "KR",
      },
    });
    const key = JSON.stringify([
      weather.location.id,
      37.567,
      126.978,
      ...Object.values(weather.units),
      "ko",
      "v4",
    ]);
    snapshotRestore = await page.evaluate(
      async ({ weather, key }) => {
        const db = await new Promise((resolve, reject) => {
          const r = indexedDB.open("tw.web.v1.snapshots", 1);
          r.onupgradeneeded = () => r.result.createObjectStore("weather");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        const original = await new Promise((resolve) => {
          const r = db.transaction("weather").objectStore("weather").get(key);
          r.onsuccess = () => resolve(r.result ?? null);
        });
        await new Promise((resolve, reject) => {
          const tx = db.transaction("weather", "readwrite");
          tx.objectStore("weather").put({ weather, savedAt: Date.now() }, key);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        db.close();
        return { key, original };
      },
      { weather, key },
    );
  }
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:4179"
      ? route.continue()
      : new URL(route.request().url()).pathname.startsWith("/weather/")
        ? route.fulfill({ json: fixture })
        : route.abort(),
  );
  for (const scale of [1, 1.3]) {
    run("shell", "settings", "put", "system", "font_scale", String(scale));
    run(
      "shell",
      "am",
      "start",
      "-n",
      "net.wizardfactory.todayweather/.MainActivity",
    );
    await wait(1500);
    const app = await native();
    if (emulator) {
      await app.page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.origin === "https://localhost"
          ? route.continue()
          : url.pathname.startsWith("/weather/")
            ? route.fulfill({ json: [{ data: fixture }] })
            : route.abort();
      });
      await app.page.evaluate((fixture) => {
        const i = angular.element(document.body).injector();
        const info = i.get("WeatherInfo");
        const city = i
          .get("WeatherUtil")
          .convertWeatherData([{ data: fixture }]);
        city.currentPosition = false;
        if (!info.addCity(city)) info.updateCity(info.getCityIndex(), city);
        info.setCityIndex(info.getCityCount() - 1);
        document.querySelector(".popup-buttons button")?.click();
        i.get("$state").go("tab.forecast");
      }, fixture);
    }
    await app.page.waitForSelector("[ng-short-chart] svg", { timeout: 20000 });
    await app.page.evaluate(() =>
      document.querySelector(".popup-buttons button")?.click(),
    );
    await app.page.locator("[ng-short-chart]").scrollIntoViewIfNeeded();
    records.push({
      scale,
      surface: "Cordova",
      runtime: emulator ? "Android emulator" : "physical Android",
      ...(await app.page.evaluate(metrics)),
    });
    writeFileSync(
      resolve(out, `cordova-${scale}.png`),
      execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"]),
    );
    await app.browser.close();
    run(
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      "http://127.0.0.1:4179/settings#d3",
      "-p",
      "com.android.chrome",
    );
    if (page.isClosed()) {
      await chrome.close();
      chrome = await chromium.connectOverCDP("http://127.0.0.1:9350");
      page = chrome
        .contexts()[0]
        .pages()
        .find((p) => p.url().startsWith("http://127.0.0.1:4179/"));
      if (!page) page = await chrome.contexts()[0].newPage();
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === "http://127.0.0.1:4179"
          ? route.continue()
          : new URL(route.request().url()).pathname.startsWith("/weather/")
            ? route.fulfill({ json: fixture })
            : route.abort(),
      );
    }
    const session = await page.context().newCDPSession(page);
    await session.send("Network.setBypassServiceWorker", { bypass: true });
    await page.goto("http://127.0.0.1:4179/settings");
    await page.evaluate(
      ({ scale, units }) => {
        localStorage.setItem(
          "tw.web.v1.preferences",
          JSON.stringify({
            version: 1,
            places: [],
            selectedId: null,
            settings: { language: "ko", units, userUnits: Object.keys(units) },
          }),
        );
        localStorage.setItem(
          "tw.web.v1.display",
          JSON.stringify({
            version: 1,
            appearance: "light",
            heroStyle: "sky",
            textScale: scale,
            chartExpanded: false,
            motion: false,
          }),
        );
      },
      { scale, units: fixture.units },
    );
    await page.reload();
    await page
      .getByRole("combobox", { name: "글자 크기", exact: true })
      .selectOption(String(scale));
    await page.goto("http://127.0.0.1:4179/weather/p_37.567_126.978/hourly");
    await page.locator(".temperature").waitFor();
    await page.waitForFunction(
      (scale) =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--tw-text-scale")
          .trim() === String(scale),
      scale,
    );
    await page.evaluate(() => document.fonts.ready);
    // ACTION_VIEW can open a second tab. System screencap must capture the
    // measured page, not the foreground settings tab created by that intent.
    await page.bringToFront();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    records.push({
      scale,
      surface: "PWA browser + D2 setting",
      ...(await page.evaluate(metrics)),
    });
    writeFileSync(
      resolve(out, `pwa-${scale}.png`),
      execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"]),
    );
    await page.locator(".hourly-chart").first().evaluate((el) => {
      window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - 20, behavior: "instant" });
    });
    await page.waitForFunction(() => {
      const top = document.querySelector(".hourly-chart").getBoundingClientRect().top;
      return top >= 0 && top < 40;
    });
    // Android's surface compositor follows the DOM scroll asynchronously.
    await wait(500);
    writeFileSync(
      resolve(out, `pwa-chart-${scale}.png`),
      execFileSync(adb, ["-s", serial, "exec-out", "screencap", "-p"]),
    );
  }
} catch (error) {
  if (emulator && page && !page.isClosed())
    console.error(
      "PWA failure:",
      await page.evaluate(() => ({
        url: location.href,
        text: document.body.innerText.slice(0, 1000),
        online: navigator.onLine,
        scale: getComputedStyle(document.documentElement).getPropertyValue(
          "--tw-text-scale",
        ),
        preferences: localStorage.getItem("tw.web.v1.preferences"),
      })),
    );
  throw error;
} finally {
  if (page?.isClosed()) {
    await chrome?.close();
    chrome = await chromium.connectOverCDP("http://127.0.0.1:9350");
    page = chrome
      .contexts()[0]
      .pages()
      .find((p) => p.url().startsWith("http://127.0.0.1:4179/"));
  }
  if (page && !page.isClosed()) {
    if (snapshotRestore)
      await page.evaluate(async ({ key, original }) => {
        const db = await new Promise((resolve) => {
          const r = indexedDB.open("tw.web.v1.snapshots", 1);
          r.onsuccess = () => resolve(r.result);
        });
        await new Promise((resolve) => {
          const tx = db.transaction("weather", "readwrite");
          const store = tx.objectStore("weather");
          if (original) store.put(original, key);
          else store.delete(key);
          tx.oncomplete = resolve;
        });
        db.close();
      }, snapshotRestore);
    if (savedStorage)
      await page.evaluate((saved) => {
        localStorage.clear();
        for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
      }, savedStorage);
    await page.close();
  }
  await chrome?.close();
  // Changing system scale recreates Chrome's activity. Restore browser state
  // while its page is live, then restore the OS scale after CDP disconnects.
  run("shell", "settings", "put", "system", "font_scale", original);
  run(
    "shell",
    "am",
    "start",
    "-n",
    "net.wizardfactory.todayweather/.MainActivity",
  );
  for (const port of ["tcp:9349", "tcp:9350"]) run("forward", "--remove", port);
  run("reverse", "--remove", "tcp:4179");
  preview.kill();
  writeFileSync(
    resolve(out, "results.json"),
    JSON.stringify(
      {
        runtime: emulator
          ? "AK-authorized Android emulator fallback"
          : "physical Android",
        androidVersion: run("shell", "getprop", "ro.build.version.release"),
        serial,
        originalFontScale: original,
        restoredFontScale: run(
          "shell",
          "settings",
          "get",
          "system",
          "font_scale",
        ),
        records,
        note: "PWA 1.3 uses explicit D2 textScale; system scale also set. Native data retained, local test-origin storage restored, no forced app termination or text-zoom override.",
      },
      null,
      2,
    ) + "\n",
  );
}
