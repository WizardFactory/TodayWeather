import { test, expect } from "./fixtures";
import fixture from "../../docs/rewrite/examples/client-kma-response.json" with { type: "json" };
import dsf from "../src/demo/weather.json" with { type: "json" };
test("KMA mixed intervals and unverified air summary survive static offline reload", async ({
  page,
  context,
}) => {
  const raw: any = structuredClone(fixture.response);
  raw.current = {
    ...raw.current,
    date: "20260924",
    time: 23,
    t1h: 20,
    summaryAir: "<b>대기상태가 좋아요</b>",
  };
  delete raw.airInfoList;
  delete raw.airInfo;
  delete raw.current.arpltn;
  raw.short = [
    { date: "20260925", time: 0, t3h: 9, r06: 3 },
    { date: "20260925", time: 3, t3h: 14, r06: 6 },
    { date: "20260925", time: 6, t3h: 16, r06: 9 },
  ];
  raw.shortest = [
    { date: "20260925", time: "0000", t1h: 10, rn1: 0 },
    { date: "20260925", time: "0100", t1h: 11, rn1: -1 },
    { date: "20260925", time: "0200", t1h: 12, rn1: 1 },
    { date: "20260925", time: "0300", t1h: 13, rn1: -1 },
  ];
  await page.route(
    "https://todayweather.wizardfactory.net/weather/**",
    (route) => route.fulfill({ json: raw }),
  );
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  await page.getByText("시간별 상세 수치 보기", { exact: true }).click();
  const rows = page.locator(".data-table tbody tr");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(1)).toContainText("01");
  await expect(rows.nth(1).locator("td").nth(1)).toHaveText("11");
  const rain = page.locator("section.panel").filter({
    has: page.getByRole("heading", { name: "강수·눈 예보", exact: true }),
  });
  // Shortest rn1 is an approximate 1-hour category; short r06 is the server's
  // three-hour forecast where no shortest amount replaces it.
  await expect(rain).toContainText("강수 0 mm · 1시간 예보(근사)");
  await expect(rain).toContainText("강수 1 mm 이하 · 1시간 예보(근사)");
  await expect(rain).toContainText("강수 6 mm · 3시간 예보");
  await expect(rain).toContainText("강수 9 mm · 3시간 예보");
  const note = page.getByRole("note");
  await expect(note).toContainText("<b>대기상태가 좋아요</b>");
  await expect(note.locator("b")).toHaveCount(0);
  await expect(note).toContainText("관측 시각 미확인");
  await page.getByRole("button", { name: "미세먼지", exact: true }).click();
  await expect(
    page.getByText("대기질 관측 자료가 없습니다", { exact: true }),
  ).toBeVisible();
  await expect(note).toContainText("측정값이 아닌 제공사 요약");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.unroute("https://todayweather.wizardfactory.net/**");
  await page.unroute("https://todayweather.wizardfactory.net/weather/**");
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText("저장된 자료", { exact: false }).first(),
  ).toBeVisible();
  await expect(note).toContainText("관측 시각 미확인");
  await context.setOffline(false);
});
test("measured air remains primary and does not show the summary fallback", async ({
  page,
}) => {
  const raw = structuredClone(dsf) as any;
  raw.thisTime[1].summaryAir = "Fallback must not replace observations";
  await page.route(
    "https://todayweather.wizardfactory.net/weather/**",
    (route) => route.fulfill({ json: raw }),
  );
  await page.goto("/weather/seoul/hourly");
  await expect(page.locator(".temperature")).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);
  await page.getByRole("button", { name: "미세먼지", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "대기질 관측", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);
});
