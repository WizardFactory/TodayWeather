import { test, expect } from "./fixtures";
import fixture from "../../docs/rewrite/examples/client-kma-response.json" with { type: "json" };

for (const [mode, width] of [
  ["PWA", 390],
  ["desktop", 1280],
] as const) {
  test(`Korean summary on ${mode} expires at the forecast midnight`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: 850 });
    await page.clock.install({ time: new Date("2026-09-23T14:59:00Z") });
    const text = "오늘 최저 18℃, 최고 26℃, 추분";
    await page.route(
      "https://todayweather.wizardfactory.net/weather/**",
      (route) =>
        route.fulfill({
          json: {
            ...fixture.response,
            current: {
              ...fixture.response.current,
              summary: text,
              summaryForDate: "2026-09-23",
            },
          },
        }),
    );
    await page.goto("/weather/seoul/hourly");
    const hero = page.locator('[data-weather-section="hero"]');
    await expect(hero.getByText(text, { exact: true })).toBeVisible();
    await hero.scrollIntoViewIfNeeded();
    await info.attach("Korean weather summary", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    await expect(hero.getByText(text, { exact: true })).toBeVisible();
    await page.clock.fastForward(60001);
    await expect(hero).not.toContainText("추분");
    await expect(hero.locator(".hero-bottom")).toBeVisible();
  });
}
