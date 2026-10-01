import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Browser language and the language setting (seven UI languages).
const API = "https://todayweather.wizardfactory.net";

test.describe("browser language", () => {
  test.use({ locale: "ja-JP" });
  test("a Japanese browser gets the Japanese UI and localized city names", async ({
    page,
  }) => {
    await page.goto("/weather/seoul/hourly");
    await expect(page.locator(".temperature")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/ソウル/);
    await expect(
      page.getByRole("button", { name: "時間別", exact: true }),
    ).toBeVisible();
  });
});

test.describe("regional variant", () => {
  test.use({ locale: "pt-BR" });
  test("pt-BR selects Portuguese", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt");
    await expect(
      page.getByRole("heading", { name: "Configurações", level: 1 }),
    ).toBeVisible();
  });
});

test.describe("unsupported browser language", () => {
  test.use({ locale: "zh-CN" });
  test("falls back to English", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 }),
    ).toBeVisible();
  });
});

test("the language setting switches, persists and is sent to the API", async ({
  page,
}) => {
  const languages: string[] = [];
  page.on("request", (r) => {
    if (r.url().startsWith(API + "/weather/"))
      languages.push(r.headers()["accept-language"] ?? "");
  });
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  expect(languages.at(-1)).toBe("ko");
  await page.goto("/settings");
  await page
    .getByRole("combobox", { name: "언어", exact: true })
    .selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  await page.goto("/weather/seoul/hourly");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Seoul/);
  await expect.poll(() => languages.at(-1)).toBe("en");
});

test("search matches localized, Korean and id city names", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem(
        "tw.web.v1.preferences",
        JSON.stringify({
          version: 1,
          places: [],
          selectedId: null,
          settings: {
            units: {
              temperatureUnit: "C",
              windSpeedUnit: "m/s",
              pressureUnit: "hPa",
              distanceUnit: "km",
              precipitationUnit: "mm",
              airUnit: "airkorea",
            },
            theme: "light",
            startup: "hourly",
            refreshMinutes: 30,
            language: "es",
          },
        }),
      );
      sessionStorage.setItem("seeded", "1");
    }
  });
  for (const term of ["Seúl", "서울", "seoul"]) {
    await page.goto("/locations");
    await page.locator(".search-field input").fill(term);
    await page.locator(".search-field input").press("Enter");
    await expect(page).toHaveURL(/\/weather\/seoul\//);
  }
});

test.describe("offline in another language", () => {
  test.use({ locale: "en-US" });
  test("the cached shell starts in English", async ({ page, context }) => {
    await page.goto("/weather/seoul/hourly");
    await expect(page.locator(".temperature")).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 }),
    ).toBeVisible();
    await context.setOffline(false);
  });
});

for (const locale of ["de-DE", "fr-FR", "es-ES", "pt-BR"])
  test.describe(`${locale} on a 320 px phone`, () => {
    test.use({ locale, viewport: { width: 320, height: 694 }, hasTouch: true });
    test("long translations fit", async ({ page }) => {
      await expect(async () => {
        await page.goto("/weather/seoul/hourly");
        await expect(page.locator(".temperature")).toBeVisible();
      }).toPass();
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        locale.slice(0, 2),
      );
      const tops = await page
        .locator(".weather-page-head .icon-button")
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
      expect(new Set(tops).size).toBe(1);
      for (const path of [
        "/weather/seoul/hourly",
        "/nation/air",
        "/settings",
        "/locations",
      ]) {
        await page.goto(path);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
          path,
        ).toBeLessThanOrEqual(320);
        // Every tab stays on screen (tabs wrap instead of scrolling away).
        const rights = await page
          .locator(".view-tabs button")
          .evaluateAll((els) =>
            els.map((e) => e.getBoundingClientRect().right),
          );
        expect(Math.max(0, ...rights), path).toBeLessThanOrEqual(320);
      }
    });
  });

test.describe("secondary browser languages", () => {
  test.use({ locale: "de-DE" });
  test("an en-US fallback language does not make the user American (independent verification HIGH-1)", async ({
    page,
  }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "languages", {
        get: () => ["de", "en-US", "en"],
      }),
    );
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    // No German country: the international standard (m/s, °C).
    await expect(
      page.getByRole("combobox", { name: "Windgeschwindigkeit" }),
    ).toHaveValue("m/s");
    await expect(
      page.getByRole("combobox", { name: "Temperatur" }),
    ).toHaveValue("C");
  });
});

test("switching language offline keeps the stored weather (independent verification LOW-1)", async ({
  page,
  context,
}) => {
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const open = indexedDB.open("tw.web.v1.snapshots", 1);
            open.onsuccess = () => {
              const r = open.result
                .transaction("weather")
                .objectStore("weather")
                .count();
              r.onsuccess = () => resolve(r.result);
            };
          }),
      ),
    )
    .toBeGreaterThan(0);
  // English is precached by the service worker before going offline.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.unroute("https://todayweather.wizardfactory.net/**");
  await context.setOffline(true);
  await page.goto("/settings");
  await page
    .getByRole("combobox", { name: "언어", exact: true })
    .selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  await context.setOffline(false);
});

test.describe("language choices while a language loads (PR #2616 review)", () => {
  // Routes must see the chunk requests, not the service worker cache.
  test.use({ serviceWorkers: "block" });
  const delayed = (page: Page, name: string, ms: number) =>
    page.route(new RegExp(`/assets/${name}-[\\w-]+\\.js$`), async (r) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      await r.continue();
    });
  const select = (page: Page) =>
    page.locator("select", { has: page.locator('option[value="ja"]') });

  test("returning to the current language cancels the pending load", async ({
    page,
  }) => {
    await delayed(page, "en", 1500);
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "설정", level: 1 }),
    ).toBeVisible();
    await select(page).selectOption("en");
    await select(page).selectOption("ko");
    await page.waitForTimeout(2500);
    await expect(
      page.getByRole("heading", { name: "설정", level: 1 }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await expect(select(page)).toHaveValue("ko");
  });

  test("an earlier choice that finishes later does not win", async ({
    page,
  }) => {
    await delayed(page, "de", 1500);
    await page.goto("/settings");
    await expect(
      page.getByRole("heading", { name: "설정", level: 1 }),
    ).toBeVisible();
    await select(page).selectOption("de");
    await select(page).selectOption("ja");
    await expect(
      page.getByRole("heading", { name: "設定", level: 1 }),
    ).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(
      page.getByRole("heading", { name: "設定", level: 1 }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  });
});

test.describe("device formats with another UI language (#2613)", () => {
  test.use({ locale: "en-US" });
  test("an en-US device keeps US dates and the 12-hour clock in French", async ({
    page,
  }) => {
    await page.goto("/settings");
    await page
      .getByRole("combobox", { name: "Language", exact: true })
      .selectOption("fr");
    await expect(
      page.getByRole("heading", { name: "Réglages", level: 1 }),
    ).toBeVisible();
    await page.goto("/weather/seoul/hourly");
    await expect(page.locator(".temperature")).toBeVisible();
    // French words, US conventions: "12:00 PM", not "12:00".
    const labels = await page
      .locator(".hourly-columns .chart-hour")
      .allTextContents();
    expect(labels.join(" ")).toMatch(/\d{1,2}:\d{2}\s?[AP]M/);
  });
});
