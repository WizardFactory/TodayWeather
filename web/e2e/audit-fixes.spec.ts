import { test, expect } from "./fixtures";
import { readFile, readdir } from "node:fs/promises";
import fixture from "../../docs/rewrite/examples/client-kma-response.json" with { type: "json" };
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
async function snapshotOwners(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open("tw.web.v1.snapshots", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("weather");
        open.onsuccess = () => {
          const req = open.result
            .transaction("weather")
            .objectStore("weather")
            .getAllKeys();
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result.map((k) => JSON.parse(String(k))[0]));
          };
        };
      }),
  );
}

test("closed mobile menu is out of the tab order; open menu takes focus and Escape closes it (F3)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest(".sidebar")),
    ).toBe(false);
  }
  const opener = page.getByRole("button", { name: "메뉴 열기" });
  await opener.click();
  await expect
    .poll(() =>
      page.evaluate(() => !!document.activeElement?.closest(".sidebar")),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".sidebar.open")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("view tabs expose their state and toasts use a persistent live region (F4)", async ({
  page,
}) => {
  await page.goto("/weather/seoul/hourly");
  await expect(
    page.getByRole("button", { name: "시간별", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "일별", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#toast-region[aria-live='polite']")).toHaveCount(
    1,
  );
});

test("the saved dark theme is applied before the app first renders (F9)", async ({
  page,
}) => {
  await seed(page, { ...base, settings: { ...base.settings, theme: "dark" } });
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      const root = document.getElementById("root");
      if (root && root.childElementCount > 0) {
        (window as any).themeAtFirstRender =
          document.documentElement.dataset.theme ?? "";
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/help");
  await expect(page.getByRole("heading", { name: /이용 안내/ })).toBeVisible();
  expect(await page.evaluate(() => (window as any).themeAtFirstRender)).toBe(
    "dark",
  );
});

test("times state their zone: KMA in KST, overseas in local time (F10)", async ({
  page,
}) => {
  await page.route(API + "/weather/**", (r) => r.fulfill({ json: kma() }));
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".data-footer .stamp")).toHaveText(
    "관측 시각 2026-09-23 09:00 KST",
  );
  await page.unroute(API + "/weather/**");
  await page.goto("/weather/tokyo/hourly");
  await expect(page.locator(".data-footer .stamp")).toContainText("현지 시각");
});

test("a stored snapshot shown offline refreshes automatically after reconnecting (F1, G5)", async ({
  page,
  context,
}) => {
  await page.route(API + "/weather/**", (r) => r.fulfill({ json: kma() }));
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect.poll(() => snapshotOwners(page)).toContain("seoul");
  // Route mocks answer even offline; remove them so requests really fail.
  await page.unroute(API + "/weather/**");
  await page.unroute(API + "/**");
  await context.setOffline(true);
  await page.reload();
  const fallback = page.getByText("연결하지 못해 저장된 자료를 표시합니다");
  await expect(fallback).toBeVisible();
  await page.route(API + "/weather/**", (r) => r.fulfill({ json: kma() }));
  await context.setOffline(false);
  // Chromium emulation keeps navigator.onLine true after an offline reload and
  // then skips the "online" event that real browsers fire on reconnect.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(fallback).toHaveCount(0, { timeout: 15000 });
  await expect(page.locator(".temperature")).toBeVisible();
});

test("search submission resolves addresses instead of guessing by substring (F5)", async ({
  page,
}) => {
  await page.goto("/locations");
  await page.getByLabel("지역 검색").fill("중구");
  await page.getByLabel("지역 검색").press("Enter");
  await expect(page).toHaveURL(/\/weather\/p_37\.567_126\.978\/hourly$/);
});

test("importing a backup deletes stored weather of places it removes (F6)", async ({
  page,
}) => {
  await page.route(API + "/weather/**", (r) => r.fulfill({ json: kma() }));
  await page.goto("/locations");
  for (const name of ["서울", "부산"]) {
    await page
      .locator(".city-chips")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(page.locator(".temperature")).toBeVisible();
    await page.goto("/locations");
  }
  await expect
    .poll(() => snapshotOwners(page))
    .toEqual(expect.arrayContaining(["seoul", "busan"]));
  await page.goto("/settings");
  await page.locator('input[type="file"]').setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...base, places: [PLACES[1]] })),
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "확인", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText("가져왔습니다");
  await expect.poll(() => snapshotOwners(page)).not.toContain("seoul");
  expect(await snapshotOwners(page)).toContain("busan");
});

