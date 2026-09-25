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
    expect(data.hourly[0].precipitation).toBe(2);
    expect(data.hourly[0].precipitationHours).toBe(3);
    expect((data.hourly[0] as any).snowfall).toBe(25.4);
    expect(data.hourly[1].precipitation).toBe(0);
    expect(data.hourly[1].precipitationHours).toBe(3);
    expect(data.daily[0].precipitationHours).toBeNull();
    const inches = normalizeWeather(raw, {
      units: { ...DEFAULT_UNITS, precipitationUnit: "in" },
    });
    expect((inches.hourly[0] as any).snowfall).toBeCloseTo(1);
    raw.source = "DSF";
    raw.thisTime = [{}, { ...raw.current, rn1: 1 }];
    raw.hourly = raw.short;
    raw.daily = raw.midData.dailyData;
    expect(normalizeWeather(raw).hourly[0].precipitationHours).toBe(1);
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
