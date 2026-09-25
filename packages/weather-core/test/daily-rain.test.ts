import { expect, it } from "vitest";
import { DEFAULT_UNITS, normalizeWeather } from "../src/index";
import fixture from "../../../docs/rewrite/examples/client-kma-response.json";
it("uses observed accumulation for past KMA days and the server forecast from today on", () => {
  const raw: any = structuredClone(fixture.response);
  raw.current.rn1 = 0;
  raw.midData.dailyData = [
    { date: "20260922", time: "0000", rn1: 25.4, r06: 3 },
    { date: raw.current.date, time: "0000", rn1: 0, r06: 25.4, s06: 0 },
  ];
  const w = normalizeWeather(raw, {
    units: { ...DEFAULT_UNITS, precipitationUnit: "in" },
  });
  expect(w.current).toMatchObject({
    precipitation: 0,
    precipitationBasis: "observed",
  });
  expect(w.daily[0]).toMatchObject({
    precipitation: 1,
    precipitationHours: null,
    precipitationBasis: "observed",
  });
  expect(w.daily[1]).toMatchObject({
    precipitation: 1,
    precipitationHours: null,
    precipitationBasis: "forecast",
    snowfall: 0,
  });
  for (const rn1 of [undefined, null, -1]) {
    raw.midData.dailyData[0] = { date: "20260922", time: "0000", rn1, r06: 8 };
    expect(normalizeWeather(raw).daily[0].precipitation).toBeNull();
  }
});
it("preserves DSF daily rain and current/hourly zero precedence", () => {
  const raw: any = structuredClone(fixture.response);
  raw.current.rn1 = 0;
  raw.current.r06 = 8;
  raw.short = [{ date: raw.current.date, time: 15, rn1: 0, r06: 8 }];
  expect(normalizeWeather(raw).hourly[0].precipitation).toBe(0);
  raw.source = "DSF";
  raw.thisTime = [raw.current, raw.current];
  raw.hourly = raw.short;
  raw.daily = [{ date: raw.current.date, time: "0000", rn1: 0, r06: 8 }];
  expect(normalizeWeather(raw).daily[0]).toMatchObject({
    precipitation: 0,
    precipitationHours: 24,
  });
});
