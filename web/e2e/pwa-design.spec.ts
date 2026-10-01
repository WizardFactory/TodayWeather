import { test, expect } from "./fixtures";
import fixture from "../../docs/rewrite/examples/client-kma-response.json" with { type: "json" };
const API = "https://todayweather.wizardfactory.net";
test.use({ serviceWorkers: "block" });
function seedWeatherPlace() {
  localStorage.setItem(
    "tw.web.v1.preferences",
    JSON.stringify({
      version: 1,
      places: [
        {
          id: "seoul",
          name: "서울",
          country: "KR",
          address: "서울",
          lat: 37.567,
          lon: 126.978,
        },
      ],
      selectedId: "seoul",
      settings: { startup: "hourly", language: "ko" },
    }),
  );
}
test("unavailable chart routes keep content focus and recover to the selected chart", async ({
  page,
}) => {
  await page.addInitScript(seedWeatherPlace);
  let available = false;
  await page.route(API + "/weather/**", (route) =>
    available
      ? route.fulfill({ json: dailyFixture() })
      : route.fulfill({ status: 501, body: "Fixture unavailable" }),
  );
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto("/settings");
  await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await page
    .locator(".sidebar")
    .getByRole("link", { name: "날씨", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("#main-content")).toBeFocused();
  await page.getByRole("button", { name: "일별", exact: true }).click();
  await expect(page.locator("#main-content")).toBeFocused();
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("#main-content")).toBeFocused();
  available = true;
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.locator(".daily-chart")).toBeFocused();
  await expect(page.locator(".daily-chart")).toBeInViewport();
});
test("loading focus waits for the navigation menu to close even with an early frame", async ({
  page,
}) => {
  await page.addInitScript(seedWeatherPlace);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(API + "/weather/**", async (route) => {
    await held;
    await route.fulfill({ status: 501, body: "Fixture unavailable" });
  });
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto("/settings");
  await page.evaluate(() => {
    const nativeFrame = window.requestAnimationFrame.bind(window);
    const nativeFocus = HTMLElement.prototype.focus;
    (window as any).inertFocusAttempts = [];
    HTMLElement.prototype.focus = function (options) {
      if (this.closest("[inert]"))
        (window as any).inertFocusAttempts.push(this.id || this.className);
      return nativeFocus.call(this, options);
    };
    window.requestAnimationFrame = (callback) => {
      // Reproduce the observed frame before the shell commits menu closure.
      if (document.getElementById("main-content")?.closest("[inert]")) {
        callback(performance.now());
        return 0;
      }
      return nativeFrame(callback);
    };
  });
  try {
    await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
    await page
      .locator(".sidebar")
      .getByRole("link", { name: "날씨", exact: true })
      .click();
    await expect(page.locator(".workspace")).not.toHaveAttribute("inert", "");
    await expect(
      page.getByRole("status").filter({ hasText: "날씨를 불러오는 중이에요" }),
    ).toBeVisible();
    await expect(page.locator("#main-content")).toBeFocused();
    expect(
      await page.evaluate(() => (window as any).inertFocusAttempts),
    ).toEqual([]);
    release();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator("#main-content")).toBeFocused();
  } finally {
    release();
  }
});
function dailyFixture(partial = false) {
  const raw = structuredClone(fixture.response) as any;
  raw.current = { ...raw.current, date: "20260923", time: "0900", t1h: 20 };
  raw.midData.dailyData = Array.from({ length: 6 }, (_, i) => ({
    ...raw.midData.dailyData[0],
    date: `202609${23 + i}`,
    time: "0000",
    tmn: partial && i === 5 ? undefined : 10,
    tmx: partial && i === 5 ? 35 : 25,
    skyAm: "sun",
    skyPm: i === 1 ? "sun" : "rain",
    pop: 60,
    r06: 2,
  }));
  return raw;
}
test("daily AM/PM conditions include column zero, merged icons and reading alternatives", async ({
  page,
}) => {
  await page.route(API + "/weather/**", (r) =>
    r.fulfill({ json: dailyFixture() }),
  );
  await page.goto("/weather/seoul/daily");
  const columns = page.locator(".daily-columns .chart-column");
  await expect(columns).toHaveCount(6);
  await expect(columns.nth(0).locator("svg")).toHaveCount(2);
  await expect(columns.nth(0)).toContainText("오전");
  await expect(columns.nth(0)).toContainText("오후");
  await expect(columns.nth(1).locator("svg")).toHaveCount(1);
  const daily = page.locator(".daily-chart");
  await daily.focus();
  await daily.press("End");
  const readout = page.locator(".daily-chart-panel .cursor-readout");
  await expect(readout).toContainText("오전");
  await expect(readout).toContainText("맑음");
  await expect(readout).toContainText("오후");
  await expect(readout).toContainText("비");
  await expect(readout).toContainText("60%");
  await page.locator(".daily-chart-panel summary").click();
  const row = page.locator(".daily-chart-panel tbody tr").last();
  await expect(row).toContainText("오전 맑음");
  await expect(row).toContainText("오후 비");
});
test("chart route navigation scrolls and focuses on click, direct load and history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto("/weather/seoul/hourly");
  const hourly = page.locator(".hourly-chart"),
    daily = page.locator(".daily-chart");
  await expect(hourly).toBeFocused();
  await page.getByRole("button", { name: "일별", exact: true }).click();
  await expect(daily).toBeFocused();
  await expect(daily).toBeInViewport();
  await page.goBack();
  await expect(hourly).toBeFocused();
  await page.goForward();
  await expect(daily).toBeFocused();
  await page.reload();
  await expect(daily).toBeFocused();
  await expect(daily).toBeInViewport();
});
test("empty live data replaces a focused stored chart with its readable section", async ({
  page,
}) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let refreshing = false;
  await page.route(API + "/weather/**", async (r) => {
    const raw = dailyFixture();
    if (refreshing) {
      await gate;
      raw.short = [];
      raw.shortest = [];
      raw.daily = [];
      raw.midData.dailyData = [];
    }
    await r.fulfill({ json: raw });
  });
  await page.goto("/weather/seoul/daily");
  await expect(page.locator(".daily-chart")).toBeFocused();
  // The cached snapshot is rendered while the new live request is held.
  refreshing = true;
  await page.reload();
  await expect(page.locator(".daily-chart")).toBeFocused();
  release();
  await expect(page.locator(".daily-chart")).toHaveCount(0);
  await expect(page.locator('[data-weather-section="daily"]')).toBeFocused();
});
for (const partial of ["missing-low", "missing-high", "all-partial"] as const)
  test(`surviving extrema stay within the daily plot: ${partial}`, async ({
    page,
  }) => {
    const raw = dailyFixture(true);
    if (partial === "missing-high") {
      raw.midData.dailyData[5].tmn = -20;
      raw.midData.dailyData[5].tmx = undefined;
    } else if (partial === "all-partial") {
      for (const row of raw.midData.dailyData) row.tmn = undefined;
      raw.midData.dailyData[0].tmx = 35;
      raw.midData.dailyData[5].tmn = -20;
      raw.midData.dailyData[5].tmx = undefined;
    }
    await page.route(API + "/weather/**", (r) => r.fulfill({ json: raw }));
    await page.goto("/weather/seoul/daily");
    await expect(page.locator(".daily-chart .range")).toHaveCount(
      partial === "all-partial" ? 0 : 5,
    );
    const daily = page.locator(".daily-chart");
    await daily.focus();
    await daily.press("End");
    const geometry = await daily.locator('svg[role="img"]').evaluate(
      (svg, text) => {
        const label = [...svg.querySelectorAll("text")].find(
          (e) => e.textContent === text,
        )!;
        const bounds = svg.getBoundingClientRect(),
          value = label.getBoundingClientRect();
        return {
          plotTop: bounds.top,
          plotBottom: bounds.bottom,
          top: value.top,
          bottom: value.bottom,
        };
      },
      partial === "missing-low" ? "35°" : "-20°",
    );
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.plotTop);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.plotBottom);
  });
