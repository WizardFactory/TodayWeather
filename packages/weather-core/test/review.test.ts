import { describe, expect, it } from "vitest";
import {
  DEFAULT_UNITS,
  normalizeWeather,
  normalizeWarnings,
} from "../src/index";
import sample from "../../../docs/rewrite/examples/client-kma-response.json";
describe("reviewed source boundaries", () => {
  it("preserves actual precipitation periods, null fallback, snow and zero", () => {
    const raw = structuredClone(sample.response) as any;
    raw.current.rn1 = null;
    delete raw.current.r06;
    raw.short = [
      { date: raw.current.date, time: "1500", rn1: -1, r06: 2, s06: 25.4 },
      { date: raw.current.date, time: "1800", rn1: 0, r06: 9 },
    ];
    raw.midData.dailyData = [
      { date: raw.current.date, time: "0000", r06: 8, s06: 0 },
    ];
    const data = normalizeWeather(raw);
    expect(data.current.precipitationHours).toBeNull();
    // Invalid rn1 falls back to the server's 3-hour forecast amounts.
    expect(data.hourly[0]).toMatchObject({
      precipitation: 2,
      precipitationHours: 3,
      precipitationBasis: "forecast",
      snowfall: 25.4,
      snowfallHours: 3,
    });
    // 18:00 ends after the 09:00 observation: an accumulating slot (QA F3).
    expect(data.hourly[1]).toMatchObject({
      precipitation: 0,
      precipitationHours: null,
      precipitationBasis: "partial",
    });
    expect(data.daily[0]).toMatchObject({
      precipitation: 8,
      precipitationHours: null,
      precipitationBasis: "forecast",
    });
    raw.source = "VC";
    raw.thisTime = [{}, { ...raw.current, rn1: 1 }];
    raw.hourly = raw.short;
    raw.daily = raw.midData.dailyData;
    const dsf = normalizeWeather(raw);
    // Overseas (VC) hourly rows are three-hour sums; snow keeps its provider amount.
    expect(dsf.hourly[0]).toMatchObject({
      precipitation: 2,
      precipitationHours: 3,
      snowfall: 25.4,
    });
    const inches = normalizeWeather(raw, {
      units: { ...DEFAULT_UNITS, precipitationUnit: "in" },
    });
    expect(inches.hourly[0].snowfall).toBeCloseTo(1);
  });
  it("upgrades only trusted KMA image links and rejects deceptive hosts", () => {
    const urls = [
      "http://www.weather.go.kr/a.png",
      "https://weather.go.kr/a.png",
      "https://evil.example/a.png",
      "https://weather.go.kr.evil.example/a",
      "https://user@weather.go.kr/a",
      "https://weather.go.kr:8443/a",
    ];
    expect(
      normalizeWarnings(urls.map((imageUrl) => ({ imageUrl }))).map(
        (v) => v.imageUrl,
      ),
    ).toEqual([
      "https://www.weather.go.kr/a.png",
      "https://weather.go.kr/a.png",
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
