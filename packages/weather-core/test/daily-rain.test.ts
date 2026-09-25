import { expect, it } from "vitest";
import { DEFAULT_UNITS, normalizeWeather } from "../src/index";
import fixture from "../../../docs/rewrite/examples/client-kma-response.json";
it("uses daily KMA forecast rain independently of observed accumulated rain", () => {
  const raw: any = structuredClone(fixture.response);
  raw.current.rn1 = 0;
  raw.current.r06 = 9;
  raw.midData.dailyData = [
    { date: raw.current.date, time: "0000", rn1: 0, r06: 25.4, s06: 0 },
  ];
  const w = normalizeWeather(raw, {
    units: { ...DEFAULT_UNITS, precipitationUnit: "in" },
  });
  expect(w.current.precipitation).toBe(0);
  expect(w.daily[0]).toMatchObject({
    precipitation: 1,
    precipitationHours: null,
    snowfall: 0,
  });
  for (const r06 of [undefined, null, -1]) {
    raw.midData.dailyData[0] = {
      date: raw.current.date,
      time: "0000",
      rn1: 8,
      r06,
    };
    expect(normalizeWeather(raw).daily[0].precipitation).toBeNull();
  }
  raw.midData.dailyData[0].r06 = 0;
  expect(normalizeWeather(raw).daily[0].precipitation).toBe(0);
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
