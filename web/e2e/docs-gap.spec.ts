import { test, expect } from "./fixtures";
import fixture from "../../docs/rewrite/examples/client-kma-response.json" with { type: "json" };
import { PLACES } from "@todayweather/core";
const API = "https://todayweather.wizardfactory.net";
function kma(patch: (raw: any) => void = () => {}) {
  const raw: any = structuredClone(fixture.response);
  patch(raw);
  return raw;
}
async function useKma(
  page: import("@playwright/test").Page,
  patch?: (raw: any) => void,
) {
  await page.route(API + "/weather/**", (r) => r.fulfill({ json: kma(patch) }));
}
function seed(page: import("@playwright/test").Page, value: unknown) {
  return page.addInitScript((v) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("tw.web.v1.preferences", JSON.stringify(v));
      sessionStorage.setItem("seeded", "1");
    }
  }, value);
}
const base = {
  version: 1,
  places: [] as unknown[],
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
  },
};
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

test("KMA observation time, sources, details and the air window follow the rewrite contracts", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-09-25T12:00:00+09:00"));
  await useKma(page, (raw) => {
    raw.current.dspls = 75;
    raw.current.dsplsStr = "높음";
    Object.assign(raw.midData.dailyData[1], { ultrv: 6, ultrvStr: "높음" });
  });
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".data-footer .stamp")).toHaveText(
    "관측 시각 2026-09-23 09:00",
  );
  await expect(page.getByText("관측 시각이 오래된 자료입니다")).toBeVisible();
  await expect(page.locator(".details-panel")).toContainText("06:20");
  await expect(page.locator(".details-panel")).not.toContainText("2026.09");
  await expect(page.locator(".details-panel")).toContainText("자외선");
  await expect(page.locator(".details-panel")).toContainText("높음 (6)");
  await expect(page.locator(".details-panel")).toContainText("불쾌지수");
  await expect(page.getByText("예보 발표 2026-09-23 05:00")).toBeVisible();
  await expect(page.locator(".air-summary")).toContainText(
    "대기오염정보: 환경부/한국환경공단",
  );
  await expect(page.locator(".air-summary")).toContainText(
    "인증되지 않은 실시간 자료",
  );
  // AQI rows after the 09:00 observation are forecasts even without pubDate.
  await expect(page.locator(".air-forecast > span")).toHaveCount(4);
  await expect(page.getByText("Powered by Dark Sky")).toHaveCount(0);
  await page.getByRole("button", { name: "미세먼지", exact: true }).click();
  const attribution = page.locator(".air-attribution");
  await expect(attribution).toContainText("인증되지 않은 실시간 자료");
  await expect(attribution).toContainText("예보자료: KAQ");
  await expect(attribution).toContainText("안양대학교");
  const bars = page.locator(".bar-chart > div");
  await expect(bars).toHaveCount(24);
  await expect(bars.nth(12)).toHaveAttribute("title", /2026-09-23 09:00/);
  await expect(bars.nth(12)).toHaveAttribute("title", /관측$/);
  await expect(bars.nth(13)).toHaveAttribute("title", /예보$/);
  await expect(page.locator(".bar-chart")).toContainText("9/23");
});

test("overseas weather credits Dark Sky like the mobile app", async ({
  page,
}) => {
  await page.goto("/weather/tokyo/hourly");
  await expect(
    page.getByRole("link", { name: "Powered by Dark Sky" }),
  ).toHaveAttribute("href", "https://darksky.net/poweredby/");
  await expect(page.locator(".air-attribution")).toHaveCount(0);
});

test("six-grade standards and small inch amounts render faithfully", async ({
  page,
}) => {
  await seed(page, {
    ...base,
    settings: {
      ...base.settings,
      units: {
        ...base.settings.units,
        airUnit: "airnow",
        precipitationUnit: "in",
      },
    },
  });
  await useKma(page, (raw) => {
    raw.units.airUnit = "airnow";
    raw.current.rn1 = 0.2;
    raw.airInfoList[0].last.aqiGrade = 3;
    delete raw.airInfoList[0].last.aqiStr;
  });
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".air-orb")).toContainText("민감군주의");
  await expect(page.locator(".air-orb")).toHaveClass(/grade-6-3/);
  await expect(
    page.locator(".metric").filter({ hasText: "강수량" }),
  ).toContainText("<0.01 in");
});

test("selecting a place opens weather even when the start screen is favorites", async ({
  page,
}) => {
  await seed(page, {
    ...base,
    settings: { ...base.settings, startup: "locations" },
  });
  await page.goto("/locations");
  await page
    .locator(".city-chips")
    .getByRole("button", { name: "부산" })
    .click();
  await expect(page).toHaveURL(/\/weather\/busan\/hourly$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/locations$/);
});

test("a full favorites list still lets people view another place", async ({
  page,
}) => {
  const places = Array.from({ length: 30 }, (_, i) => ({
    ...PLACES[0],
    id: "saved" + i,
    name: "저장" + i,
    lat: 30 + i / 10,
    lon: 127,
  }));
  await seed(page, { ...base, places, selectedId: "saved0" });
  await page.goto("/locations");
  await page
    .locator(".city-chips")
    .getByRole("button", { name: "부산" })
    .click();
  await expect(page).toHaveURL(/\/weather\/busan\/hourly$/);
  await expect(page.locator(".toast")).toContainText("저장하지 않고");
});

