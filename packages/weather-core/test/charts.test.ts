import { expect, it } from "vitest";
import { dailyChart, hourlyChart, linePath, normalizeWeather } from "../src";
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