test("a cancelled import keeps favorites and says so (G6)", async ({
  page,
}) => {
  await seed(page, { ...base, places: [PLACES[0]], selectedId: "seoul" });
  await page.goto("/settings");
  await page.locator('input[type="file"]').setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...base, places: [PLACES[1]] })),
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "취소", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText("가져오기를 취소했습니다");
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tw.web.v1.preferences")!),
  );
  expect(saved.places.map((p: any) => p.id)).toEqual(["seoul"]);
});

test("an air link can preselect a pollutant; help explains units", async ({
  page,
}) => {
  await page.goto("/air/seoul?pollutant=pm25");
  await expect(
    page.getByRole("heading", { name: "초미세먼지 시간별 변화" }),
  ).toBeVisible();
  await page.goto("/help");
  await expect(page.locator("#units")).toContainText("단위");
});

test("the live build does not ship demo fixtures (F12)", async () => {
  const files = await readdir("web/dist/assets");
  for (const file of files.filter((f) => f.endsWith(".js")))
    expect(
      (await readFile("web/dist/assets/" + file, "utf8")).includes(
        "화면 테스트",
      ),
      file,
    ).toBe(false);
});

test("an overseas 501 text response shows Korean guidance without retrying (G2)", async ({
  page,
}) => {
  let calls = 0;
  await page.route(API + "/weather/**", (r) => {
    calls++;
    return r.fulfill({
      status: 501,
      contentType: "text/plain",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: "Not Implemented",
    });
  });
  await page.goto("/weather/tokyo/hourly");
  await expect(page.getByRole("alert")).toContainText(
    "서버 응답을 확인할 수 없습니다",
  );
  await expect(page.getByRole("alert")).not.toContainText("Not Implemented");
  expect(calls).toBe(1);
});

test("sharing uses public city links only and the link opens the place (G7)", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    delete (navigator as any).share;
  });
  await page.goto("/weather/seoul/hourly");
  await page.getByRole("button", { name: "지역 공유" }).click();
  await expect(page.locator(".toast")).toContainText("링크를 복사했습니다");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /\/place\/seoul$/,
  );
  await page.goto("/place/seoul");
  await expect(
    page.getByRole("heading", { name: "서울의 날씨" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /이 지역 날씨 보기/ }).click();
  await expect(page).toHaveURL(/\/weather\/seoul\/hourly$/);
  await page.goto("/weather/p_33.1_125.1/hourly");
  await page.getByRole("button", { name: "지역 공유" }).click();
  await expect(page.locator(".toast")).toContainText("추천 도시");
});

test("unavailable browser storage is explained and weather still loads (G8)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    Object.defineProperty(window, "indexedDB", { value: undefined });
  });
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  await expect(
    page.getByText("브라우저 저장소를 사용할 수 없어"),
  ).toBeVisible();
});

test("nation wind shows direction; warnings handle empty and failed loads (G10)", async ({
  page,
}) => {
  await page.goto("/nation/weather");
  await page.getByRole("button", { name: "바람", exact: true }).click();
  await expect(page.locator(".region-row b").first()).toContainText("m/s");
  await expect(page.locator(".region-row b").first()).not.toHaveText(/^\d/);
  await page.goto("/nation/air");
  await page.getByRole("button", { name: /오존/ }).click();
  await expect(page.locator(".region-row").first()).toContainText("ppm");
  let fail = true;
  await page.route(API + "/v000903/kma/special", (r) =>
    fail
      ? r.fulfill({ status: 500, contentType: "text/plain", body: "x" })
      : r.fulfill({ json: [] }),
  );
  await page.goto("/warnings");
  await expect(page.getByRole("alert")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.getByText("제공된 특보가 없습니다")).toBeVisible();
});
