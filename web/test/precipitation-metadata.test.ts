import { expect, it } from "vitest";
import { normalizeWeather, PLACES } from "@todayweather/core";
import { precipitationAmount, forecastAmount } from "../src/format";
import { validateSnapshot, weatherKey } from "../src/state";
import fixture from "../../docs/rewrite/examples/client-kma-response.json";
it("keeps covered forecast periods and approximation in persisted weather", () => {
  const raw: any = structuredClone(fixture.response);
  raw.shortest = [];
  raw.short = [
    {
      date: raw.current.date,
      time: 21,
      r06: 40.5,
      r06Hours: 6,
      r06Approx: true,
      s06: 10,
      s06Hours: 2,
      s06Approx: true,
    },
  ];
  raw.midData.dailyData = [
    { date: raw.current.date, time: "0000", r06: 5.5, r06Hours: 21 },
  ];
  const now = Date.now();
  const w = normalizeWeather(raw, {
    location: PLACES[0],
    fetchedAt: new Date(now).toISOString(),
  });
  const key = weatherKey(w.location, w.units);
  expect(validateSnapshot({ weather: w, savedAt: now }, key, now)).toEqual(w);
  const p = w.hourly[0];
  expect(precipitationAmount(p, "mm")).toBe("약 40.5 mm");
  expect(forecastAmount(p.snowfall, "mm", p.snowfallApprox)).toBe("약 10 mm");
  for (const patch of [
    { precipitationHours: Infinity },
    { snowfallHours: "6" },
    { precipitationApprox: "true" },
    { snowfallApprox: 1 },
    { snowfallBasis: "invalid" },
  ]) {
    const bad = { ...w, hourly: [{ ...p, ...patch }] };
    expect(
      validateSnapshot({ weather: bad, savedAt: now }, key, now),
    ).toBeUndefined();
  }
});
