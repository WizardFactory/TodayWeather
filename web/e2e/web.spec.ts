import { test, expect } from "./fixtures";
const screenshots =
  process.env.WEB_SCREENSHOTS ??
  "reports/sdlc/webapp-implementation/screenshots";
async function seoul(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "서울", exact: true }).first().click();
  await expect(page.locator(".temperature")).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}
test("weather, air, national views, warnings and settings persist at desktop size", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seoul(page);
  await expect(page.getByText("예제 데이터", { exact: false })).toHaveCount(0);
  await page.screenshot({
    path: screenshots + "/desktop-weather.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "일별", exact: true }).click();
  await expect(page.locator(".daily-row").first()).toBeVisible();
  await page.getByRole("button", { name: "미세먼지", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "대기질 관측" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /초미세먼지/ }).click();
  await expect(
    page.getByRole("heading", { name: "초미세먼지 시간별 변화" }),
  ).toBeVisible();
  await page.goto("/nation/weather");
  await expect(page.locator(".region-row").first()).toBeVisible();
  await page.getByRole("button", { name: "강수", exact: true }).click();
  await expect(page.locator(".region-row b").first()).toContainText("mm");
  await page.goto("/nation/air");
  await expect(page.locator(".region-row").first()).toBeVisible();
  await page.getByRole("button", { name: "오존", exact: true }).click();
  await page.goto("/warnings");
  await expect(page.locator(".bulletin").first()).toBeVisible();
  await page.goto("/settings");
  await page
    .getByRole("combobox", { name: "기온", exact: true })
    .selectOption("F");
  await page
    .getByRole("combobox", { name: "화면 테마", exact: true })
    .selectOption("dark");
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "기온", exact: true }),
  ).toHaveValue("F");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/");
  await expect(page.locator(".temperature")).toContainText("F");
  await page.screenshot({
    path: screenshots + "/desktop-dark.png",
    fullPage: true,
  });
  expect((await request.get("/api/web/v1/missing")).status()).toBe(404);
  expect((await request.get("/assets/missing.js")).status()).toBe(404);
  expect((await request.get("/weather/p_37.567_126.978/hourly")).status()).toBe(
    200,
  );
  expect(errors).toEqual([]);
});
test("mobile favorites, geolocation denial and unavailable notifications stay usable", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seoul(page);
  await page.screenshot({
    path: screenshots + "/mobile-weather.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/locations");
  await page.getByRole("button", { name: "부산", exact: true }).first().click();
  await expect(
    page.getByRole("heading", { name: "부산", exact: true }),
  ).toBeVisible();
  await page.goto("/locations");
  await expect(page.locator(".location-card")).toHaveCount(2);
  await page.getByRole("button", { name: "서울 삭제", exact: true }).click();
  await expect(page.locator(".location-card")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".location-card")).toHaveCount(1);
  await context.setGeolocation({ latitude: 37.567, longitude: 126.978 });
  await page.getByRole("button", { name: "현재 위치", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("권한");
  await page.getByRole("link", { name: "부산 알림 설정" }).click();
  await expect(
    page.getByRole("heading", { name: "웹 알림을 아직 사용할 수 없습니다" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "설정 저장" })).toBeDisabled();
  await page.screenshot({
    path: screenshots + "/mobile-notifications.png",
    fullPage: true,
  });
});
test("offline shell uses matching snapshot and never labels it fresh", async ({
  page,
  context,
}) => {
  await seoul(page);
  await page.waitForTimeout(300);
  await page.unroute("https://todayweather.wizardfactory.net/**");
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".temperature")).toBeVisible();
  await expect(
    page.getByText("저장된 자료", { exact: false }).first(),
  ).toBeVisible();
  await page.screenshot({ path: screenshots + "/offline.png", fullPage: true });
  await context.setOffline(false);
});

