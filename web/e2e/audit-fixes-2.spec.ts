import { test, expect } from "./fixtures";
import { readFile } from "node:fs/promises";
import fixture from "../../docs/rewrite/examples/client-kma-response.json" with { type: "json" };
import nation from "../src/demo/nation.json" with { type: "json" };
import { PLACES } from "@todayweather/core";
const API = "https://todayweather.wizardfactory.net";
const kma = () => structuredClone(fixture.response) as any;
const base = {
  version: 1,
  places: [] as unknown[],
  selectedId: null as string | null,
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
  },
};
function seed(page: import("@playwright/test").Page, value: unknown) {
  return page.addInitScript((v) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("tw.web.v1.preferences", JSON.stringify(v));
      sessionStorage.setItem("seeded", "1");
    }
  }, value);
}
const active = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    (document.activeElement?.id || document.activeElement?.textContent || "")
      .trim()
      .slice(0, 20),
  );

test.describe("focus management (round 2 N1/N2/N5/N7/N8)", () => {
  test("navigating from the mobile menu focuses the new page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/weather/seoul/hourly");
    await page.getByRole("button", { name: "메뉴 열기" }).click();
    await expect(page.locator(".workspace")).toHaveAttribute("inert", "");
    await page
      .locator(".sidebar")
      .getByRole("link", { name: "관심지역" })
      .click();
    await expect(page).toHaveURL(/\/locations$/);
    await expect.poll(() => active(page)).toBe("main-content");
  });
  test("close button and backdrop return focus to the menu button", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/weather/seoul/hourly");
    const opener = page.getByRole("button", { name: "메뉴 열기" });
    await opener.click();
    await page.locator(".sidebar .mobile-close").click();
    await expect(opener).toBeFocused();
    await opener.click();
    await page
      .locator(".sidebar-backdrop")
      .click({ position: { x: 380, y: 400 } });
    await expect(opener).toBeFocused();
  });
  test("chart tabs focus their chart; sidebar links focus main", async ({
    page,
  }) => {
    await page.goto("/weather/seoul/hourly");
    await page.getByRole("button", { name: "일별", exact: true }).click();
    await expect(page).toHaveURL(/\/daily$/);
    await expect(page.locator(".daily-chart")).toBeFocused();
    await page.locator(".sidebar").getByRole("link", { name: "설정" }).click();
    await expect.poll(() => active(page)).toBe("main-content");
  });
  test("back navigation onto a tab-switch entry focuses the page (round 3 R3-2)", async ({
    page,
  }) => {
    await page.goto("/weather/seoul/hourly");
    await page.getByRole("button", { name: "일별", exact: true }).click();
    await expect(page).toHaveURL(/\/daily$/);
    await page.locator(".sidebar").getByRole("link", { name: "설정" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    // History changes before React commits the new route. Wait for that
    // commit before forcing focus and issuing another navigation.
    await expect(
      page.getByRole("heading", { name: "설정", level: 1 }),
    ).toBeVisible();
    // Focus is applied in an effect after the route commits.
    await expect.poll(() => active(page)).toBe("main-content");
    const link = page.locator(".sidebar").getByRole("link", { name: "설정" });
    await link.focus();
    await expect(link).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(/\/daily$/);
    await expect(page.locator(".daily-chart")).toBeFocused();
  });
  test("widening the window closes an open mobile menu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/weather/seoul/hourly");
    await page.getByRole("button", { name: "메뉴 열기" }).click();
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.locator(".sidebar-backdrop")).toHaveCount(0);
    await expect(page.locator(".workspace")).not.toHaveAttribute("inert", "");
  });
});

test("KMA observations older than 3 hours are flagged; fresh ones are not (N9)", async ({
  page,
}) => {
  await page.route(API + "/weather/**", (r) => r.fulfill({ json: kma() }));
  await page.clock.setFixedTime(new Date("2026-09-23T11:00:00+09:00"));
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  await expect(page.getByText("관측 시각이 오래된 자료입니다")).toHaveCount(0);
  await page.clock.setFixedTime(new Date("2026-09-23T13:30:00+09:00"));
  await page.reload();
  await expect(page.getByText("관측 시각이 오래된 자료입니다")).toBeVisible();
});

test("a rate-limited refresh keeps the snapshot, explains the wait and does not hammer the API (N1)", async ({
  page,
}) => {
  await page.clock.install();
  await page.route(API + "/weather/**", (r) => r.fulfill({ json: kma() }));
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
              r.onsuccess = () => {
                open.result.close();
                resolve(r.result);
              };
            };
          }),
      ),
    )
    .toBeGreaterThan(0);
  await page.unroute(API + "/weather/**");
  let calls = 0;
  await page.route(API + "/weather/**", (r) => {
    calls++;
    return r.fulfill({
      status: 429,
      contentType: "text/plain",
      headers: {
        "Retry-After": "30",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Retry-After",
      },
      body: "slow down",
    });
  });
  await page.reload();
  await expect(page.getByText(/30초/)).toBeVisible();
  await expect(page.locator(".temperature")).toBeVisible();
  // Remounting the view and reconnecting would refetch a stale query.
  const revisit = async (online: boolean) => {
    await page.locator(".sidebar").getByRole("link", { name: "설정" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    // History changes before React necessarily commits the new route. Wait
    // for the weather observer to unmount before testing a remount refetch.
    await expect(page.locator(".temperature")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "설정", exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/weather\/seoul\/hourly$/);
    await expect(page.locator(".temperature")).toBeVisible();
    if (online)
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
  };
  await revisit(true);
  // Two thirds into the wait it is still too early.
  await page.clock.runFor(20000);
  await revisit(true);
  await page.waitForTimeout(500);
  expect(calls, "no request before Retry-After").toBe(1);
  // Once the wait has passed, returning to the view alone refreshes the
  // snapshot (the online handler would refetch regardless of staleTime).
  await page.clock.runFor(11000);
  await expect(async () => {
    await revisit(false);
    expect(calls).toBeGreaterThan(1);
  }).toPass({ timeout: 15000 });
});

