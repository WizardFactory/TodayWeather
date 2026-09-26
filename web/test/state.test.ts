import { describe, it, expect } from "vitest";
import {
  addPlace,
  defaultState,
  removePlace,
  restoreState,
  saveState,
  weatherKey,
} from "../src/state";
import { PLACES } from "@todayweather/core";
describe("browser persistence and request identities", () => {
  it("recovers from invalid JSON, unavailable storage and malicious/invalid records", () => {
    expect(restoreState({ getItem: () => "{bad" })).toEqual(defaultState());
    expect(
      restoreState({
        getItem: () => {
          throw Error();
        },
      }),
    ).toEqual(defaultState());
    const saved = {
      ...defaultState(),
      places: [PLACES[0], { ...PLACES[1], lat: 91 }, PLACES[0]],
      selectedId: "deleted",
    };
    expect(
      restoreState({ getItem: () => JSON.stringify(saved) }).places,
    ).toEqual([PLACES[0]]);
    expect(
      saveState(defaultState(), {
        setItem: () => {
          throw Error();
        },
      }),
    ).toBe(false);
  });
  it("deduplicates favorites and safely selects next after deletion", () => {
    const a = addPlace(addPlace(defaultState(), PLACES[0]), PLACES[1]);
    expect(addPlace(a, PLACES[0]).places.length).toBe(2);
    const b = removePlace(a, PLACES[1].id);
    expect(b.selectedId).toBe(PLACES[0].id);
  });
  it("never shares query/cache identity across location or any unit change", () => {
    const s = defaultState();
    const key = weatherKey(PLACES[0], s.settings.units);
    expect(weatherKey(PLACES[1], s.settings.units)).not.toBe(key);
    for (const name of Object.keys(s.settings.units)) {
      expect(
        weatherKey(PLACES[0], { ...s.settings.units, [name]: "different" }),
      ).not.toBe(key);
    }
  });
});

import { validateSnapshot } from "../src/state";
import { normalizeWeather } from "@todayweather/core";
import fixture from "../../docs/rewrite/examples/screenshot-weather.json";
describe("untrusted persisted weather", () => {
  it("requires bounded timestamps, matching identity and the complete render shape", () => {
    const now = Date.parse("2026-09-24T00:00:00Z");
    const w = normalizeWeather(fixture, {
      fetchedAt: new Date(now).toISOString(),
      location: PLACES[0],
    });
    const key = weatherKey(w.location, w.units),
      value = { weather: w, savedAt: now };
    expect(validateSnapshot(value, key, now)).toEqual(w);
    expect(
      validateSnapshot(
        { ...value, weather: { ...w, airSummary: "제공사 요약" } },
        key,
        now,
      )?.airSummary,
    ).toBe("제공사 요약");
    for (const savedAt of [
      undefined,
      NaN,
      Infinity,
      now - 86400001,
      now + 120000,
    ])
      expect(validateSnapshot({ ...value, savedAt }, key, now)).toBeUndefined();
    for (const patch of [
      { hourly: null },
      { air: [{}] },
      { current: {} },
      { units: {} },
      { notices: [null] },
      { airSummary: {} },
      { airSummary: "x".repeat(501) },
      { fetchedAt: "2020-01-01T00:00:00Z" },
    ])
      expect(
        validateSnapshot({ ...value, weather: { ...w, ...patch } }, key, now),
      ).toBeUndefined();
    expect(validateSnapshot(value, key + "mismatch", now)).toBeUndefined();
    // R12: shapes from earlier normalization revisions are rejected, not migrated.
    const old = structuredClone(value) as any;
    delete old.weather.current.precipitationBasis;
    expect(validateSnapshot(old, key, now)).toBeUndefined();
    const bad = structuredClone(value) as any;
    bad.weather.air[0].pollutants.aqi.hourly[0].forecast = "yes";
    expect(validateSnapshot(bad, key, now)).toBeUndefined();
  });
});

it("rejects snapshots normalized with the old daily-rain selection", async () => {
  const { normalizeWeather, DEFAULT_UNITS, PLACES } =
    await import("@todayweather/core");
  const { validateSnapshot } = await import("../src/state");
  const fixture =
    await import("../../docs/rewrite/examples/client-kma-response.json");
  const weather = normalizeWeather(fixture.response, { location: PLACES[0] });
  const legacyKey = JSON.stringify([
    PLACES[0].id,
    PLACES[0].lat,
    PLACES[0].lon,
    ...Object.keys(DEFAULT_UNITS).map(
      (k) => DEFAULT_UNITS[k as keyof typeof DEFAULT_UNITS],
    ),
    "ko",
    "v1",
  ]);
  expect(
    validateSnapshot({ weather, savedAt: Date.now() }, legacyKey),
  ).toBeUndefined();
});
