import { expect, it } from "vitest";
import { DEFAULT_UNITS, normalizeWeather } from "../src/index";
import fixture from "../../../docs/rewrite/examples/client-kma-response.json";
function weather(
  short: Record<string, unknown>[] = [],
  daily: Record<string, unknown>[] = [],
  shortest: Record<string, unknown>[] = [],
) {
  const raw: any = structuredClone(fixture.response);
  raw.current = { ...raw.current, date: "20260925", time: 12 };
  raw.short = short.map((r, i) => ({
    date: "20260925",
    time: 15 + i * 3,
    ...r,
  }));
  raw.shortest = shortest.map((r, i) => ({
    date: "20260925",
    time: 13 + i,
    ...r,
  }));
  raw.midData.dailyData = daily.map((r) => ({
    date: "20260925",
    time: "0000",
    ...r,
  }));
  return raw;
}
it("uses forecast coverage and approximation independently for rain and snow", () => {
  const w = normalizeWeather(
    weather(
      [
        { r06: 5, r06Hours: 6, r06Approx: false, s06: 10, s06Hours: 6 },
        {
          r06: 40.5,
          r06Hours: 3,
          r06Approx: true,
          s06: 2,
          s06Hours: 2,
          s06Approx: true,
        },
        { r06: 0, r06Hours: 0, s06: 0, s06Hours: 0, pop: 65 },
      ],
      [
        {
          r06: 5.5,
          r06Hours: 24,
          r06Approx: true,
          s06: 10,
          s06Hours: 21,
          s06Approx: true,
        },
      ],
    ),
  );
  expect(w.hourly[0]).toMatchObject({
    precipitation: 5,
    precipitationHours: 6,
    precipitationBasis: "forecast",
    snowfall: 10,
    snowfallHours: 6,
  });
  expect(w.hourly[1]).toMatchObject({
    precipitation: 40.5,
    precipitationHours: 3,
    precipitationBasis: "forecast",
    precipitationApprox: true,
    snowfallHours: 2,
    snowfallApprox: true,
  });
  expect(w.hourly[2]).toMatchObject({
    precipitation: null,
    precipitationHours: null,
    snowfall: null,
    snowfallHours: null,
    rainProbability: 65,
  });
  expect(w.daily[0]).toMatchObject({
    precipitation: 5.5,
    precipitationHours: 24,
    precipitationApprox: true,
    snowfallHours: 21,
    snowfallApprox: true,
  });
});
it("preserves legacy periods and observations despite forecast metadata", () => {
  const w = normalizeWeather(
    weather(
      [
        { r06: 5, s06: 10 },
        { r06: 5, r06Hours: "6", s06: 10, s06Hours: null },
        { time: 9, rn1: 5, r06: 5, r06Hours: 6, r06Approx: true },
        { time: 15, rn1: 2, r06: 0, r06Hours: 0, r06Approx: true },
      ],
      [
        { r06: 5.5, s06: 10 },
        { date: "20260924", rn1: 7, r06: 5, r06Hours: 24, r06Approx: true },
      ],
    ),
  );
  expect(w.hourly.find((p) => p.at.endsWith("09:00"))).toMatchObject({
    precipitation: 5,
    precipitationHours: 3,
    precipitationBasis: "observed",
  });
  expect(
    w.hourly
      .filter((p) => p.precipitationBasis === "forecast")
      .every((p) => p.precipitationHours === 3 && p.snowfallHours === 3),
  ).toBe(true);
  expect(
    w.hourly.find((p) => p.precipitationBasis === "partial"),
  ).toMatchObject({ precipitation: 2, precipitationHours: null });
  expect(w.daily[0]).toMatchObject({
    precipitation: 7,
    precipitationBasis: "observed",
    precipitationHours: null,
  });
  expect(w.daily[1]).toMatchObject({
    precipitation: 5.5,
    precipitationHours: null,
    snowfallHours: null,
  });
});
it("honors exact shortest rain and retains legacy category approximation and units", () => {
  const raw = weather(
    [],
    [],
    [{ rn1: 2, rn1Approx: false }, { rn1: 0.5, rn1Approx: true }, { rn1: 2 }],
  );
  const w = normalizeWeather(raw);
  expect(w.hourly.map((p) => p.precipitationBasis)).toEqual([
    "forecast",
    "approx",
    "approx",
  ]);
  expect(w.hourly.map((p) => p.precipitationHours)).toEqual([1, 1, 1]);
  const inches = normalizeWeather(
    weather([{ r06: 25.4, r06Hours: 6, r06Approx: true }]),
    { units: { ...DEFAULT_UNITS, precipitationUnit: "in" } },
  );
  expect(inches.hourly[0]).toMatchObject({
    precipitation: 1,
    precipitationHours: 6,
    precipitationApprox: true,
  });
});
it("overlays shortest amounts and flags together while retaining missing metrics", () => {
  const w = normalizeWeather(
    weather(
      [
        {
          r06: 40.5,
          r06Hours: 6,
          r06Approx: true,
          s06: 2,
          s06Hours: 6,
          s06Approx: true,
        },
        { r06: 40.5, r06Hours: 6, r06Approx: true },
      ],
      [],
      [
        { time: 15, rn1: 2, rn1Approx: false },
        { time: 18, rn1: -1 },
      ],
    ),
  );
  expect(w.hourly[0]).toMatchObject({
    precipitation: 2,
    precipitationBasis: "forecast",
    precipitationHours: 1,
    snowfall: 2,
    snowfallHours: 6,
    snowfallApprox: true,
  });
  expect(w.hourly[0].precipitationApprox).not.toBe(true);
  expect(w.hourly[1]).toMatchObject({
    precipitation: 40.5,
    precipitationHours: 6,
    precipitationApprox: true,
  });
});