test("nation weather shows no unit for missing values (N6)", async ({
  page,
}) => {
  const raw: any = structuredClone(nation);
  raw.weather[0].current.rn1 = null;
  await page.route(API + "/v000903/nation/KR**", (r) =>
    r.fulfill({ json: raw }),
  );
  await page.goto("/nation/weather");
  await page.getByRole("button", { name: "강수", exact: true }).click();
  await expect(page.locator(".region-row b").first()).toHaveText("—");
});

test("the saved theme applies before the body is parsed (F9)", async ({
  page,
}) => {
  await seed(page, { ...base, settings: { ...base.settings, theme: "dark" } });
  // Only head scripts have run when <body> is inserted; the bundle runs later.
  await page.addInitScript(() => {
    const record = () =>
      ((window as any).themeAtBody =
        document.documentElement?.dataset.theme ?? "");
    if (document.body) record();
    else
      new MutationObserver((_, observer) => {
        if (!document.body) return;
        record();
        observer.disconnect();
      }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/help");
  expect(await page.evaluate(() => (window as any).themeAtBody)).toBe("dark");
});

test.describe("backup export and invalid imports (U1)", () => {
  test("export omits the current-location entry and the selection", async ({
    page,
  }) => {
    const here = {
      id: "p_37.5_127",
      name: "현재 위치",
      address: "",
      country: "KR",
      lat: 37.5,
      lon: 127,
      current: true,
    };
    await seed(page, {
      ...base,
      places: [PLACES[0], here],
      selectedId: here.id,
    });
    await page.goto("/settings");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /내보내기/ }).click();
    const file = await (await download).path();
    const saved = JSON.parse(await readFile(file!, "utf8"));
    expect(saved.places.map((p: any) => p.id)).toEqual(["seoul"]);
    expect(saved.selectedId).toBeNull();
  });
  for (const [name, content, message] of [
    ["broken.json", "{not json", "Unexpected"],
    ["old.json", JSON.stringify({ version: 9, places: [] }), "내보내기 파일"],
    ["big.json", "x".repeat(100001), "너무 큽니다"],
  ] as const)
    test(`rejects ${name}`, async ({ page }) => {
      await seed(page, { ...base, places: [PLACES[0]], selectedId: "seoul" });
      await page.goto("/settings");
      await page.locator('input[type="file"]').setInputFiles({
        name,
        mimeType: "application/json",
        buffer: Buffer.from(content),
      });
      await expect(page.locator(".toast")).toBeVisible();
      if (message !== "Unexpected")
        await expect(page.locator(".toast")).toContainText(message);
      const stored = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("tw.web.v1.preferences")!),
      );
      expect(stored.places.map((p: any) => p.id)).toEqual(["seoul"]);
    });
});

