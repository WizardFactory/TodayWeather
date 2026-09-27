import { describe, it, expect } from "vitest";
import { DEFAULT_UNITS, normalizeWeather } from "../src/index";
import fixture from "../../../docs/rewrite/examples/client-kma-response.json";
const sample = () => structuredClone(fixture.response) as any;
describe("KMA mixed-interval forecast and provider air summary", () => {
  it("merges valid hourly fields at duplicates, sorts across midnight and retains accumulation periods", () => {
    const raw = sample();
    raw.short = [
      { date: "20260925", time: 3, t3h: 15, r06: 25.4, s06: 25.4, reh: 70 },
      { date: "20260924", time: 24, t3h: 10, r06: 4, reh: 80 },
      { date: "20260925", time: 6, t3h: 17, r06: 6 },
    ];
    raw.shortest = [
      { date: "20260925", time: "0100", t1h: 11, rn1: -1 },
      { date: "20260925", time: "0000", t1h: 12, rn1: 0 },
      { date: "20260925", time: "0300", t1h: -50, rn1: -1, reh: 0 },
      { date: "invalid", time: 2, t1h: 99 },
      { date: "20260925", time: "0200", t1h: 13, rn1: 25.4, sn1: 25.4 },
    ];
    const w = normalizeWeather(raw, {
      units: {
        ...DEFAULT_UNITS,
        temperatureUnit: "F",
        precipitationUnit: "in",
      },
    });
    expect(w.hourly.map((p) => p.at)).toEqual([
      "2026-09-25T00:00",
      "2026-09-25T01:00",
      "2026-09-25T02:00",
      "2026-09-25T03:00",
      "2026-09-25T06:00",
    ]);
    expect(w.hourly[0]).toMatchObject({
      temperature: 53.6,
      precipitation: 0,
      precipitationHours: 1,
      precipitationBasis: "approx",
      humidity: 80,
    });
    expect(w.hourly[1]).toMatchObject({
      precipitation: null,
      precipitationHours: null,
    });
    expect(w.hourly[2]).toMatchObject({
      precipitation: 1,
      precipitationHours: 1,
      precipitationBasis: "approx",
      snowfall: 1,
      snowfallHours: 1,
    });
    // No valid shortest amount at 03:00: the server's 3-hour forecast remains.
    expect(w.hourly[3]).toMatchObject({
      temperature: 59,
      humidity: 0,
      precipitation: 1,
      precipitationHours: 3,
      precipitationBasis: "forecast",
      snowfall: 1,
      snowfallHours: 3,
    });
    expect(w.hourly[4]).toMatchObject({
      precipitationHours: 3,
      precipitationBasis: "forecast",
    });
  });
  it("handles absent/empty shortest and leaves overseas (VC) hourly selection unchanged", () => {
    const raw = sample();
    delete raw.shortest;
    const short = normalizeWeather(raw).hourly;
    raw.shortest = [];
    expect(normalizeWeather(raw).hourly).toEqual(short);
    raw.shortest = [{ date: "20260925", time: "0100", t1h: 88 }];
    raw.source = "VC";
    raw.thisTime = [raw.current, raw.current];
    raw.hourly = [{ date: "20260925", time: 2, t1h: 7, rn1: 0 }];
    raw.daily = [];
    expect(normalizeWeather(raw).hourly).toHaveLength(1);
    expect(normalizeWeather(raw).hourly[0].temperature).toBe(7);
  });
  it("keeps a bounded plain-text summary without inventing numeric air observations", () => {
    const raw = sample();
    delete raw.airInfoList;
    delete raw.airInfo;
    delete raw.current.arpltn;
    raw.current.summaryAir = "  대기상태가 좋아요  ";
    const w = normalizeWeather(raw);
    expect(w.airSummary).toBe("대기상태가 좋아요");
    expect(w.air).toEqual([]);
    expect(w.availability.air).toBe("unavailable");
    raw.current.summaryAir = "x".repeat(700);
    expect(normalizeWeather(raw).airSummary).toHaveLength(500);
    for (const value of [null, {}, [], 42, "  "]) {
      raw.current.summaryAir = value;
      expect(normalizeWeather(raw).airSummary).toBeUndefined();
    }
  });
});
