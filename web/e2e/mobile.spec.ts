import { test, expect } from "./fixtures";
import fixture from "../../docs/rewrite/examples/client-kma-response.json" with { type: "json" };

// Phone-sized layout checks from the mobile/Safari screen review.
test.use({ viewport: { width: 320, height: 658 }, hasTouch: true });

type Box = { x: number; y: number; width: number; height: number };
// Boxes closer than `gap` pixels count as overlapping.
const overlaps = (a: Box, b: Box, gap = 4) =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;
const pairs = (boxes: Box[]) =>
  boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => overlaps(a, b)));

test("hourly chart labels stay apart when 1-hour and 3-hour rows mix", async ({
  page,
}) => {
  const raw: any = structuredClone(fixture.response);
  raw.current = { ...raw.current, date: "20260924", time: 23, t1h: 20 };
  raw.shortest = Array.from({ length: 4 }, (_, h) => ({
    date: "20260925",
    time: String(h).padStart(2, "0") + "00",
    t1h: 10 + h,
    rn1: 0,
  }));
  // Twelve 3-hour rows into the next day, as the live API returns them.
  raw.short = Array.from({ length: 12 }, (_, i) => {
    const hour = 6 + i * 3;
    return {
      date: hour < 24 ? "20260925" : "20260926",
      time: hour % 24,
      t3h: 15,
      r06: 0,
    };
  });
  await page.route("https://todayweather.wizardfactory.net/weather/**", (r) =>
    r.fulfill({ json: raw }),
  );
  await page.goto("/weather/seoul/hourly");
  await expect(
    page.locator(".hourly-columns .chart-hour").first(),
  ).toBeVisible();
  const labels = await page
    .locator(".hourly-columns .chart-hour")
    .evaluateAll((els) =>
      els.map((e) => (e as SVGGraphicsElement).getBoundingClientRect()),
    );
  expect(labels.length).toBe(16);
  expect(pairs(labels)).toEqual([]);
});

test("form fields use 16px text on phones so iOS does not zoom on focus", async ({
  page,
}) => {
  await page.goto("/locations");
  const search = page.getByLabel("지역 검색");
  expect(
    parseFloat(await search.evaluate((e) => getComputedStyle(e).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await page.goto("/settings");
  const sizes = await page
    .locator("select, input")
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).fontSize));
  expect(sizes.length).toBeGreaterThan(5);
  expect(sizes.every((n) => parseFloat(n) >= 16)).toBe(true);
});

test("native controls follow the dark theme", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: "다크", exact: true }).check();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  const select = page.getByRole("combobox", { name: "기온", exact: true });
  // Drawn by the page (not the platform) on the dark panel colour.
  await expect(select).toHaveCSS("appearance", "none");
  await expect(select).toHaveCSS("background-color", "rgb(26, 37, 54)");
});

for (const [path, count] of [
  ["/nation/weather", 15],
  ["/nation/air", 10],
] as const)
  test(`${path} map markers do not overlap and show short names`, async ({
    page,
  }) => {
    await page.goto(path);
    const markers = page.locator(".map-canvas svg > g");
    await expect(markers.first()).toBeVisible();
    expect(await markers.count()).toBeGreaterThanOrEqual(count);
    const boxes = await markers.evaluateAll((els) =>
      els.map((e) => e.querySelector("rect")!.getBoundingClientRect()),
    );
    expect(pairs(boxes)).toEqual([]);
    const names = await page.locator(".map-name").allTextContents();
    expect(names.filter((n) => /[시도]$|특|광$/.test(n))).toEqual([]);
  });

test("weather actions keep a 44px touch area on one row", async ({ page }) => {
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  const boxes = await page
    .locator(".weather-page-head .icon-button")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  expect(boxes).toHaveLength(3);
  for (const b of boxes) {
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.top).toBe(boxes[0].top);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
});

test("settings show each chosen value in full and labels on one line", async ({
  page,
}) => {
  await page.goto("/settings");
  const rows = await page.locator(".setting-row").evaluateAll((els) =>
    els
      .filter((row) => row.querySelector("select"))
      .map((row) => {
        const select = row.querySelector("select")!;
        const label = row.querySelector("span")!;
        const style = getComputedStyle(select);
        const ctx = document.createElement("canvas").getContext("2d")!;
        ctx.font = `${style.fontSize} ${style.fontFamily}`;
        const text = select.selectedOptions[0].textContent!;
        const room =
          select.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight);
        return {
          text,
          fits: ctx.measureText(text).width <= room + 1,
          oneLine:
            label.getBoundingClientRect().height <=
            parseFloat(getComputedStyle(label).lineHeight) * 1.5,
        };
      }),
  );
  expect(rows.length).toBeGreaterThan(8);
  expect(rows.filter((r) => !r.fits || !r.oneLine)).toEqual([]);
});

test("long server place names and wind values stay inside a 320 px screen (overseas replay)", async ({
  page,
}) => {
  const raw: any = structuredClone(fixture.response);
  raw.name = "Taepyeongno 1(il)-ga Jongno District";
  raw.current = { ...raw.current, wsd: 42.5, wdd: "NNE" };
  await page.route("https://todayweather.wizardfactory.net/weather/**", (r) =>
    r.fulfill({ json: raw }),
  );
  await page.goto("/weather/p_37.571_126.977/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  const title = page.locator(".place-title");
  await expect(title).toHaveAttribute("title", /Jongno District/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  // The actions keep their row; the name is shortened instead.
  const tops = await page
    .locator(".weather-page-head .icon-button")
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  expect(new Set(tops).size).toBe(1);
});