test("system appearance, independent 130% setting and legacy rollback survive reload", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/settings");
  await expect(page.locator("html")).toHaveAttribute(
    "data-appearance",
    "system",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-resolved-appearance",
    "dark",
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#0f1724",
  );
  await page
    .getByRole("combobox", { name: "글자 크기", exact: true })
    .selectOption("1.3");
  await page
    .getByRole("combobox", { name: "현재 날씨 배경", exact: true })
    .selectOption("plain");
  await expect
    .poll(() =>
      page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).fontSize),
      ),
    )
    .toBe(20.8);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("tw.web.v1.preferences")!).settings
            .theme,
      ),
    )
    .toBe("dark");
  await page.evaluate(() => {
    const old = JSON.parse(localStorage.getItem("tw.web.v1.preferences")!);
    old.settings.theme = "photo";
    localStorage.setItem("tw.web.v1.preferences", JSON.stringify(old));
  });
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "글자 크기", exact: true }),
  ).toHaveValue("1.3");
  await expect(page.locator("html")).toHaveAttribute(
    "data-hero-style",
    "plain",
  );
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-resolved-appearance",
    "light",
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#f4f6fa",
  );
});
test("a native confirmation cancels with Escape and returns focus without losing saved data", async ({
  page,
}) => {
  await page.goto("/settings");
  await page
    .getByRole("combobox", { name: "글자 크기", exact: true })
    .selectOption("1.3");
  const trigger = page.getByRole("button", {
    name: "이 브라우저의 오늘날씨 데이터 삭제",
  });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "취소", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(
    page.getByRole("combobox", { name: "글자 크기", exact: true }),
  ).toHaveValue("1.3");
  await trigger.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "확인", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "글자 크기", exact: true }),
  ).toHaveValue("1");
});
test("full mixed-day timeline, current observation, keyboard cursor and model tables agree", async ({
  page,
}) => {
  const raw = structuredClone(fixture.response) as any;
  raw.short = [];
  raw.shortest = [];
  const p = raw.current;
  // Real API field structure with deliberately complete synthetic history.
  raw.short = Array.from({ length: 42 }, (_, i) => ({
    ...p,
    date: `202609${i < 24 ? "22" : "23"}`,
    time: String((i % 24) * 100).padStart(4, "0"),
    t3h: i === 29 ? -50 : 10 + i / 4,
    t1h: undefined,
    vec: 225,
    wsd: 3,
    r06: 1,
  }));
  raw.current = { ...p, date: "20260923", time: "0900", t1h: -12, vec: 225 };
  raw.midData.dailyData = Array.from({ length: 11 }, (_, i) => ({
    ...raw.midData.dailyData[0],
    date: `202609${String(20 + i).padStart(2, "0")}`,
    time: "0000",
    tmn: i - 5,
    tmx: i === 10 ? undefined : i + 6,
    pop: 60,
  }));
  await page.route(API + "/weather/**", (route) =>
    route.fulfill({ json: raw }),
  );
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".temperature")).toContainText("-12");
  expect(await page.locator(".hourly-columns .chart-column").count()).toBe(42);
  expect(await page.locator(".daily-columns .chart-column").count()).toBe(11);
  const hourly = page.locator(".hourly-chart");
  await hourly.focus();
  await hourly.press("End");
  await expect(hourly).toHaveAttribute("data-cursor", "41");
  await expect(page.locator(".chart-panel .cursor-readout")).toContainText(
    "어제",
  );
  await page
    .getByRole("button", { name: "바람·습도 보기", exact: true })
    .click();
  await expect(page.locator(".chart-extras")).toBeVisible();
  expect(await page.locator(".chart-extras .chart-wind svg").count()).toBe(42);
  await page.locator(".chart-panel summary").click();
  expect(await page.locator(".chart-panel tbody tr").count()).toBe(42);
  expect(await page.locator(".hourly-chart .now").count()).toBe(1);
  expect(await page.locator(".daily-chart .now").count()).toBe(1);
  const stops = await page
    .locator(".daily-chart stop")
    .evaluateAll((es) => es.map((e) => e.getAttribute("stop-color")));
  expect(stops).toEqual([
    "var(--tw-chart-range-cool)",
    "var(--tw-chart-range-warm)",
  ]);
  await page.locator(".daily-chart-panel summary").click();
  expect(await page.locator(".daily-chart-panel tbody tr").count()).toBe(11);
  expect(
    await page
      .locator(".daily-chart-panel tbody tr")
      .nth(0)
      .locator("td")
      .nth(2)
      .textContent(),
  ).toBe("—");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "간단히 보기", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
});

