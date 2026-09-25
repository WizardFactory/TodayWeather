import { test, expect } from "./fixtures";
import fixture from "../../docs/rewrite/examples/client-kma-response.json" with { type: "json" };
function weather() {
  const raw: any = structuredClone(fixture.response);
  raw.current = { ...raw.current, date: "20260925", time: 12, rn1: 0, sn1: 0 };
  raw.short = [
    { date: "20260925", time: 15, t3h: 22, r06: 4, s06: 0 },
    { date: "20260925", time: 18, t3h: 21, r06: 0, s06: 0.01 },
  ];
  raw.shortest = [];
  raw.midData.dailyData = [
    {
      date: "20260925",
      time: "0000",
      tmn: 18,
      tmx: 24,
      rn1: 0,
      r06: 4,
      s06: 0,
      pop: 60,
    },
  ];
  return raw;
}
test("KMA daily rain shows the server forecast over accumulated observations and zero snow stays hidden", async ({
  page,
  context,
}) => {
  await page.route("https://todayweather.wizardfactory.net/weather/**", (r) =>
    r.fulfill({ json: weather() }),
  );
  await page.goto("/weather/seoul/daily");
  const forecast = page.locator("section.panel").filter({
    has: page.getByRole("heading", { name: "강수·눈 예보", exact: true }),
  });
  await expect(forecast).toContainText("강수 4 mm · 예보");
  await expect(forecast).not.toContainText("24시간");
  await expect(forecast).not.toContainText("적설량");
  await expect(
    page.locator(".metric").filter({ hasText: "적설량" }),
  ).toHaveCount(0);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(forecast).toContainText("강수 4 mm · 예보");
  await context.setOffline(false);
  await page.goto("/weather/seoul/hourly");
  await expect(forecast).toContainText("적설량 <0.1 mm · 3시간 예보");
  await expect(forecast).not.toContainText("적설량 0 mm");
});
test("warning instants display Korea time despite the viewer timezone", async ({
  browser,
}) => {
  const context = await browser.newContext({
    timezoneId: "America/Los_Angeles",
  });
  const page = await context.newPage();
  try {
    await page.route(
      "https://todayweather.wizardfactory.net/v000903/kma/special",
      (r) =>
        r.fulfill({
          json: [
            {
              name: "시각 검증",
              announcement: "2021-06-16T21:00:00.000Z",
              situationList: [],
            },
          ],
        }),
    );
    await page.goto("/warnings");
    await expect(page.locator(".bulletin .stamp")).toHaveText(
      "발표 2021-06-17 06:00:00 KST",
    );
    await expect(page.locator(".bulletin")).toContainText("발표일이 지난 자료");
  } finally {
    await context.close();
  }
});
test("an overseas network failure has safe Korean guidance and supports retry", async ({
  page,
}) => {
  let fail = true;
  await page.route(
    "https://todayweather.wizardfactory.net/weather/**",
    async (r) => (fail ? r.abort("failed") : r.fulfill({ json: weather() })),
  );
  await page.goto("/weather/tokyo/hourly");
  await expect(page.getByRole("alert")).toContainText("연결하지 못했습니다");
  await expect(page.getByRole("alert")).not.toContainText("Failed to fetch");
  fail = false;
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.locator(".temperature")).toBeVisible();
});