test.describe("units and refresh (U2, G17, G18)", () => {
  test("saved non-default units are requested and rendered", async ({
    page,
  }) => {
    await seed(page, {
      ...base,
      settings: {
        ...base.settings,
        units: {
          temperatureUnit: "F",
          windSpeedUnit: "kt",
          pressureUnit: "mmHg",
          distanceUnit: "mi",
          precipitationUnit: "in",
          airUnit: "aqicn",
        },
      },
    });
    await page.route(API + "/weather/**", (r) => {
      const raw = kma();
      raw.units.airUnit = "aqicn";
      return r.fulfill({ json: raw });
    });
    await page.goto("/weather/seoul/hourly");
    await expect(page.locator(".temperature")).toContainText("°F");
    const metrics = page.locator(".metrics-grid");
    await expect(metrics).toContainText("kt");
    await expect(page.locator(".details-panel")).toContainText("mmHg");
    await expect(page.locator(".details-panel")).toContainText("mi");
    await page.getByRole("button", { name: "미세먼지", exact: true }).click();
    await expect(page.locator(".air-detail")).toContainText("중국 기준");
  });
  test("changing a unit in settings converts the shown weather", async ({
    page,
  }) => {
    // Upstream is always asked for default units; the app converts.
    await page.route(API + "/weather/**", (r) => {
      expect(
        new URL(r.request().url()).searchParams.get("temperatureUnit"),
      ).toBe("C");
      return r.fulfill({ json: kma() });
    });
    await page.goto("/weather/seoul/hourly");
    const temperature = page.locator(".temperature");
    await expect(temperature).toContainText("°C");
    const celsius = parseFloat((await temperature.textContent())!);
    await page.locator(".sidebar").getByRole("link", { name: "설정" }).click();
    await page
      .locator("label.setting-row", { hasText: "기온" })
      .locator("select")
      .selectOption("F");
    await page.goBack();
    await expect(temperature).toContainText("°F");
    const fahrenheit = parseFloat((await temperature.textContent())!);
    expect(Math.abs(fahrenheit - (celsius * 9) / 5 - 32)).toBeLessThan(1);
  });
  for (const [minutes, refetch] of [
    [30, true],
    [0, false],
  ] as const)
    test(`refresh interval ${minutes} ${refetch ? "re-requests weather" : "(manual) does not re-request"}`, async ({
      page,
    }) => {
      await seed(page, {
        ...base,
        settings: { ...base.settings, refreshMinutes: minutes },
      });
      let calls = 0;
      await page.clock.install();
      await page.route(API + "/weather/**", (r) => {
        calls++;
        return r.fulfill({ json: kma() });
      });
      await page.goto("/weather/seoul/hourly");
      await expect(page.locator(".temperature")).toBeVisible();
      const before = calls;
      await page.clock.runFor(61 * 60 * 1000);
      if (refetch) await expect.poll(() => calls).toBeGreaterThan(before);
      else {
        await page.waitForTimeout(500);
        expect(calls).toBe(before);
      }
    });
  for (const theme of ["photo", "classic"])
    test(`the ${theme} theme renders`, async ({ page }) => {
      await seed(page, { ...base, settings: { ...base.settings, theme } });
      await page.goto("/weather/seoul/hourly");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".temperature")).toBeVisible();
    });
});

test.describe("install and updates (G19, N11)", () => {
  test("the install card uses a captured install prompt, else opens help", async ({
    page,
  }) => {
    await page.goto("/weather/seoul/hourly");
    await page.getByRole("button", { name: /설치 안내/ }).click();
    await expect(page).toHaveURL(/\/help#install$/);
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true }) as any;
      e.prompt = () => ((window as any).prompted = true);
      window.dispatchEvent(e);
    });
    await page.getByRole("button", { name: /설치 안내/ }).click();
    expect(await page.evaluate(() => (window as any).prompted)).toBe(true);
  });
  test("an open app checks for a new release every hour", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).updateChecks = 0;
      const original = ServiceWorkerRegistration.prototype.update;
      ServiceWorkerRegistration.prototype.update = function () {
        (window as any).updateChecks++;
        return original.call(this);
      };
    });
    await page.clock.install();
    await page.goto("/weather/seoul/hourly");
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const before = await page.evaluate(() => (window as any).updateChecks);
    await page.clock.runFor(61 * 60 * 1000);
    await expect
      .poll(() => page.evaluate(() => (window as any).updateChecks))
      .toBeGreaterThan(before);
  });
});

test("the web manifest names the app and ships both icon sizes (G19)", async () => {
  const manifest = JSON.parse(
    await readFile("web/public/manifest.webmanifest", "utf8"),
  );
  expect(manifest.name).toBeTruthy();
  expect(manifest.start_url).toBe("/");
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.map((i: any) => i.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );
});

test("the browser theme colour follows the chosen theme (round 3, T7)", async ({
  page,
}) => {
  await page.goto("/settings");
  const meta = page.locator('meta[name="theme-color"]');
  await expect(meta).toHaveAttribute("content", "#f4f6fa");
  await page.getByRole("radio", { name: "다크", exact: true }).check();
  await expect(meta).toHaveAttribute("content", "#0f1724");
});

test("weather snapshots stay within 30 entries, dropping the oldest (F7)", async ({
  page,
}) => {
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  const count = () =>
    page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const open = indexedDB.open("tw.web.v1.snapshots", 1);
          open.onsuccess = () => {
            const r = open.result
              .transaction("weather")
              .objectStore("weather")
              .getAllKeys();
            r.onsuccess = () => {
              open.result.close();
              resolve(r.result.map(String));
            };
          };
        }),
    );
  await expect.poll(async () => (await count()).length).toBe(1);
  // Fill the store with 30 valid older entries copied from the saved one.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const open = indexedDB.open("tw.web.v1.snapshots", 1);
        open.onsuccess = () => {
          const tx = open.result.transaction("weather", "readwrite");
          const store = tx.objectStore("weather");
          const read = store.getAll();
          read.onsuccess = () => {
            const value = read.result[0];
            for (let i = 0; i < 30; i++)
              store.put(
                { ...value, savedAt: Date.now() - (i + 1) * 60000 },
                `seed-${i}`,
              );
          };
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
  );
  expect((await count()).length).toBe(31);
  await page.goto("/weather/busan/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  await expect.poll(async () => (await count()).length).toBe(30);
  const keys = await count();
  // Two entries were over the cap: the two oldest seeds went first.
  expect(keys).not.toContain("seed-29");
  expect(keys).not.toContain("seed-28");
  expect(keys).toContain("seed-0");
});
