import { expect, it } from "vitest";
import {
  dailyChart,
  hourlyChart,
  hourlyXPositions,
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
it("keeps all chronological mixed-step rows, aligns yesterday by wall time and inserts an observation", () => {
  const hourly = Array.from({ length: 36 }, (_, i) =>
    point(
      `2026-09-${i < 24 ? "22" : "23"}T${String(i % 24).padStart(2, "0")}:00`,
      i,
    ),
  );
  const model = hourlyChart({
    hourly: hourly.reverse(),
    current: point("2026-09-23T10:30", -20),
    yesterday: point("2026-09-22T10:30", -50),
  });
  expect(model.rows).toHaveLength(37);
  const now = model.rows[model.currentIndex];
  expect(now.point.temperature).toBe(-20);
  expect(now.yesterday?.temperature).toBe(-50);
  expect(model.domain[0]).toBeLessThan(-50);
  expect(model.startIndex).toBe(model.currentIndex - 1);
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
  expect(model.startIndex).toBe(model.currentIndex - 1);
  expect(model.rows[model.startIndex].point.at).toBe("2026-09-23T10:00");
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

it("borrows enclosing forecast rainProbability for off-hour inserted current observation", () => {
  const model = hourlyChart({
    hourly: [
      { ...point("2026-09-23T09:00", 18), rainProbability: 0 },
      { ...point("2026-09-23T12:00", 22), rainProbability: 60 },
    ],
    current: { ...point("2026-09-23T10:15", 20), rainProbability: null },
    yesterday: null,
  });
  const now = model.rows[model.currentIndex];
  expect(now.point.at).toBe("2026-09-23T10:15");
  expect(now.point.rainProbability).toBe(0);
});

it("computes bounded chronological hourly x positions across off-hour, mixed 1h/3h, and >3h gaps", () => {
  const H = 3_600_000;
  const baseTime = Date.UTC(2026, 8, 23, 0, 0);
  // 15m off-hour, 1h step, 3h step, and 12h missing gap
  const times = [
    baseTime,
    baseTime + 15 * 60_000,
    baseTime + H + 15 * 60_000,
    baseTime + 4 * H + 15 * 60_000,
    baseTime + 16 * H + 15 * 60_000,
  ];
  const { xs, width, gapBefore } = hourlyXPositions(times, 80, 60, 320);
  expect(xs[0]).toBe(60);
  expect(xs[1] - xs[0]).toBeCloseTo(80, 5); // 15m clamped to 1.0 * col
  expect(xs[2] - xs[1]).toBeCloseTo(80, 5); // 1h -> 1.0 * col
  expect(xs[3] - xs[2]).toBeCloseTo(108, 5); // 3h -> 1.35 * col
  expect(xs[4] - xs[3]).toBeCloseTo(120, 5); // 12h -> 1.5 * col
  expect(gapBefore).toEqual([false, false, false, false, true]);
  expect(width).toBeCloseTo(xs[4] + 60, 5);

  // 45 mixed rows (16x 3h + 6x 1h + 23x 3h) stays bounded far under 9449px
  const mixed: number[] = [];
  let t = baseTime;
  for (let i = 0; i < 45; i++) {
    mixed.push(t);
    t += i >= 16 && i < 22 ? H : 3 * H;
  }
  const full = hourlyXPositions(mixed, 77, 77, 1151);
  expect(full.width).toBeLessThan(5000);
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
