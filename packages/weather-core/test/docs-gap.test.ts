import { describe, expect, it } from "vitest";
import {
  convertValue,
  DEFAULT_UNITS,
  normalizeWarnings,
  normalizeWeather,
  shortenAddress,
  sourceTime,
} from "../src/index";
import kmaFixture from "../../../docs/rewrite/examples/client-kma-response.json";
import worldFixture from "../../../docs/rewrite/examples/client-world-response.json";
const kma = () => structuredClone(kmaFixture.response) as any;
const world = () => structuredClone(worldFixture.response) as any;

describe("source time and value formats from the rewrite contracts", () => {
  it("parses KMA station and dotted wall times without inventing a timezone", () => {
    expect(sourceTime("2026.09.23.09:00")).toBe("2026-09-23 09:00");
    expect(sourceTime("2026.09.23 09:00")).toBe("2026-09-23 09:00");
    expect(sourceTime("2026-09-23 09:00")).toBe("2026-09-23 09:00");
    expect(sourceTime("202609230500")).toBe("2026-09-23T05:00");
    expect(normalizeWeather(kma()).observedAt).toBe("2026-09-23 09:00");
  });
  it("uses the server Beaufort band edges", () => {
    const bft = (ms: number) => convertValue(ms, "wind", "m/s", "bft");
    expect([0.29, 0.3, 1.49, 1.5, 3.3, 20.7, 28.4, 32.6].map(bft)).toEqual([
      0, 1, 1, 2, 3, 9, 11, 12,
    ]);
  });
  it("reduces sunrise and sunset to the displayed clock time", () => {
    const w = normalizeWeather(kma());
    const today = w.daily.find((p) => p.at.startsWith("2026-09-23"));
    expect(today?.sunrise).toBe("06:20");
    expect(today?.sunset).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("accumulation periods", () => {
  it("labels DSF hourly rows as three-hour sums", () => {
    const raw = world();
    raw.hourly[3].rn1 = 2.4;
    raw.hourly[4].s06 = 1;
    const w = normalizeWeather(raw);
    expect(w.hourly[3]).toMatchObject({
      precipitation: 2.4,
      precipitationHours: 3,
    });
    expect(w.hourly[4].snowfallHours).toBe(3);
  });
  it("shows KMA daily snow and rain as server-calculated forecasts without a duration", () => {
    const raw = kma();
    raw.midData.dailyData = [
      { date: raw.current.date, time: "0000", r06: 1, s06: 2 },
    ];
    expect(normalizeWeather(raw).daily[0]).toMatchObject({
      snowfall: 2,
      snowfallHours: null,
      precipitation: 1,
      precipitationHours: null,
      precipitationBasis: "forecast",
    });
  });
});

describe("daily history and details", () => {
  it("keeps yesterday's daily row and drops the old past-forecast notice", () => {
    const w = normalizeWeather(kma());
    expect(w.daily[0].at.slice(0, 10)).toBe("2026-09-22");
    expect(w.notices.join(" ")).not.toContain("과거 예보");
    const raw = kma();
    raw.midData.dailyData.unshift({
      date: "20260920",
      time: "0000",
      tmn: 1,
      tmx: 2,
    });
    expect(
      normalizeWeather(raw).daily.some((p) => p.at.startsWith("2026-09-20")),
    ).toBe(false);
  });
  it("exposes UV, discomfort and food-poisoning texts when supplied", () => {
    const raw = kma();
    raw.current.dspls = 72;
    raw.current.dsplsStr = "보통";
    const today = raw.midData.dailyData.find(
      (d: any) => d.date === raw.current.date,
    );
    Object.assign(today, {
      ultrv: 7,
      ultrvGrade: 2,
      ultrvStr: "높음",
      fsnGrade: 1,
      fsnStr: "주의",
    });
    const w = normalizeWeather(raw);
    expect(w.current.discomfort).toBe("보통 (72)");
    const t = w.daily.find((p) => p.at.startsWith("2026-09-23"))!;
    expect(t.uv).toBe("높음 (7)");
    expect(t.foodPoisoning).toBe("주의");
    raw.current.dspls = 55;
    expect(normalizeWeather(raw).current.discomfort).toBe("");
  });
  it("records the short forecast publication time", () => {
    expect(normalizeWeather(kma()).forecastPublishedAt).toBe(
      "2026-09-23T05:00",
    );
    expect(normalizeWeather(world()).forecastPublishedAt).toBeNull();
  });
});

describe("air contract", () => {
  it("keeps forecast source, publication, per-pollutant stations and forecast rows", () => {
    const raw = kma();
    const station = raw.airInfoList[0];
    station.last.pm25StationName = "Other Station";
    station.pollutants.aqi.hourly.push({
      date: "2026-09-23 12:00",
      val: 60,
      grade: 2,
      pubDate: "2026-09-23 05:00",
    });
    const air = normalizeWeather(raw).air[0];
    expect(air.forecastSource).toBe("kaq");
    expect(air.forecastPublishedAt).toBe("2026-09-23 08:00");
    expect(air.pollutants.pm25.station).toBe("Other Station");
    expect(air.pollutants.pm10.station).toBe("");
    const hourly = air.pollutants.aqi.hourly;
    expect(hourly.at(-1)).toMatchObject({ forecast: true, value: 60 });
    expect(hourly[0].forecast).toBe(false);
  });
});

describe("warnings and geography", () => {
  it("keeps the numeric warning type and the note rule", () => {
    const [a, b, c] = normalizeWarnings([
      { name: "특보", type: 1 },
      { name: "정보", type: 3 },
      { name: "문자", type: "1" },
    ]);
    expect([a.type, a.note]).toEqual([1, true]);
    expect([b.type, b.note]).toEqual([3, false]);
    expect([c.type, c.note]).toEqual([null, false]);
  });
  it("shortens Korean addresses like the mobile display helper", () => {
    expect(shortenAddress("대한민국 서울특별시")).toBe("서울시");
    expect(shortenAddress("대한민국 서울특별시 중구")).toBe("서울시 중구");
    expect(shortenAddress("대한민국 경기도 광주시 오포읍")).toBe(
      "광주시 오포읍",
    );
    expect(shortenAddress("대한민국 경기도 고양시 덕양구 고양동")).toBe(
      "고양시 고양동",
    );
    expect(shortenAddress("대한민국 부산광역시 해운대구 우동")).toBe(
      "부산시 우동",
    );
    expect(
      shortenAddress("대한민국 제주특별자치도 제주시 애월읍 애월리 1"),
    ).toBe("");
    expect(shortenAddress("Tokyo, Japan")).toBe("Japan");
    expect(shortenAddress("")).toBe("");
  });
  it("keeps units unchanged for default requests", () => {
    expect(normalizeWeather(kma()).units).toEqual(DEFAULT_UNITS);
  });
});

describe("D45 KMA precipitation semantics", () => {
  it("shows observed past amounts and server-calculated forecast amounts", () => {
    const raw = kma();
    raw.current.rn1 = 0.5;
    raw.short = [
      { date: "20260923", time: 6, t3h: 18, rn1: 2.5, r06: 9 },
      { date: "20260923", time: 12, t3h: 20, r06: 4, s06: 10, pop: 60 },
    ];
    raw.shortest = [
      { date: "20260923", time: "1000", t1h: 19, rn1: 3 },
      { date: "20260923", time: "1100", t1h: 19, rn1: -1 },
    ];
    raw.midData.dailyData = [
      { date: "20260922", time: "0000", rn1: 7, r06: 12, s06: 5 },
      { date: "20260923", time: "0000", rn1: 1, r06: 4, s06: 0, pop: 60 },
      { date: "20260924", time: "0000", r06: 8, pop: 80 },
    ];
    const w = normalizeWeather(raw);
    expect(w.current).toMatchObject({
      precipitation: 0.5,
      precipitationHours: 1,
      precipitationBasis: "observed",
    });
    const at = (t: string) => w.hourly.find((p) => p.at === t)!;
    expect(at("2026-09-23T06:00")).toMatchObject({
      precipitation: 2.5,
      precipitationHours: 3,
      precipitationBasis: "observed",
    });
    expect(at("2026-09-23T10:00")).toMatchObject({
      precipitation: 3,
      precipitationHours: 1,
      precipitationBasis: "approx",
    });
    expect(at("2026-09-23T11:00").precipitation).toBeNull();
    expect(at("2026-09-23T12:00")).toMatchObject({
      precipitation: 4,
      precipitationHours: 3,
      precipitationBasis: "forecast",
      snowfall: 10,
      snowfallHours: 3,
      rainProbability: 60,
    });
    // Past days: observed accumulation; today and later: the server's daily forecast.
    expect(w.daily.map((p) => p.precipitation)).toEqual([7, 4, 8]);
    expect(w.daily[0]).toMatchObject({
      precipitationHours: null,
      precipitationBasis: "observed",
      snowfall: null,
    });
    expect(w.daily[1]).toMatchObject({
      precipitationHours: null,
      precipitationBasis: "forecast",
      snowfall: 0,
      snowfallHours: null,
    });
  });
  it("keeps DSF amounts as provider forecasts", () => {
    const raw = world();
    raw.daily[1].r06 = 4;
    const d = normalizeWeather(raw).daily[1];
    expect(d).toMatchObject({
      precipitation: 4,
      precipitationHours: 24,
      precipitationBasis: null,
    });
  });
});

describe("QA corrections", () => {
  it("F2: marks hourly air rows after the latest observation as forecasts even without pubDate", () => {
    const raw = kma();
    raw.airInfoList[0].pollutants.aqi.hourly.push({
      date: "2026-09-23 12:00",
      val: 61,
      grade: 2,
    });
    const aqi = normalizeWeather(raw).air[0].pollutants.aqi.hourly;
    expect(aqi.find((h) => h.at === "2026-09-23 09:00")?.forecast).toBe(false);
    expect(aqi.find((h) => h.at === "2026-09-23 12:00")?.forecast).toBe(true);
  });
  it("F3: marks the in-progress three-hour observation slot as partial", () => {
    const raw = kma();
    raw.current.time = 10;
    raw.short = [
      { date: "20260923", time: 9, t3h: 18, rn1: 2 },
      { date: "20260923", time: 12, t3h: 20, rn1: 0.5 },
    ];
    raw.shortest = [];
    const h = normalizeWeather(raw).hourly;
    expect(h[0]).toMatchObject({
      precipitationBasis: "observed",
      precipitationHours: 3,
    });
    expect(h[1]).toMatchObject({
      precipitation: 0.5,
      precipitationBasis: "partial",
      precipitationHours: null,
    });
  });
});

it("QA NIT: compares air forecast times independent of T/space and seconds", () => {
  const raw = kma();
  raw.airInfoList[0].last.dataTime = "2026-09-23T09:00:00";
  raw.airInfoList[0].pollutants.aqi.hourly.push({
    date: "2026-09-23 09:00",
    val: 1,
    grade: 1,
  });
  raw.airInfoList[0].pollutants.aqi.hourly.push({
    date: "2026-09-23 10:00",
    val: 2,
    grade: 1,
  });
  const aqi = normalizeWeather(raw).air[0].pollutants.aqi.hourly;
  expect(
    aqi.filter((h) => h.at === "2026-09-23 09:00").every((h) => !h.forecast),
  ).toBe(true);
  expect(aqi.find((h) => h.at === "2026-09-23 10:00")?.forecast).toBe(true);
});
