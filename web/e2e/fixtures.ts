import { test as base, expect } from "@playwright/test";
import weather from "../src/demo/weather.json" with { type: "json" };
import nation from "../src/demo/nation.json" with { type: "json" };
import warnings from "../src/demo/warnings.json" with { type: "json" };
import { PLACES } from "@todayweather/core";
export const test = base.extend({
  page: async ({ page }, use) => {
    const forbidden: string[] = [],
      cspViolations: string[] = [];
    // The preview serves the production CSP; any violation is a release blocker.
    page.on("console", (m) => {
      if (
        /Content Security Policy|Refused to (apply|load|execute|connect)/i.test(
          m.text(),
        )
      )
        cspViolations.push(m.text());
    });
    page.on("request", (req) => {
      if (new URL(req.url()).pathname.startsWith("/api/"))
        forbidden.push(req.url());
    });
    await page.route(
      "https://todayweather.wizardfactory.net/**",
      async (route) => {
        const u = new URL(route.request().url());
        if (u.pathname.startsWith("/weather/v000903/coord/")) {
          const [lat, lon] = u.pathname
            .split("/")
            .at(-1)!
            .split(",")
            .map(Number);
          const p = PLACES.find(
            (p) =>
              Math.abs(p.lat - lat) < 0.015 && Math.abs(p.lon - lon) < 0.015,
          );
          return route.fulfill({
            json: {
              ...structuredClone(weather),
              name: p?.name ?? "선택한 지역",
              country: p?.country ?? "KR",
              address: p?.address ?? "",
              location: { lat, long: lon },
            },
          });
        }
        if (u.pathname.startsWith("/geocode/v000903/"))
          return route.fulfill({
            json: {
              name: "서울",
              country: "KR",
              address: "대한민국 서울",
              location: { lat: 37.567, long: 126.978 },
            },
          });
        if (u.pathname === "/v000903/nation/KR")
          return route.fulfill({ json: nation });
        if (u.pathname === "/v000903/kma/special")
          return route.fulfill({ json: warnings });
        return route.abort();
      },
    );
    await use(page);
    expect(
      forbidden,
      "Static build must not call same-origin API routes",
    ).toEqual([]);
    expect(cspViolations, "Content Security Policy violations").toEqual([]);
  },
});
export { expect };