test("current location keeps one replaceable entry and denial shows guidance", async ({
  browser,
}) => {
  const context = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: 37.5, longitude: 127.0 },
  });
  const page = await context.newPage();
  try {
    await page.route(API + "/geocode/v000903/coord/**", (r) => {
      const [lat, lon] = new URL(r.request().url()).pathname
        .split("/")
        .at(-1)!
        .split(",")
        .map(Number);
      return r.fulfill({
        json: {
          name: "현재 동네",
          country: "KR",
          address: "대한민국 서울특별시 중구 명동",
          location: { lat, long: lon },
        },
      });
    });
    await page.route(API + "/weather/**", (r) => r.fulfill({ json: kma() }));
    const here = () =>
      page.getByRole("button", { name: "현재 위치", exact: true });
    await page.goto("/locations");
    await here().click();
    await expect(page).toHaveURL(/\/weather\/p_37\.5_127\/hourly$/);
    await context.setGeolocation({ latitude: 37.6, longitude: 127.1 });
    await page.goto("/locations");
    await here().click();
    await expect(page).toHaveURL(/\/weather\/p_37\.6_127\.1\/hourly$/);
    await page.goto("/locations");
    await expect(page.locator(".location-card")).toHaveCount(1);
    await context.clearPermissions();
    await here().click();
    await expect(page.locator(".permission-help")).toContainText("사이트 설정");
  } finally {
    await context.close();
  }
});

test("deleting a place removes its stored weather and clearing data resets the browser", async ({
  page,
}) => {
  await useKma(page);
  await page.goto("/locations");
  await page
    .locator(".city-chips")
    .getByRole("button", { name: "서울" })
    .click();
  await expect(page.locator(".temperature")).toBeVisible();
  await expect.poll(() => snapshotOwners(page)).toContain("seoul");
  await page.goto("/locations");
  await expect(page.locator(".location-preview")).toContainText("°");
  await page.getByRole("button", { name: "서울 삭제" }).click();
  await expect.poll(() => snapshotOwners(page)).not.toContain("seoul");
  await page
    .locator(".city-chips")
    .getByRole("button", { name: "부산" })
    .click();
  await expect(page.locator(".temperature")).toBeVisible();
  await page.goto("/settings");
  page.once("dialog", (d) => void d.accept());
  await page
    .getByRole("button", { name: "이 브라우저의 오늘날씨 데이터 삭제" })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("tw.web.v1.preferences")),
    )
    .not.toContain("busan");
  await expect.poll(() => snapshotOwners(page)).toEqual([]);
});

test("backup import asks before replacing favorites", async ({ page }) => {
  await seed(page, { ...base, places: [PLACES[0]], selectedId: "seoul" });
  await page.goto("/settings");
  page.once("dialog", (d) => void d.dismiss());
  await page.locator('input[type="file"]').setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...base, places: [PLACES[1]] })),
  });
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("tw.web.v1.preferences")),
    )
    .toContain("seoul");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("tw.web.v1.preferences")),
    )
    .not.toContain("busan");
});

test("stored weather appears first while a slow refresh is pending, and a failed refresh is flagged", async ({
  page,
}) => {
  await useKma(page);
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  await expect.poll(() => snapshotOwners(page)).toContain("seoul");
  await page.unroute(API + "/weather/**");
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(API + "/weather/**", async (r) => {
    await gate;
    await r.fulfill({ status: 500, contentType: "text/plain", body: "x" });
  });
  await page.reload();
  await expect(page.locator(".temperature")).toBeVisible();
  await expect(
    page.getByText("저장된 자료를 먼저 표시하고 있습니다"),
  ).toBeVisible();
  release();
  await expect(
    page.getByText("연결하지 못해 저장된 자료를 표시합니다"),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise((r) => {
        const d = indexedDB.deleteDatabase("tw.web.v1.snapshots");
        d.onsuccess = d.onerror = d.onblocked = () => r(null);
      }),
  );
  await page.getByRole("button", { name: "날씨 새로고침" }).click();
  await expect(page.getByText("최신 자료로 갱신하지 못했습니다")).toBeVisible();
  await expect(page.locator(".temperature")).toBeVisible();
});

test("another tab's favorite changes are picked up", async ({
  context,
  page,
}) => {
  await page.goto("/locations");
  const other = await context.newPage();
  await other.route(API + "/**", (r) => r.fulfill({ json: kma() }));
  await other.goto("/locations");
  await other
    .locator(".city-chips")
    .getByRole("button", { name: "대구" })
    .click();
  await expect(page.locator(".saved-city-list")).toContainText("대구");
  await other.close();
});

test("preliminary special reports show the note marker", async ({ page }) => {
  await page.route(API + "/v000903/kma/special", (r) =>
    r.fulfill({
      json: [
        {
          name: "기상특보",
          type: 1,
          announcement: "2026-09-25T00:00:00.000Z",
          comment: "본문",
        },
        {
          name: "기상정보",
          type: 3,
          announcement: "2026-09-25T00:00:00.000Z",
          comment: "정보",
        },
      ],
    }),
  );
  await page.goto("/warnings");
  await expect(page.locator(".bulletin").first()).toContainText("<참고사항>");
  await expect(page.locator(".bulletin").nth(1)).not.toContainText(
    "<참고사항>",
  );
});
