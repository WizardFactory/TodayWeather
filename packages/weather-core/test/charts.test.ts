import { expect, it } from "vitest";
import {
  dailyChart,
  hourlyChart,
  linePath,
  normalizeWeather,
} from "../src";
import fixture from "../../../docs/rewrite/examples/client-kma-response.json";
const base = normalizeWeather(fixture.response);
const point = (at: string, temperature: number | null) => ({
  ...base.current,
  at,
  temperature,
});
it("charts one column per three-hour row and marks an off-hour observation between columns", () => {
  const hourly = Array.from({ length: 24 }, (_, i) =>
    point(
      `2026-09-${21 + Math.floor(i / 8)}T${String((i % 8) * 3).padStart(2, "0")}:00`,
      i,
    ),
  );
  const model = hourlyChart({
    hourly: hourly.reverse(),
    current: point("2026-09-23T10:30", -20),
    yesterday: point("2026-09-22T10:30", -50),
  });
  // Yesterday and today, eight rows each: no column for the observation.
  expect(model.rows).toHaveLength(16);
  expect(model.rows.some((r) => r.current)).toBe(false);
  expect(model.rows[model.currentIndex].point.at).toBe("2026-09-23T09:00");
  expect(model.current).toEqual({
    index: model.currentIndex + 0.5,
    at: "2026-09-23T10:30",
    temperature: -20,
    yesterday: -50,
  });
  expect(model.domain[0]).toBeLessThan(-50);
  expect(model.startIndex).toBe(model.currentIndex - 1);
});
it("charts the three-hour series instead of the merged one-hour rows", () => {
  const model = hourlyChart({
    hourly: [
      point("2026-09-23T09:00", 1),
      point("2026-09-23T10:00", 2),
      point("2026-09-23T11:00", 3),
      point("2026-09-23T12:00", 4),
    ],
    chartHourly: [point("2026-09-23T09:00", 10), point("2026-09-23T12:00", 40)],
    current: point("2026-09-23T09:00", 9),
    yesterday: null,
  });
  expect(model.rows.map((r) => r.point.temperature)).toEqual([9, 40]);
  expect(model.rows[0].current).toBe(true);
  expect(model.current).toBeNull();
});
it("puts the observation on a column only when it was made at the column time (native sharp)", () => {
  const hourly = [
    point("2026-09-23T06:00", 6),
    point("2026-09-23T09:00", 9),
    point("2026-09-23T12:00", 12),
  ];
  const at9 = { hourly, current: point("2026-09-23T09:00", 20), yesterday: null };
  // KMA current time 9 with liveTime 0915: a marker between 09:00 and 12:00.
  const late = hourlyChart({ ...at9, liveAt: "2026-09-23T09:15" });
  expect(late.rows.some((r) => r.current)).toBe(false);
  expect(late.rows[late.currentIndex].point.temperature).toBe(9);
  expect(late.current).toMatchObject({ index: 1.5, at: "2026-09-23T09:15", temperature: 20 });
  // liveTime 0900 (or none): the 09:00 column carries the observation.
  for (const sharp of [hourlyChart({ ...at9, liveAt: "2026-09-23T09:00" }), hourlyChart(at9)]) {
    expect(sharp.rows[sharp.currentIndex].current).toBe(true);
    expect(sharp.rows[sharp.currentIndex].point.temperature).toBe(20);
    expect(sharp.current).toBeNull();
  }
});
it("keeps only three-hour slots for KMA snapshots saved without chartHourly", () => {
  const model = hourlyChart({
    source: "KMA",
    hourly: [
      point("2026-09-23T09:00", 9),
      point("2026-09-23T10:00", 10),
      point("2026-09-23T12:00", 12),
    ],
    current: point("2026-09-23T09:00", 9),
    yesterday: null,
  });
  expect(model.rows.map((r) => r.point.at)).toEqual([
    "2026-09-23T09:00",
    "2026-09-23T12:00",
  ]);
});
it("reads the KMA observation time from liveTime", () => {
  expect(base.liveAt).toBe("2026-09-23T09:00");
  const raw = structuredClone(fixture.response) as Record<string, any>;
  raw.current.liveTime = "0915";
  expect(normalizeWeather(raw).liveAt).toBe("2026-09-23T09:15");
  // Server wire shape after midnight: 00h is the previous day's 24h.
  Object.assign(raw.current, { date: "20260922", time: 24, liveTime: "0015" });
  const midnight = normalizeWeather(raw);
  expect(midnight.current.at).toBe("2026-09-23T00:00");
  expect(midnight.liveAt).toBe("2026-09-23T00:15");
  const model = hourlyChart(midnight);
  expect(model.rows.some((r) => r.current)).toBe(false);
});
it("keeps only the KMA short rows in the chart series", () => {
  const shortTimes = new Set(
    (fixture.response.short as { date: string; time: string | number }[]).map(
      (r) => `${r.date}${r.time}`,
    ),
  );
  expect(base.chartHourly).toBeDefined();
  expect(base.chartHourly!.length).toBe(shortTimes.size);
  expect(base.hourly.length).toBeGreaterThanOrEqual(base.chartHourly!.length);
});
it("starts the hourly rows at yesterday 00:00 and keeps day-before-yesterday only as comparison data", () => {
  const hourly = Array.from({ length: 60 }, (_, i) => {
    const day = 21 + Math.floor(i / 24);
    return point(
      `2026-09-${day}T${String(i % 24).padStart(2, "0")}:00`,
      day === 21 ? 100 + i : i % 24,
    );
  });
  const model = hourlyChart({
    hourly,
    current: point("2026-09-23T10:30", 11),
    yesterday: point("2026-09-22T10:30", 9),
  });
  expect(model.rows[0].point.at).toBe("2026-09-22T00:00");
  expect(model.rows.some((r) => r.point.at.startsWith("2026-09-21"))).toBe(false);
  // Yesterday's columns still compare against the day before.
  expect(model.rows[5].yesterday?.temperature).toBe(105);
  expect(model.rows[model.currentIndex].point.at).toBe("2026-09-23T10:00");
  expect(model.rows[model.startIndex].point.at).toBe("2026-09-23T09:00");
});
it("keeps every hourly row when the current time cannot be read", () => {
  const model = hourlyChart({
    hourly: [point("2026-09-21T23:00", 1), point("2026-09-23T01:00", 2)],
    current: point("not-a-time", 3),
    yesterday: null,
  });
  expect(model.rows).toHaveLength(2);
});
it("omits an observation outside the forecast extent and preserves null gaps", () => {
  const model = hourlyChart({
    hourly: [
      point("2026-09-23T01:00", 5),
      point("2026-09-23T02:00", null),
      point("2026-09-23T03:00", 8),
    ],
    current: point("2026-09-23T10:00", 999),
    yesterday: null,
  });
  expect(model.currentIndex).toBe(-1);
  expect(model.domain[1]).toBeLessThan(999);
  expect(
    linePath(
      model.rows.map((r) => r.point.temperature),
      (i) => i,
      (v) => v,
    ),
  ).toBe("M0,5 M2,8");
});
it("shares a daily axis with the actual current observation, retains past days and omits incomplete ranges", () => {
  const daily = ["20", "21", "22", "23", "24"].map((day) => ({
    ...point(`2026-09-${day}T00:00`, null),
    low: -5,
    high: 5 as number | null,
    icon: "sun",
    iconPm: "sun",
  }));
  daily[4].high = null;
  const model = dailyChart({ daily, current: point("2026-09-23T10:00", 20) });
  expect(model.rows).toHaveLength(5);
  expect(model.rows.filter((r) => r.past)).toHaveLength(3);
  expect(model.todayIndex).toBe(3);
  expect(model.startIndex).toBe(1);
  expect(model.rows[4].validRange).toBe(false);
  expect(model.domain[1]).toBeGreaterThan(20);
  expect(model.rows.every((r) => r.mergedIcons)).toBe(true);
});