test("coordinate deep links survive empty storage and unsaved alarm edits block navigation", async ({
  page,
}) => {
  await page.goto("/weather/p_37.567_126.978/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  await page.goto("/notifications/seoul");
  await expect(page.getByRole("heading", { name: "서울 알림" })).toBeVisible();
  await page.getByRole("button", { name: "일", exact: true }).click();
  let dialogs = 0;
  page.on("dialog", () => dialogs++);
  const cancel = page.waitForEvent("dialog").then((dialog) => dialog.dismiss());
  await Promise.all([
    cancel,
    page.getByRole("link", { name: "설정", exact: true }).last().click(),
  ]);
  await expect(page).toHaveURL(/\/notifications\/seoul$/);
  const accept = page.waitForEvent("dialog").then((dialog) => dialog.accept());
  await Promise.all([
    accept,
    page.getByRole("link", { name: "설정", exact: true }).last().click(),
  ]);
  await expect(page).toHaveURL(/\/settings$/);
  expect(dialogs).toBe(2);
});

test("immediate search submission selects the submitted city", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const field = page.getByRole("textbox", { name: "지역 검색" });
  await field.fill("부산");
  await field.press("Enter");
  await expect(
    page.getByRole("heading", { name: "부산", exact: true }),
  ).toBeVisible();
});
test("late geolocation preserves newly added favorites and settings", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (success) => {
      (window as any).completeLocation = () =>
        success({
          coords: { latitude: 37.567, longitude: 126.978 },
        } as GeolocationPosition);
    };
  });
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.getByRole("button", { name: "현재 위치", exact: true }).click();
  await page.getByRole("button", { name: "부산", exact: true }).first().click();
  await expect(page.locator(".temperature")).toBeVisible();
  await page.getByRole("link", { name: "설정", exact: true }).last().click();
  await page
    .getByRole("combobox", { name: "기온", exact: true })
    .selectOption("F");
  await page.evaluate(() => (window as any).completeLocation());
  await expect(
    page.getByRole("heading", { name: "서울", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(200);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tw.web.v1.preferences")!),
  );
  expect(saved.places.map((p: any) => p.id)).toContain("busan");
  expect(saved.settings.units.temperatureUnit).toBe("F");
});

for (const corruption of ["missing timestamp", "invalid hourly array"]) {
  test(`corrupt offline snapshot recovers safely: ${corruption}`, async ({
    page,
    context,
  }) => {
    await seoul(page);
    await page.waitForTimeout(200);
    await page.evaluate(async (kind) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("tw.web.v1.snapshots", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction("weather", "readwrite"),
            store = tx.objectStore("weather"),
            keys = store.getAllKeys();
          keys.onsuccess = () => {
            const key = keys.result[0],
              read = store.get(key);
            read.onsuccess = () => {
              const value = read.result;
              if (kind === "missing timestamp") {
                delete value.savedAt;
                value.weather.fetchedAt = "2020-01-01T00:00:00Z";
              } else value.weather.hourly = null;
              store.put(value, key);
            };
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    }, corruption);
    await page.unroute("https://todayweather.wizardfactory.net/**");
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "자료를 불러오지 못했어요" }),
    ).toBeVisible();
    await expect(
      page.getByText("Unexpected Application Error!", { exact: false }),
    ).toHaveCount(0);
    await context.setOffline(false);
  });
}

test("upstream failure is recoverable and never replaced by demo data", async ({
  page,
}) => {
  await page.route(
    "https://todayweather.wizardfactory.net/weather/**",
    (route) => route.abort(),
  );
  await page.goto("/weather/seoul/hourly");
  await expect(
    page.getByRole("heading", { name: "자료를 불러오지 못했어요" }),
  ).toBeVisible();
  await expect(page.locator(".temperature")).toHaveCount(0);
  await expect(page.getByText("예제 데이터", { exact: false })).toHaveCount(0);
  await page.unroute("https://todayweather.wizardfactory.net/weather/**");
  await page.reload();
  await expect(page.locator(".temperature")).toBeVisible();
});
test("freeform address resolves through the existing geocode API", async ({
  page,
}) => {
  let addressRequested = false;
  await page.route(
    "https://todayweather.wizardfactory.net/geocode/v000903/addr/**",
    (route) => {
      addressRequested = true;
      return route.fulfill({
        json: {
          name: "테스트 주소",
          address: "서울 테스트",
          country: "KR",
          location: { lat: 37.567, long: 126.978 },
        },
      });
    },
  );
  await page.goto("/locations");
  await page.getByRole("textbox", { name: "지역 검색" }).fill("테스트 주소");
  await page.getByRole("textbox", { name: "지역 검색" }).press("Enter");
  await expect(page.locator(".temperature")).toBeVisible();
  expect(addressRequested).toBe(true);
});
