import { describe, it, expect } from "vitest";
import {
  coordinates,
  convertValue,
  DEFAULT_UNITS,
  normalizeWeather,
  normalizeNation,
  numberValue,
  rowTime,
} from "../src/index";
import kma from "../../../docs/rewrite/examples/client-kma-response.json";
import world from "../../../docs/rewrite/examples/client-world-response.json";
import full from "../../../docs/rewrite/examples/screenshot-weather.json";

describe("source adapters preserve meteorological meaning", () => {
  it("normalizes KMA, including observed zero rain and yesterday", () => {
    const result = normalizeWeather(kma.response, {
      fetchedAt: "2026-09-24T00:00:00Z",
    });
    expect(result.source).toBe("KMA");
    expect(result.current.temperature).toBe(21);
    expect(result.current.precipitation).toBe(0);
    expect(result.yesterday?.temperature).toBe(20);
    expect(result.location.lon).toBe(126.978);
    expect(result.observedAt).toContain("2026-09-23");
    expect(result.fetchedAt).toBe("2026-09-24T00:00:00Z");
    expect(result.units.temperatureUnit).toBe("C");
  });
  it("recognizes world provider metadata and does not mutate the payload", () => {
    const before = JSON.stringify(world.response);
    const result = normalizeWeather(world.response);
    expect(result.source).toBe("DSF");
    expect(result.current.temperature).toBe(21);
    expect(result.yesterday?.temperature).toBe(20);
    expect(result.daily.length).toBeGreaterThan(0);
    expect(JSON.stringify(world.response)).toBe(before);
  });
  it("keeps station timestamp, pollutant zero and missing air independently", () => {
    const data = structuredClone(full);
    data.airInfoList[0].last.pm25Value = 0;
    const result = normalizeWeather(data);
    expect(result.air[0].pollutants.pm25.value).toBe(0);
    expect(result.air[0].observedAt).toBe("2026-09-23 12:00");
    const partial = normalizeWeather({
      ...data,
      airInfoList: [],
      airInfo: undefined,
      thisTime: [{}, { ...data.thisTime[1], arpltn: undefined }],
    });
    expect(partial.air).toEqual([]);
    expect(partial.availability.air).toBe("unavailable");
  });
  it("rejects unknown source, HTML and application errors instead of guessing world", () => {
    expect(() =>
      normalizeWeather({ source: "unknown", current: {} }),
    ).toThrow();
    expect(() => normalizeWeather("<html>failure</html>")).toThrow();
    expect(() =>
      normalizeWeather({ code: 501, message: "unsupported" }),
    ).toThrow();
    expect(() =>
      normalizeWeather({ ...world.response, thisTime: [] }),
    ).toThrow();
  });
  it("converts using received units exactly once", () => {
    const f = normalizeWeather(kma.response, {
      units: {
        ...DEFAULT_UNITS,
        temperatureUnit: "F",
        precipitationUnit: "in",
        windSpeedUnit: "mph",
      },
    });
    expect(f.current.temperature).toBeCloseTo(69.8);
    expect(f.current.wind).toBeCloseTo(4.47387258);
    expect(f.units.precipitationUnit).toBe("in");
    expect(convertValue(32, "temperature", "F", "C")).toBe(0);
    expect(convertValue(25.4, "precipitation", "mm", "in")).toBeCloseTo(1);
    expect(convertValue(1013.25, "pressure", "hPa", "inHg")).toBeCloseTo(
      29.9213,
      3,
    );
  });
  it("rejects legacy missing-temperature sentinels and past daily forecasts", () => {
    const raw = structuredClone(kma.response);
    raw.current.t1h = -50;
    raw.current.yesterday.t1h = -50;
    raw.midData.dailyData.unshift({
      ...raw.midData.dailyData[0],
      date: "20250401",
    });
    const data = normalizeWeather(raw);
    expect(data.current.temperature).toBeNull();
    expect(data.yesterday?.temperature).toBeNull();
    expect(data.daily.every((p) => p.at >= "2026-09-23")).toBe(true);
  });
  it("does not relabel source air standards", () => {
    expect(() =>
      normalizeWeather(kma.response, {
        units: { ...DEFAULT_UNITS, airUnit: "airnow" },
      }),
    ).toThrow(/standard/i);
  });
});

describe("input and date boundaries", () => {
  it("accepts equator and rejects out of range, empty and non-finite coordinates", () => {
    expect(coordinates(0, 0)).toEqual({ lat: 0, lon: 0 });
    for (const [lat, lon] of [
      [91, 0],
      [0, 181],
      [NaN, 0],
      ["", 0],
      [0, Infinity],
    ])
      expect(() => coordinates(lat, lon)).toThrow();
  });
  it("uses source wall time, including HHMM and next-day 24", () => {
    expect(rowTime({ date: "20261231", time: 24 })).toBe("2027-01-01T00:00");
    expect(rowTime({ date: "20260923", time: "0900" })).toBe(
      "2026-09-23T09:00",
    );
    expect(rowTime({ date: "20260923", time: 9 })).toBe("2026-09-23T09:00");
    expect(rowTime({ date: "20260230", time: 9 })).toBeNull();
  });
  it("distinguishes zero, missing, invalid and subzero temperature", () => {
    expect(numberValue("0")).toBe(0);
    expect(numberValue(-12, true)).toBe(-12);
    for (const v of ["", null, undefined, "-", -999, -1000, NaN])
      expect(numberValue(v)).toBeNull();
  });
});

describe("national city identity", () => {
  it("keeps distinct cities in the same province", () => {
    const data = normalizeNation(
      {
        weather: [
          {
            regionName: "강원도",
            cityName: "춘천시",
            current: kma.response.current,
          },
          {
            regionName: "강원도",
            cityName: "강릉시",
            current: kma.response.current,
          },
        ],
        air: [],
      },
      { units: DEFAULT_UNITS, mode: "live" },
    );
    expect(data.weather.map((r) => r.name)).toEqual(["춘천시", "강릉시"]);
  });
});
