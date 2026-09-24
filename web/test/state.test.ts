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
      { fetchedAt: "2020-01-01T00:00:00Z" },
    ])
      expect(
        validateSnapshot({ ...value, weather: { ...w, ...patch } }, key, now),
      ).toBeUndefined();
    expect(validateSnapshot(value, key + "mismatch", now)).toBeUndefined();
    const old = structuredClone(value) as any;
    for (const point of [
      old.weather.current,
      old.weather.yesterday,
      ...old.weather.hourly,
      ...old.weather.daily,
    ].filter(Boolean)) {
      delete point.snowfall;
      delete point.snowfallHours;
      point.precipitationHours = 6;
    }
    const migrated = validateSnapshot(old, key, now)!;
    expect(migrated.current.precipitation).toBe(w.current.precipitation);
    expect(migrated.current.precipitationHours).toBeNull();
    expect(migrated.current.snowfall).toBeNull();
  });
});