for (const width of [320, 402])
  test(`chart value labels and legend do not overlap at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 874 });
    await page.route(API + "/weather/**", (route) =>
      route.fulfill({ json: fixture.response }),
    );
    await page.goto("/weather/seoul/hourly");
    await expect(page.locator(".hourly-chart")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const collisions = await page.locator(".hourly-chart").evaluate((el) => {
      const rects = [...el.querySelectorAll("text.chart-value")].map((e) =>
        e.getBoundingClientRect(),
      );
      const intersect = (a: DOMRect, b: DOMRect) =>
        Math.min(a.right, b.right) > Math.max(a.left, b.left) + 0.5 &&
        Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 0.5;
      const pairs = [];
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++)
          if (intersect(rects[i], rects[j])) pairs.push([i, j]);
      const legend = document
        .querySelector(".chart-legend")!
        .getBoundingClientRect();
      for (const r of rects) if (intersect(r, legend)) pairs.push(["legend"]);
      return pairs;
    });
    expect(collisions).toEqual([]);
    const scroll = await page.locator(".hourly-chart").evaluate((el) => ({
      left: el.scrollLeft,
      client: el.clientWidth,
      whole: el.scrollWidth,
    }));
    expect(scroll.whole).toBeGreaterThan(scroll.client);
    expect(scroll.left).toBeGreaterThan(0);
    const values = await page
      .locator(".hourly-columns .chart-probability")
      .allTextContents();
    expect(values.slice(1)).toContain("0%");
    await page
      .getByRole("button", { name: "바람·습도 보기", exact: true })
      .click();
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--tw-text-scale", "1.3");
      window.dispatchEvent(new Event("resize"));
    });
    const windCollisions = await page
      .locator(".chart-extras")
      .evaluate((el) => {
        const rects = [
          ...el.querySelectorAll(
            ".chart-wind > span, .chart-column > span:not(.chart-wind)",
          ),
        ].map((e) => e.getBoundingClientRect());
        return rects.flatMap((a, i) =>
          rects
            .slice(i + 1)
            .filter(
              (b) =>
                Math.min(a.right, b.right) > Math.max(a.left, b.left) + 0.5 &&
                Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 0.5,
            ),
        );
      });
    expect(windCollisions).toEqual([]);
  });
