import { test, expect } from "./fixtures";
import fixture from "../../docs/rewrite/examples/client-kma-response.json" with { type: "json" };
function weather() {
  const raw: any = structuredClone(fixture.response);
  raw.current = { ...raw.current, date: "20260925", time: 12, rn1: 0, sn1: 0 };
  raw.short = [
    {
      date: "20260925",
      time: 15,
      t3h: 22,
      r06: 5,
      r06Hours: 6,
      r06Approx: false,
      s06: 10,
      s06Hours: 6,
    },
    {
      date: "20260925",
      time: 18,
      t3h: 21,
      r06: 40.5,
      r06Hours: 3,
      r06Approx: true,
      s06: 2,
      s06Hours: 2,
      s06Approx: true,
    },
    {
      date: "20260925",
      time: 21,
      t3h: 20,
      r06: 0,
      r06Hours: 0,
      s06: 0,
      s06Hours: 0,
      pop: 65,
    },
  ];
  raw.shortest = [
    { date: "20260925", time: 13, rn1: 2, rn1Approx: false, t1h: 22 },
    { date: "20260925", time: 14, rn1: 0.5, rn1Approx: true, t1h: 22 },
    { date: "20260925", time: 16, rn1: 2, t1h: 22 },
  ];
  raw.midData.dailyData = [
    {
      date: "20260925",
      time: "0000",
      tmn: 18,
      tmx: 24,
      r06: 5.5,
      r06Hours: 24,
      s06: 10,
      s06Hours: 24,
      s06Approx: true,
      pop: 60,
    },
    {
      date: "20260926",
      time: "0000",
      tmn: 18,
      tmx: 24,
      r06: 5.5,
      r06Hours: 21,
      r06Approx: true,
      pop: 60,
    },
  ];
  return raw;
}
function panel(page: import("@playwright/test").Page) {
  return page
    .locator("section.panel")
    .filter({
      has: page.getByRole("heading", { name: "강수·눈 예보", exact: true }),
    });
}
test("D45 coverage and approximation render and survive offline reload", async ({
  page,
  context,
}) => {
  await page.route("https://todayweather.wizardfactory.net/weather/**", (r) =>
    r.fulfill({ json: weather() }),
  );
  await page.goto("/weather/seoul/hourly");
  const forecast = panel(page);
  await expect(forecast).toContainText("강수 5 mm · 6시간 예보");
  await expect(forecast).toContainText("강수 약 40.5 mm · 3시간 예보");
  await expect(forecast).toContainText("적설량 10 mm · 6시간 예보");
  await expect(forecast).toContainText("적설량 약 2 mm · 2시간 예보");
  await expect(forecast).toContainText("강수확률 65%");
  await expect(forecast).not.toContainText("0시간");
  await expect(forecast).toContainText("강수 2 mm · 1시간 예보");
  await expect(forecast).toContainText("강수 약 2 mm · 1시간 예보(근사)");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(forecast).toContainText("강수 5 mm · 6시간 예보");
  await expect(forecast).toContainText("강수 약 40.5 mm · 3시간 예보");
  await context.setOffline(false);
  await page.goto("/weather/seoul/daily");
  await expect(forecast).toContainText("강수 5.5 mm · 24시간 예보");
  await expect(forecast).toContainText("강수 약 5.5 mm · 21시간 예보");
  await expect(forecast).toContainText("적설량 약 10 mm · 24시간 예보");
  await context.setOffline(true);
  await page.reload();
  await expect(forecast).toContainText("강수 약 5.5 mm · 21시간 예보");
  await expect(forecast).toContainText("적설량 약 10 mm · 24시간 예보");
  await context.setOffline(false);
});
test("legacy daily forecast keeps its original label", async ({ page }) => {
  const raw = weather();
  raw.shortest = [];
  raw.midData.dailyData = [
    { date: "20260925", time: "0000", r06: 5.5, pop: 60 },
  ];
  await page.route("https://todayweather.wizardfactory.net/weather/**", (r) =>
    r.fulfill({ json: raw }),
  );
  await page.goto("/weather/seoul/daily");
  await expect(panel(page)).toContainText("강수 5.5 mm · 예보");
  await expect(panel(page)).not.toContainText("시간 예보");
});
