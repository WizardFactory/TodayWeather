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
  // Native: AM/PM icons stack without period words; their names stay readable.
  await expect(
    columns.nth(0).locator('.chart-condition[aria-label^="오전"]'),
  ).toHaveCount(1);
  await expect(
    columns.nth(0).locator('.chart-condition[aria-label^="오후"]'),
  ).toHaveCount(1);
  await expect(columns.nth(0)).not.toContainText("오전");
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
test("daily chart keeps the native cells: empty probability, two-digit day, a 10 px bar and a sized current dot without a line", async ({
  page,
}) => {
  const raw = dailyFixture();
  // 09-23 (today) has no probability; 10-01 checks the two-digit day.
  raw.midData.dailyData = Array.from({ length: 9 }, (_, i) => ({
    ...raw.midData.dailyData[0],
    date: i < 8 ? `202609${23 + i}` : "20261001",
    pop: i === 0 ? 0 : 60,
  }));
  await page.route(API + "/weather/**", (r) => r.fulfill({ json: raw }));
  await page.goto("/weather/seoul/daily");
  const daily = page.locator(".daily-chart");
  const columns = daily.locator(".daily-columns .chart-column");
  await expect(columns).toHaveCount(9);
  await expect(columns.nth(8).locator(".chart-day-date")).toHaveText("01");
  expect(
    (await columns.nth(0).locator(".chart-probability").textContent())!.trim(),
  ).toBe("");
  await expect(columns.nth(1).locator(".chart-probability")).toHaveText("60%");
  // No line runs through today's column until the user picks a day.
  await expect(daily.locator(".now-line")).toHaveCount(0);
  await expect(daily.locator("svg line:not(.chart-grid)")).toHaveCount(0);
  await daily.focus();
  await daily.press("ArrowRight");
  await expect(daily).toHaveAttribute("data-cursor", "1");
  await expect(daily.locator(".cursor-line")).toHaveCount(1);
  // The pick does not follow the user to another place whose weather is
  // already loaded (the chart stays mounted): load Busan, pick there, go back.
  await page.evaluate(() => {
    history.pushState({}, "", "/weather/busan/daily");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("부산");
  await expect(columns).toHaveCount(9);
  await expect(daily.locator(".cursor-line")).toHaveCount(0);
  await daily.focus();
  await daily.press("ArrowRight");
  await expect(daily.locator(".cursor-line")).toHaveCount(1);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("서울");
  await expect(daily.locator(".cursor-line")).toHaveCount(0);
  const sizes = await daily.evaluate((el) => ({
    bar: Number(el.querySelector("rect.range")!.getAttribute("width")),
    dot: Number(el.querySelector("circle.now")!.getAttribute("r")),
  }));
  expect(sizes.bar).toBe(10);
  expect(sizes.dot).toBe(7);
  // The table keeps the dash for a missing probability.
  await page.locator(".daily-chart-panel summary").click();
  await expect(
    page.locator(".daily-chart-panel tbody tr").first(),
  ).toContainText("—");
});
test("daily chart opens with today third whenever the days do not all fit, and at the first day when they do", async ({
  page,
}) => {
  const raw = dailyFixture();
  // Today (09-23) is the sixth of 16 days.
  raw.midData.dailyData = Array.from({ length: 16 }, (_, i) => ({
    ...raw.midData.dailyData[0],
    date: `2026${i < 13 ? "09" : "10"}${String(i < 13 ? 18 + i : i - 12).padStart(2, "0")}`,
  }));
  await page.route(API + "/weather/**", (r) => r.fulfill({ json: raw }));
  for (const [width, fits] of [
    [402, false],
    [768, false],
    [1024, false],
    [1440, true],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/weather/seoul/daily");
    const daily = page.locator(".daily-chart");
    await expect(daily.locator(".today-column")).toHaveCount(1);
    await page.evaluate(() => document.fonts.ready);
    const pos = await daily.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const cols = [...el.querySelectorAll(".chart-column")];
      const today = cols.findIndex((c) => c.classList.contains("today-column"));
      return {
        scrollLeft: el.scrollLeft,
        overflow: el.scrollWidth > el.clientWidth + 1,
        // 1-based position of today among the columns from the left edge.
        todayPosition:
          today -
          cols.findIndex((c) => c.getBoundingClientRect().right > box.left + 1) +
          1,
      };
    });
    expect(pos.overflow).toBe(!fits);
    if (fits) expect(pos.scrollLeft).toBe(0);
    else expect(pos.todayPosition).toBe(3);
  }
  // Today near the end of the days: the chart stops at its last scroll position.
  raw.current = { ...raw.current, date: "20261002" };
  await page.setViewportSize({ width: 402, height: 900 });
  await page.goto("/weather/seoul/daily");
  const daily = page.locator(".daily-chart");
  await expect(daily.locator(".today-column")).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  const end = await daily.evaluate((el) => ({
    scrollLeft: el.scrollLeft,
    max: el.scrollWidth - el.clientWidth,
  }));
  expect(end.max).toBeGreaterThan(0);
  expect(Math.abs(end.scrollLeft - end.max)).toBeLessThan(2);
});
test("chart route navigation scrolls and focuses on click, direct load and history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto("/weather/seoul/hourly");
  const hero = page.locator(".hero-card"),
    daily = page.locator(".daily-chart");
  await expect(hero).toBeInViewport();
  await page.getByRole("button", { name: "일별", exact: true }).click();
  await expect(daily).toBeFocused();
  await expect(daily).toBeInViewport();
  await page.goBack();
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(hero).toBeInViewport();
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
    .toBeCloseTo(20.8, 4);
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
for (const entry of ["pointer", "keyboard"] as const) {
  test(`confirmation restores its ${entry} invoker after Escape, cancel and confirm`, async ({
    page,
  }) => {
    await page.goto("/settings");
    const scale = page.getByRole("combobox", {
      name: "글자 크기",
      exact: true,
    });
    await scale.selectOption("1.3");
    const trigger = page.getByRole("button", {
      name: "이 브라우저의 오늘날씨 데이터 삭제",
    });
    const dialog = page.getByRole("dialog");
    for (const action of ["Escape", "취소", "확인"]) {
      // Pointer entry must not inherit focus from a preceding interaction.
      await page.locator("#main-content").focus();
      if (entry === "keyboard") {
        await trigger.focus();
        await page.keyboard.press("Enter");
      } else {
        await trigger.click();
      }
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "취소", exact: true }),
      ).toBeFocused();
      if (action === "Escape") await page.keyboard.press("Escape");
      else
        await dialog.getByRole("button", { name: action, exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await expect(scale).toHaveValue(action === "확인" ? "1" : "1.3");
    }
  });
}
for (const action of ["Escape", "취소", "확인"] as const) {
  test(`backup confirmation returns to its visible import button after ${action}`, async ({
    page,
  }) => {
    await page.goto("/settings");
    const scale = page.getByRole("combobox", {
      name: "글자 크기",
      exact: true,
    });
    await scale.selectOption("1.3");
    const trigger = page.getByRole("button", { name: "가져오기", exact: true });
    await page.locator("#main-content").focus();
    const chooser = page.waitForEvent("filechooser");
    await trigger.click();
    await (
      await chooser
    ).setFiles({
      name: "fixture-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          places: [],
          settings: { language: "ko" },
          display: { textScale: 1 },
        }),
      ),
    });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    if (action === "Escape") await page.keyboard.press("Escape");
    else
      await dialog.getByRole("button", { name: action, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(scale).toHaveValue(action === "확인" ? "1" : "1.3");
  });
}
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
  expect(await page.locator(".hourly-chart .now-point").count()).toBe(1);
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
    // Native: every yesterday value is drawn and today's dot covers it when
    // they meet, so only today's values and the legend must stay apart.
    const yesterday = await page.locator(".hourly-chart").evaluate((el) => ({
      points: el.querySelectorAll("svg > g:not(.current-marker) .yesterday-point").length,
      values: el.querySelectorAll(".yesterday-value").length,
    }));
    expect(yesterday.values).toBe(yesterday.points);
    const collisions = await page.locator(".hourly-chart").evaluate((el) => {
      const rects = [...el.querySelectorAll("text.today-value")].map((e) =>
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

test("hourly entry keeps Hero visible and error Retry restores focus to main without hiding Hero (#3115)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = false;
  await page.route(API + "/weather/**", (route) =>
    fail
      ? route.fulfill({ status: 501, body: "Fixture unavailable" })
      : route.fulfill({ json: dailyFixture() }),
  );
  // City selection from "/" lands on /weather/seoul/hourly with Hero visible at top.
  await page.goto("/");
  await page.getByRole("button", { name: /서울/ }).first().click();
  await expect(page).toHaveURL(/\/weather\/seoul\/hourly$/);
  const hero = page.locator(".hero-card");
  await expect(hero).toBeVisible();
  await expect(hero).toBeInViewport();
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBe(0);

  // Direct load error -> Retry on an uncached hourly route focuses #main-content and keeps Hero visible.
  fail = true;
  await page.goto("/weather/busan/hourly");
  await expect(page.getByRole("alert")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(hero).toBeVisible();
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(hero).toBeInViewport();

  // Overview route also keeps Hero visible at top.
  await page.goto("/weather/seoul/overview");
  await expect(hero).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Initial PWA launch at "/" with a saved city redirects without hijacking focus (PR2-O4).
  await page.goto("/");
  await expect(page).toHaveURL(/\/weather\/seoul\/hourly$/);
  await expect(hero).toBeInViewport();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
});

test("coordinate preview /loc scrolls back to top when switching from daily to hourly (#3115)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(API + "/weather/**", (route) =>
    route.fulfill({ json: dailyFixture() }),
  );
  await page.goto("/loc?lat=36.123&lon=128.456&name=PreviewCity&view=hourly");
  const hero = page.locator(".hero-card");
  await expect(hero).toBeInViewport();

  await page.getByRole("button", { name: "일별", exact: true }).click();
  await expect(page).toHaveURL(/view=daily/);
  await expect(page.locator(".daily-chart")).toBeFocused();
  await expect(page.locator(".daily-chart")).toBeInViewport();

  // History Back (POP) from daily -> hourly returns to top and focuses #main-content.
  await page.goBack();
  await expect(page).toHaveURL(/view=hourly/);
  await expect(hero).toBeInViewport();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator("#main-content")).toBeFocused();

  // Tab click from daily -> hourly also returns to top.
  await page.getByRole("button", { name: "일별", exact: true }).click();
  await expect(page.locator(".daily-chart")).toBeFocused();
  await page.getByRole("button", { name: "시간별", exact: true }).click();
  await expect(page).toHaveURL(/view=hourly/);
  await expect(hero).toBeInViewport();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("precipitation forecast section shows upcoming rows instead of past days (#3115)", async ({
  page,
}) => {
  const raw = structuredClone(fixture.response) as any;
  raw.current = { ...raw.current, date: "20260923", time: "0900", t1h: 20 };
  raw.short = [
    { ...raw.current, date: "20260921", time: "0000", t3h: 15, r06: 0, pop: 10 },
    { ...raw.current, date: "20260922", time: "1200", t3h: 17, r06: 0, pop: 15 },
    { ...raw.current, date: "20260923", time: "0900", t3h: 20, r06: 1, pop: 30 },
    { ...raw.current, date: "20260923", time: "1200", t3h: 22, r06: 3, pop: 60 },
  ];
  raw.shortest = [];
  raw.midData.dailyData = [
    { ...raw.midData.dailyData[0], date: "20260921", time: "0000", r06: 0, pop: 0 },
    { ...raw.midData.dailyData[0], date: "20260922", time: "0000", r06: 0, pop: 0 },
    { ...raw.midData.dailyData[0], date: "20260923", time: "0000", r06: 2, pop: 40 },
    { ...raw.midData.dailyData[0], date: "20260924", time: "0000", r06: 8, pop: 70 },
  ];
  await page.route(API + "/weather/**", (route) => route.fulfill({ json: raw }));
  await page.goto("/weather/seoul/hourly");
  const precipPanel = page.locator("section.panel").filter({
    has: page.getByRole("heading", { name: "강수·눈 예보", exact: true }),
  });
  await expect(precipPanel).toContainText("오늘");
  await expect(precipPanel).not.toContainText("그제");
  await expect(precipPanel).not.toContainText("어제");

  await page.getByRole("button", { name: "일별", exact: true }).click();
  await expect(precipPanel).toContainText("오늘");
  await expect(precipPanel).toContainText("내일");
  await expect(precipPanel).not.toContainText("그제");
  await expect(precipPanel).not.toContainText("어제");
});

test("sidebar keeps single aria-current across routes, removes live-dot, normalizes -0, and aligns air bars (#3116)", async ({
  page,
}) => {
  const raw = structuredClone(fixture.response) as any;
  raw.current = { ...raw.current, date: "20260923", time: "0900", t1h: -0.04 };
  if (raw.airInfoList?.[0]?.pollutants?.aqi) {
    raw.airInfoList[0].pollutants.pm10 = structuredClone(
      raw.airInfoList[0].pollutants.aqi,
    );
  }
  await page.route(API + "/weather/**", (route) => route.fulfill({ json: raw }));

  // /start without saved places marks only 날씨 active (never both 날씨 & 미세먼지).
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/start");
  const activeLinks = page.locator('.sidebar nav [aria-current="page"]');
  await expect(activeLinks).toHaveCount(1);
  await expect(activeLinks).toContainText("날씨");

  // /weather/seoul/hourly: single active 날씨, no .live-dot, -0.04 formatted as 0° (not -0°).
  await page.goto("/weather/seoul/hourly");
  await expect(activeLinks).toHaveCount(1);
  await expect(activeLinks).toContainText("날씨");
  await expect(page.locator(".live-dot")).toHaveCount(0);
  await expect(page.locator(".hero-card .temperature")).toHaveText("0°C");

  // /weather/seoul/daily still marks 날씨 active.
  await page.goto("/weather/seoul/daily");
  await expect(activeLinks).toHaveCount(1);
  await expect(activeLinks).toContainText("날씨");

  // /air/seoul marks only 미세먼지 active, keeps bar labels single-line, and centers observed bar across viewports.
  for (const vp of [
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(vp);
    await page.goto("/air/seoul");
    await expect(activeLinks).toHaveCount(1);
    await expect(activeLinks).toContainText("미세먼지");

    const checkCentered = () =>
      page.locator(".bar-chart").evaluate((el) => {
        const sb = el.getBoundingClientRect();
        const bars = [...el.querySelectorAll(":scope > div")];
        const labels = [...el.querySelectorAll("small")].filter((s) =>
          s.textContent?.trim(),
        );
        const wrapped = labels.some((s) => {
          const lh = parseFloat(getComputedStyle(s).lineHeight) || 18;
          return s.getBoundingClientRect().height > lh * 1.6;
        });
        const obs = bars[12]!.getBoundingClientRect();
        const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
        const clamped = el.scrollLeft <= 1 || el.scrollLeft >= maxScroll - 1;
        const centerDiff = Math.abs(
          (obs.left + obs.right) / 2 - (sb.left + sb.right) / 2,
        );
        return {
          count: bars.length,
          wrapped,
          inView: obs.left >= sb.left - 2 && obs.right <= sb.right + 2,
          clamped,
          centerDiff,
        };
      });

    const initial = await checkCentered();
    expect(initial.count).toBe(24);
    expect(initial.wrapped).toBe(false);
    expect(initial.inView).toBe(true);
    if (!initial.clamped) expect(initial.centerDiff).toBeLessThanOrEqual(2);

    if (vp.width === 768) {
      // Scrolling away then switching pollutant re-centers the observed bar cleanly.
      await page.locator(".bar-chart").evaluate((el) => {
        el.scrollLeft = 0;
      });
      const pm10Radio = page.getByRole("radio", { name: /^미세먼지/ });
      await pm10Radio.click();
      await expect(pm10Radio).toHaveAttribute("aria-checked", "true");
      const afterSwitch = await checkCentered();
      expect(afterSwitch.inView).toBe(true);
      if (!afterSwitch.clamped)
        expect(afterSwitch.centerDiff).toBeLessThanOrEqual(2);
    }
  }
});

test("an observation on a 3-hour column turns that dot red with readable text and stays distinct in forced colors", async ({
  page,
}) => {
  // The fixture observation is at 09:00 with liveTime 0900: native sharp.
  await page.route(API + "/weather/**", (r) =>
    r.fulfill({ json: fixture.response }),
  );
  await page.goto("/weather/seoul/hourly");
  const scroll = page.locator(".hourly-chart");
  const dot = scroll.locator("svg > g:not(.current-marker) .today-point.now-point");
  await expect(dot).toHaveCount(1);
  await expect(scroll.locator(".current-marker")).toHaveCount(0);
  await expect(dot).toHaveCSS("fill", "rgb(179, 38, 30)");
  await expect(
    dot.locator("xpath=following-sibling::*[contains(@class,'today-value')][1]"),
  ).toHaveCSS("fill", "rgb(255, 255, 255)");
  await page.emulateMedia({ forcedColors: "active" });
  const fills = await scroll.evaluate((el) => {
    const svg = el.querySelector("svg")!;
    const probe = (color: string) => {
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.style.fill = color;
      svg.appendChild(t);
      const value = getComputedStyle(t).fill;
      t.remove();
      return value;
    };
    const dot = el.querySelector(".today-point.now-point")!;
    return {
      now: getComputedStyle(dot).fill,
      other: getComputedStyle(el.querySelector(".today-point:not(.now-point)")!).fill,
      value: getComputedStyle(dot.nextElementSibling!).fill,
      highlight: probe("Highlight"),
      highlightText: probe("HighlightText"),
    };
  });
  expect(fills.now).not.toBe(fills.other);
  expect(fills.now).toBe(fills.highlight);
  expect(fills.value).toBe(fills.highlightText);
});
test("hourly chart matches the native columns: three-hour rows from yesterday, seven per phone screen, current between columns; keeps visible row on expand and handles SVG clicks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const raw: any = structuredClone(fixture.response);
  const p = raw.current;
  raw.short = Array.from({ length: 32 }, (_, i) => {
    const day = 21 + Math.floor((i * 3) / 24);
    const hour = (i * 3) % 24;
    return {
      ...p,
      date: `202609${String(day).padStart(2, "0")}`,
      time: String(hour * 100).padStart(4, "0"),
      // The day before yesterday is 20° colder, so yesterday's columns show
      // their comparison values as text.
      t3h: 10 + (i % 8) - (day === 21 ? 20 : 0),
      t1h: undefined,
      pop: 0,
      vec: 270,
      wsd: 3.2,
      r06: 0,
    };
  });
  raw.shortest = Array.from({ length: 6 }, (_, h) => ({
    ...p,
    date: "20260923",
    time: String(h * 100).padStart(4, "0"),
    t1h: 12 + h,
    pop: 0,
    vec: 300,
    wsd: 2.1,
    rn1: 0,
  }));
  // Off-hour observation (00:15): a marker between columns, not a column.
  // Yesterday's observation is missing (-50), which must not break yesterday's line.
  raw.current = {
    ...p,
    date: "20260923",
    time: "0015",
    liveTime: "0015",
    t1h: 11,
    pop: undefined,
    vec: 290,
    wsd: 1.5,
    yesterday: { ...p.yesterday, t1h: -50 },
  };
  let fetchCount = 0;
  await page.route(API + "/weather/**", (r) => {
    fetchCount++;
    const payload = structuredClone(raw);
    if (fetchCount > 1) {
      payload.current.stnDateTime = "2026.09.23.00:25";
    }
    return r.fulfill({ json: payload });
  });
  await page.goto("/weather/seoul/hourly");
  const scroll = page.locator(".hourly-chart");
  await expect(scroll).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  // Native: the short rows from yesterday (09-22) 00:00, none of the 1-hour rows.
  const hours = page.locator(".hourly-columns .chart-hour");
  await expect(hours).toHaveCount(24);
  // Native KMA labels end a day at 24시.
  await expect(hours.first()).toHaveText("24시");
  expect(
    (await hours.allTextContents()).every((h) => Number.parseInt(h) % 3 === 0),
  ).toBe(true);
  await expect(page.locator(".chart-y-axis")).toHaveCount(0);

  // Native: a seventh of the chart per column, the row before the current one at the left edge.
  const metrics = await scroll.evaluate((el) => {
    const sb = el.getBoundingClientRect();
    const cols = [...el.querySelectorAll(".hourly-columns .chart-column")];
    return {
      clientW: el.clientWidth,
      scrollLeft: el.scrollLeft,
      column: cols[0].getBoundingClientRect().width,
      visible: cols.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left >= sb.left - 1 && r.right <= sb.right + 1;
      }).length,
    };
  });
  expect(Math.abs(metrics.column - metrics.clientW / 7)).toBeLessThan(1);
  expect(metrics.visible).toBe(7);
  expect(Math.abs(metrics.scrollLeft - metrics.column * 7)).toBeLessThan(2);

  // The current column is the 00:00 row; the observation sits halfway to 03:00.
  await expect(page.locator(".hourly-columns .current-column .chart-hour")).toHaveText("24시");
  await expect(
    page.locator(".hourly-columns .current-column .chart-probability"),
  ).toHaveText("0%");
  // Native: a filled red point (no ring or line) marks the observation.
  // Native: a row's sky and probability sit on the boundary before its hour,
  // which is where the between-column observation point is drawn.
  const offsets = await scroll.evaluate((el) => {
    const col = el.querySelectorAll(".hourly-columns .chart-column")[9];
    const hour = col.querySelector(".chart-hour")!.getBoundingClientRect();
    const prob = col.querySelector(".chart-probability")!.getBoundingClientRect();
    return (hour.left + hour.width / 2) - (prob.left + prob.width / 2);
  });
  expect(Math.abs(offsets - metrics.column / 2)).toBeLessThan(1);
  const marker = await scroll.evaluate((el) => {
    const point = el.querySelector(".current-marker .now-point");
    return point ? Number(point.getAttribute("cx")) : null;
  });
  await expect(scroll.locator(".current-marker .now-line")).toHaveCount(0);
  // chart.now #e5484d (light), the native red current point.
  await expect(scroll.locator(".current-marker .now-point")).toHaveCSS(
    "fill",
    "rgb(229, 72, 77)",
  );
  expect(marker).not.toBeNull();
  expect(Math.abs(marker! - metrics.column * 9)).toBeLessThan(1);
  // The observation is announced with the column before it and is in the table.
  await expect(
    page.locator('[data-weather-section="hourly"] .cursor-readout'),
  ).toContainText("현재 오전 12:15 11°C");
  await scroll.focus();
  await scroll.press("ArrowRight");
  await expect(
    page.locator('[data-weather-section="hourly"] .cursor-readout'),
  ).not.toContainText("현재");
  await scroll.press("ArrowLeft");
  await expect(
    page.locator('[data-weather-section="hourly"] .cursor-readout'),
  ).toContainText("현재 오전 12:15 11°C");
  await expect(
    scroll.locator("svg > g:not(.current-marker)").nth(8).locator("title"),
  ).toContainText("현재 오전 12:15 11°C");
  await page.locator('[data-weather-section="hourly"] details summary').click();
  await expect(
    page
      .locator('[data-weather-section="hourly"] .data-table tbody tr')
      .nth(8)
      .locator("td")
      .nth(2),
  ).toHaveText("오전 12:15 11°");
  await page.locator('[data-weather-section="hourly"] details summary').click();
  expect(
    (await scroll.locator(".yesterday-line").getAttribute("d"))!.match(/M/g),
  ).toHaveLength(1);

  // Remember a column currently in viewport before expanding wind/humidity.
  const visibleBefore = await scroll.evaluate((el) => {
    const sb = el.getBoundingClientRect();
    const cols = [...el.querySelectorAll(".hourly-columns .chart-column")];
    return cols.findIndex((c) => {
      const r = c.getBoundingClientRect();
      return r.left >= sb.left + 48 && r.right <= sb.right - 10;
    });
  });
  expect(visibleBefore).toBeGreaterThanOrEqual(0);

  await page.getByRole("button", { name: "바람·습도 보기", exact: true }).click();
  await expect(page.locator(".chart-extras")).toBeVisible();

  // The previously visible column remains inside the scroll viewport after expansion.
  const leftAfterExpand = await scroll.evaluate((el, idx) => {
    const sb = el.getBoundingClientRect();
    const col = el.querySelectorAll(".hourly-columns .chart-column")[idx];
    const r = col.getBoundingClientRect();
    return { inView: r.right > sb.left && r.left < sb.right, left: r.left };
  }, visibleBefore);
  expect(leftAfterExpand.inView).toBe(true);

  // Refetch with updated observedAt preserves the user's scrolled anchor position.
  await page.getByRole("button", { name: "새로고침" }).click();
  await expect(page.locator(".data-footer")).toContainText("00:25");
  const leftAfterRefetch = await scroll.evaluate((el, idx) => {
    const col = el.querySelectorAll(".hourly-columns .chart-column")[idx];
    return col.getBoundingClientRect().left;
  }, visibleBefore);
  expect(Math.abs(leftAfterRefetch - leftAfterExpand.left)).toBeLessThan(20);

  // Wind direction arrows keep natural size (not stretched to 100% column width).
  const maxArrowWidth = await page
    .locator(".chart-extras .chart-wind-direction svg")
    .evaluateAll((els) =>
      Math.max(...els.map((e) => e.getBoundingClientRect().width)),
    );
  expect(maxArrowWidth).toBeLessThan(30);

  // Clicking an SVG hit target (without force) updates data-cursor.
  const targetIdx = Math.max(0, visibleBefore);
  const hourlyHit = scroll.locator("svg g .chart-hit").nth(targetIdx);
  await hourlyHit.scrollIntoViewIfNeeded();
  // Keep the hit target clear of the bottom toast region.
  await scroll.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await hourlyHit.click({ position: { x: 4, y: 8 } });
  await expect(scroll).toHaveAttribute("data-cursor", String(targetIdx));

  // Forced-colors (including dark high-contrast) resolves dot value fills to Canvas (PR1-R1).
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ forcedColors: "active", colorScheme });
    const forcedFills = await scroll.evaluate((el) => {
      const svg = el.querySelector("svg")!;
      const probe = document.createElementNS("http://www.w3.org/2000/svg", "text");
      probe.style.fill = "Canvas";
      svg.appendChild(probe);
      const canvasBg = getComputedStyle(probe).fill;
      probe.remove();
      const canvasText = getComputedStyle(document.body).color;
      const pt = el.querySelector(".today-point");
      const todayTxt = el.querySelector(".today-value");
      const yestTxt = el.querySelector(".yesterday-value");
      return {
        canvasBg,
        canvasText,
        pt: pt ? getComputedStyle(pt).fill : "",
        todayTxt: todayTxt ? getComputedStyle(todayTxt).fill : "",
        yestTxt: yestTxt ? getComputedStyle(yestTxt).fill : "",
      };
    });
    expect(forcedFills.canvasBg).not.toBe(forcedFills.canvasText);
    expect(forcedFills.pt).toBe(forcedFills.canvasText);
    expect(forcedFills.todayTxt).toBe(forcedFills.canvasBg);
    expect(forcedFills.yestTxt).toBe(forcedFills.canvasBg);
  }
});

for (const lang of ["ko", "fr"] as const)
  test(`daily chart keeps Today unclipped at 390px (${lang}, 100% & 130%) and updates cursor on SVG bar click (#3114)`, async ({
    page,
  }) => {
    await page.addInitScript((language) => {
      localStorage.setItem(
        "tw.web.v1.preferences",
        JSON.stringify({
          version: 1,
          places: [],
          selectedId: null,
          settings: { startup: "hourly", language },
        }),
      );
    }, lang);
    await page.setViewportSize({ width: 390, height: 844 });
    const raw: any = structuredClone(fixture.response);
    raw.current = { ...raw.current, date: "20260922", time: "0900", t1h: 20 };
    raw.midData.dailyData = Array.from({ length: 17 }, (_, i) => ({
      ...raw.midData.dailyData[0],
      date: `202609${String(15 + i).padStart(2, "0")}`,
      time: "0000",
      tmn: 10 + (i % 5),
      tmx: 22 + (i % 5),
      skyAm: "sun",
      skyPm: i === 7 ? "rain" : "sun",
      pop: i === 8 ? 60 : 0,
      r06: i === 8 ? 14.5 : 0,
    }));
    await page.route(API + "/weather/**", (r) => r.fulfill({ json: raw }));
    await page.goto("/weather/seoul/daily");
    const daily = page.locator(".daily-chart");
    await expect(daily).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    for (const scale of ["1", "1.3"]) {
      await page.evaluate((s) => {
        document.documentElement.style.setProperty("--tw-text-scale", s);
        window.dispatchEvent(new Event("resize"));
      }, scale);
      await expect
        .poll(async () =>
          daily.evaluate((el) => {
            const sb = el.getBoundingClientRect();
            const today = el
              .querySelector(".today-column")!
              .getBoundingClientRect();
            return (
              today.left >= sb.left - 2 && today.right <= sb.right + 2
            );
          }),
        )
        .toBe(true);
    }

    // Scroll Tomorrow (index 8) into view and click its SVG group without force.
    const tomorrowGroup = daily.locator("svg > g").nth(8);
    await tomorrowGroup.scrollIntoViewIfNeeded();
    await tomorrowGroup.click();
    await expect(daily).toHaveAttribute("data-cursor", "8");
    await expect(page.locator(".daily-chart-panel .cursor-readout")).toContainText("60%");
  });
