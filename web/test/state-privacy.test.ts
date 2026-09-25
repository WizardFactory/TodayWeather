import { describe, expect, it } from "vitest";
import { PLACES, type Place } from "@todayweather/core";
import {
  addPlace,
  defaultState,
  expiredSnapshotKeys,
  snapshotOwner,
  weatherKey,
} from "../src/state";

const here = (lat: number, lon: number): Place => ({
  id: `p_${lat}_${lon}`,
  name: "현재 위치",
  address: "",
  country: "KR",
  lat,
  lon,
  current: true,
});

describe("current location slot", () => {
  it("replaces the previous current-location entry in place", () => {
    let s = addPlace(defaultState(), PLACES[0]);
    s = addPlace(s, here(37.5, 127.0));
    s = addPlace(s, PLACES[1]);
    s = addPlace(s, here(37.6, 127.1));
    expect(s.places.map((p) => p.id)).toEqual([
      "seoul",
      "p_37.6_127.1",
      "busan",
    ]);
    expect(s.places.filter((p) => p.current)).toHaveLength(1);
    expect(s.selectedId).toBe("p_37.6_127.1");
  });
  it("can replace the current slot even when the list is full", () => {
    let s = defaultState();
    s = addPlace(s, here(37.5, 127.0));
    for (let i = 0; i < 29; i++)
      s = addPlace(s, { ...PLACES[0], id: "x" + i, lat: 10 + i, lon: 10 });
    expect(s.places).toHaveLength(30);
    s = addPlace(s, here(37.7, 127.2));
    expect(s.places).toHaveLength(30);
    expect(s.places[0].id).toBe("p_37.7_127.2");
    expect(() => addPlace(s, PLACES[2])).toThrow("30");
  });
});

describe("snapshot retention", () => {
  it("identifies snapshot owners and expired records", () => {
    const key = weatherKey(PLACES[0], defaultState().settings.units);
    expect(snapshotOwner(key)).toBe("seoul");
    expect(snapshotOwner("not json")).toBeNull();
    const now = Date.UTC(2026, 8, 25);
    expect(
      expiredSnapshotKeys(
        [
          { key: "a", value: { savedAt: now - 86400001 } },
          { key: "b", value: { savedAt: now - 1000 } },
          { key: "c", value: {} },
          { key: "d", value: { savedAt: now + 3600000 } },
        ],
        now,
      ),
    ).toEqual(["a", "c", "d"]);
  });
});

describe("QA F1: current-location fix on a saved favorite", () => {
  const fav = { ...PLACES[0], id: "fav", lat: 37.566, lon: 126.995 };
  it("selects the favorite without converting or duplicating it", () => {
    let s = addPlace(defaultState(), fav);
    s = addPlace(s, { ...here(37.566, 126.995), id: "p_37.566_126.995" });
    expect(s.places.map((p) => [p.id, !!p.current])).toEqual([["fav", false]]);
    expect(s.selectedId).toBe("fav");
  });
  it("drops the stale current slot but keeps the favorite when a new fix lands on it", () => {
    let s = addPlace(defaultState(), here(37.5, 127.0));
    s = addPlace(s, fav);
    s = addPlace(s, { ...here(37.566, 126.995), id: "p_37.566_126.995" });
    expect(s.places.map((p) => [p.id, !!p.current])).toEqual([["fav", false]]);
    s = addPlace(s, here(37.7, 127.2));
    expect(s.places.map((p) => [p.id, !!p.current])).toEqual([
      ["fav", false],
      ["p_37.7_127.2", true],
    ]);
  });
});

describe("QA N1: choosing a place that matches the current-location slot", () => {
  it("promotes the slot to a saved favorite so a later fix cannot remove it", () => {
    let s = addPlace(defaultState(), here(2, 2));
    const chosen = { ...PLACES[0], id: "chosen", lat: 2, lon: 2 };
    s = addPlace(s, chosen);
    expect(s.places.map((p) => [p.id, !!p.current])).toEqual([
      ["chosen", false],
    ]);
    expect(s.selectedId).toBe("chosen");
    s = addPlace(s, here(5, 5));
    expect(s.places.map((p) => [p.id, !!p.current])).toEqual([
      ["chosen", false],
      ["p_5_5", true],
    ]);
  });
});