it.each([
  { low: null, high: 35 },
  { low: -20, high: null },
])(
  "includes the surviving partial extremum $low/$high in the daily domain",
  (partial) => {
    const daily = [
      { ...point("2026-09-23T00:00", null), low: 10, high: 25 },
      { ...point("2026-09-24T00:00", null), ...partial },
    ];
    const model = dailyChart({ daily, current: point("2026-09-23T12:00", 20) });
    expect(model.rows[1].validRange).toBe(false);
    const value = partial.low ?? partial.high!;
    expect(model.domain[0]).toBeLessThan(value);
    expect(model.domain[1]).toBeGreaterThan(value);
  },
);

it("keeps every finite label in an entirely partial daily series inside its domain", () => {
  const model = dailyChart({
    daily: [
      { ...point("2026-09-23T00:00", null), low: null, high: 35 },
      { ...point("2026-09-24T00:00", null), low: -20, high: null },
    ],
    current: point("2026-09-25T12:00", null),
  });
  expect(model.rows.every((r) => !r.validRange)).toBe(true);
  expect(model.domain[0]).toBeLessThan(-20);
  expect(model.domain[1]).toBeGreaterThan(35);
});

it("preserves forecast rainProbability and atomic precipitation group on current merge", () => {
  const forecast = {
    ...point("2026-09-23T09:00", 18),
    rainProbability: 30,
    precipitation: 4,
    precipitationHours: 3,
    precipitationBasis: "forecast" as const,
    precipitationApprox: true,
  };
  const current = {
    ...point("2026-09-23T09:00", 21),
    rainProbability: null,
    precipitation: null,
    precipitationHours: null,
    precipitationBasis: null,
    precipitationApprox: undefined,
  };
  const model = hourlyChart({
    hourly: [
      point("2026-09-23T06:00", 15),
      forecast,
      point("2026-09-23T12:00", 22),
    ],
    current,
    yesterday: null,
  });
  const now = model.rows[model.currentIndex];
  expect(now.point.temperature).toBe(21);
  expect(now.point.rainProbability).toBe(30);
  expect(now.point.precipitation).toBe(4);
  expect(now.point.precipitationHours).toBe(3);
  expect(now.point.precipitationBasis).toBe("forecast");
  expect(now.point.precipitationApprox).toBe(true);
});

it("opens at the row before the current one even without a current temperature", () => {
  const model = hourlyChart({
    hourly: [
      point("2026-09-23T06:00", 1),
      point("2026-09-23T09:00", 2),
      point("2026-09-23T12:00", 3),
    ],
    current: point("2026-09-23T10:15", null),
    yesterday: null,
  });
  expect(model.currentIndex).toBe(1);
  expect(model.startIndex).toBe(0);
  expect(model.current).toBeNull();
});

it("breaks linePath subpaths when breakBefore marks a missing-data gap", () => {
  expect(
    linePath(
      [10, 12, 14, 16],
      (i) => i * 10,
      (v) => v,
      (i) => i === 2,
    ),
  ).toBe("M0,10 L10,12 M20,14 L30,16");
});
