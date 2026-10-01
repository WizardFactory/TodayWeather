import { expect, it } from "vitest";
import { normalizeWeather } from "../src";
import fixture from "../../../docs/rewrite/examples/client-kma-response.json";
it("retains the full supplied daily history and numeric wind direction for arrows", () => {
  const raw = structuredClone(fixture.response) as any;
  const row = raw.midData.dailyData[0];
  raw.midData.dailyData = [
    { ...row, date: "2026-09-01", time: "0000" },
    ...raw.midData.dailyData,
  ];
  raw.current.vec = 225;
  const w = normalizeWeather(raw);
  expect(w.daily.some((p) => p.at.startsWith("2026-09-01"))).toBe(true);
  expect(w.current).toMatchObject({ windDegrees: 225 });
});
