import {
  DEFAULT_UNITS,
  PLACES,
  POLLUTANTS,
  parseUnits,
  coordinates,
  type Place,
  type Units,
  type Weather,
} from "@todayweather/core";
import { isLanguage, language, t, type Language } from "./i18n";
import { autoUnits } from "./locale";
export type Settings = {
  units: Units;
  theme: "light" | "dark" | "photo" | "classic";
  startup: "hourly" | "daily" | "air" | "overview" | "locations";
  refreshMinutes: number;
  /** Chosen UI language; null follows the browser. */
  language: Language | null;
  /**
   * Units the user chose explicitly. The others follow the browser country's
   * defaults and may be recalculated; a user's choice is never replaced.
   */
  userUnits: (keyof Units)[];
};
export type SavedState = {
  version: 1;
  places: Place[];
  selectedId: string | null;
  settings: Settings;
};
export const defaultState = (): SavedState => ({
  version: 1,
  places: [],
  selectedId: null,
  settings: {
    units: autoUnits(),
    theme: "light",
    startup: "hourly",
    refreshMinutes: 30,
    language: null,
    userUnits: [],
  },
});
export const STATE_KEY = "tw.web.v1.preferences";
export function restoreState(storage: Pick<Storage, "getItem">): SavedState {
  try {
    const parsed = JSON.parse(storage.getItem(STATE_KEY) ?? "null");
    if (!parsed || parsed.version !== 1) return defaultState();
    const places: Place[] = [];
    for (const p of Array.isArray(parsed.places) ? parsed.places : []) {
      try {
        if (
          !p ||
          typeof p.id !== "string" ||
          p.id.length > 100 ||
          !/^[a-zA-Z0-9_.-]+$/.test(p.id) ||
          typeof p.name !== "string" ||
          p.name.length > 160
        )
          continue;
        const c = coordinates(p.lat, p.lon);
        if (places.some((x) => x.id === p.id)) continue;
        places.push({
          id: p.id,
          name: p.name,
          address: typeof p.address === "string" ? p.address.slice(0, 300) : "",
          country: typeof p.country === "string" ? p.country.slice(0, 3) : "",
          ...c,
          ...(p.current ? { current: true } : {}),
        });
      } catch {
        /* Discard invalid records without blocking startup. */
      }
      if (places.length >= 30) break;
    }
    const defaults = defaultState().settings,
      s = parsed.settings ?? {};
    let stored: Units | null = null;
    try {
      stored = parseUnits(s.units);
    } catch {
      /* Reset invalid units to the automatic defaults. */
    }
    const unitKeys = Object.keys(DEFAULT_UNITS) as (keyof Units)[];
    // Saved before automatic defaults existed: keep every stored unit.
    const userUnits = !stored
      ? []
      : Array.isArray(s.userUnits)
        ? unitKeys.filter((k) => s.userUnits.includes(k))
        : unitKeys;
    const units = { ...autoUnits() };
    for (const k of userUnits)
      (units as Record<string, string>)[k] = stored![k];
    return {
      version: 1,
      places,
      selectedId: places.some((p) => p.id === parsed.selectedId)
        ? parsed.selectedId
        : (places[0]?.id ?? null),
      settings: {
        units,
        theme: ["light", "dark", "photo", "classic"].includes(s.theme)
          ? s.theme
          : defaults.theme,
        startup: ["hourly", "daily", "air", "overview", "locations"].includes(
          s.startup,
        )
          ? s.startup
          : defaults.startup,
        refreshMinutes: [0, 30, 60, 180, 360, 720].includes(s.refreshMinutes)
          ? s.refreshMinutes
          : defaults.refreshMinutes,
        language: isLanguage(s.language) ? s.language : null,
        userUnits,
      },
    };
  } catch {
    return defaultState();
  }
}
export function resolvePlace(
  state: SavedState,
  id: string | undefined,
): Place | undefined {
  const known =
    state.places.find((p) => p.id === id) ?? PLACES.find((p) => p.id === id);
  if (known) return known;
  const match = id?.match(/^p_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)$/);
  if (!match) return;
  try {
    return {
      id: id!,
      name: "선택한 지역",
      address: "",
      country: "",
      ...coordinates(match[1], match[2]),
    };
  } catch {
    return;
  }
}
export function saveState(
  state: SavedState,
  storage: Pick<Storage, "setItem">,
): boolean {
  try {
    storage.setItem(STATE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
export function weatherKey(
  place: Place,
  units: Units,
  lang: string = language(),
): string {
  return JSON.stringify([
    place.id,
    place.lat,
    place.lon,
    ...Object.keys(DEFAULT_UNITS).map((k) => units[k as keyof Units]),
    lang, // Server text (names, summaries) follows the request language.
    "v4", // Complete API daily history and numeric wind direction for PWA charts.
  ]);
}
export const MAX_PLACES = 30;
export function addPlace(state: SavedState, place: Place): SavedState {
  const found = state.places.find(
    (p) => p.id === place.id || (p.lat === place.lat && p.lon === place.lon),
  );
  if (found) {
    // Choosing a saved place at the current-location slot's coordinates
    // promotes the slot to a favorite so a later fix cannot replace it.
    if (!place.current && found.current)
      return {
        ...state,
        places: state.places.map((p) => (p === found ? place : p)),
        selectedId: place.id,
      };
    if (!place.current || found.current)
      return { ...state, selectedId: found.id };
    // A new fix on a saved favorite: keep the favorite as is and retire the
    // stale current-location entry instead of converting or duplicating it.
    return {
      ...state,
      places: state.places.filter((p) => !p.current),
      selectedId: found.id,
    };
  }
  // One current-location slot: a new fix replaces the previous one in place.
  const slot = place.current ? state.places.findIndex((p) => p.current) : -1;
  if (slot >= 0) {
    const places = state.places
      .map((p, i) => (i === slot ? place : p))
      .filter((p, i) => i === slot || (!p.current && p.id !== place.id));
    return { ...state, places, selectedId: place.id };
  }
  if (state.places.length >= MAX_PLACES)
    throw new Error(t("error.maxPlaces", { max: MAX_PLACES }));
  return { ...state, places: [...state.places, place], selectedId: place.id };
}
export function removePlace(state: SavedState, id: string): SavedState {
  const places = state.places.filter((p) => p.id !== id);
  return {
    ...state,
    places,
    selectedId:
      state.selectedId === id ? (places[0]?.id ?? null) : state.selectedId,
  };
}
async function snapshots<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    if (!globalThis.indexedDB) {
      resolve(undefined);
      return;
    }
    const open = indexedDB.open("tw.web.v1.snapshots", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("weather");
    open.onerror = () => resolve(undefined);
    open.onblocked = () => resolve(undefined);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction("weather", mode),
          req = action(tx.objectStore("weather"));
        let result: T | undefined;
        req.onsuccess = () => {
          result = req.result;
        };
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          resolve(undefined);
        };
      } catch {
        db.close();
        resolve(undefined);
      }
    };
  }).catch(() => undefined);
}
/** Place id that owns a snapshot key, or null for foreign/corrupt keys. */
export function snapshotOwner(key: string): string | null {
  try {
    const parsed = JSON.parse(key);
    return Array.isArray(parsed) && typeof parsed[0] === "string"
      ? parsed[0]
      : null;
  } catch {
    return null;
  }
}
const SNAPSHOT_MAX_AGE = 86400000;
/** Snapshot keys past the 24-hour retention (or with an invalid receipt time). */
export function expiredSnapshotKeys(
  entries: { key: string; value: unknown }[],
  now: number,
): string[] {
  return entries
    .filter(({ value }) => {
      const at = record(value) ? value.savedAt : undefined;
      return (
        typeof at !== "number" ||
        !Number.isFinite(at) ||
        at > now + 60000 ||
        now - at > SNAPSHOT_MAX_AGE
      );
    })
    .map((e) => e.key);
}
/** Keys and values read in one transaction, so they always align. */
async function snapshotEntries(): Promise<{ key: string; value: unknown }[]> {
  return new Promise<{ key: string; value: unknown }[]>((resolve) => {
    if (!globalThis.indexedDB) return resolve([]);
    const open = indexedDB.open("tw.web.v1.snapshots", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("weather");
    open.onerror = open.onblocked = () => resolve([]);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction("weather", "readonly"),
          store = tx.objectStore("weather"),
          keys = store.getAllKeys(),
          values = store.getAll();
        tx.oncomplete = () => {
          db.close();
          resolve(
            keys.result.length === values.result.length
              ? keys.result.map((k, i) => ({
                  key: String(k),
                  value: values.result[i] as unknown,
                }))
              : [],
          );
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          resolve([]);
        };
      } catch {
        db.close();
        resolve([]);
      }
    };
  }).catch(() => []);
}
async function deleteSnapshotKeys(keys: string[]) {
  for (const key of keys) await snapshots("readwrite", (s) => s.delete(key));
}
/** Remove every stored weather snapshot for a deleted or replaced place. */
export async function deleteSnapshotsFor(placeId: string): Promise<void> {
  await deleteSnapshotKeys(
    (await snapshotEntries())
      .filter((e) => snapshotOwner(e.key) === placeId)
      .map((e) => e.key),
  );
}
/** Enforce the 24-hour retention; runs at startup and after each write. */
export async function pruneSnapshots(now = Date.now()): Promise<void> {
  await deleteSnapshotKeys(expiredSnapshotKeys(await snapshotEntries(), now));
}
/** Clear this app's browser data: preferences and the snapshot database. */
export async function clearLocalData(
  storage: Pick<Storage, "removeItem">,
): Promise<void> {
  try {
    storage.removeItem(STATE_KEY);
    storage.removeItem("tw.web.v1.display");
  } catch {
    /* Storage may be unavailable; the database is still cleared. */
  }
  if (!globalThis.indexedDB) return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("tw.web.v1.snapshots");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
export async function writeSnapshot(
  key: string,
  weather: Weather,
): Promise<void> {
  await snapshots("readwrite", (s) =>
    s.put({ weather, savedAt: Date.now() }, key),
  );
  await pruneSnapshots();
  // Small fixed bound; prune by recorded save time from one consistent read.
  const entries = await snapshotEntries();
  if (entries.length > 30) {
    const time = (v: unknown) =>
      record(v) && typeof v.savedAt === "number" ? v.savedAt : 0;
    const sorted = [...entries].sort((a, b) => time(a.value) - time(b.value));
    await deleteSnapshotKeys(
      sorted.slice(0, entries.length - 30).map((e) => e.key),
    );
  }
}
function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const finiteOrNull = (v: unknown) =>
  v === null || (typeof v === "number" && Number.isFinite(v));
function validPoint(p: unknown): boolean {
  if (!record(p)) return false;
  return (
    [
      "at",
      "windDirection",
      "icon",
      "iconPm",
      "description",
      "sunrise",
      "sunset",
      "uv",
      "discomfort",
    ].every((k) => typeof p[k] === "string") &&
    [
      "temperature",
      "low",
      "high",
      "humidity",
      "wind",
      "pressure",
      "visibility",
      "precipitation",
      "rainProbability",
      "feelsLike",
    ].every((k) => finiteOrNull(p[k])) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(p.at) &&
    finiteOrNull(p.snowfall) &&
    ["pollenOak", "pollenPine", "pollenWeeds"].every(
      (key) =>
        p[key] === undefined ||
        (Number.isInteger(p[key]) && p[key] >= 0 && p[key] <= 3),
    ) &&
    (p.precipitationHours === null ||
      (typeof p.precipitationHours === "number" &&
        Number.isFinite(p.precipitationHours) &&
        p.precipitationHours > 0)) &&
    (p.snowfallHours === null ||
      (typeof p.snowfallHours === "number" &&
        Number.isFinite(p.snowfallHours) &&
        p.snowfallHours > 0)) &&
    ["precipitationApprox", "snowfallApprox"].every(
      (key) => p[key] === undefined || typeof p[key] === "boolean",
    ) &&
    [null, "observed", "partial", "approx", "forecast"].includes(
      p.precipitationBasis,
    )
  );
}
function validAir(station: unknown): boolean {
  if (
    !record(station) ||
    typeof station.name !== "string" ||
    !(station.observedAt === null || typeof station.observedAt === "string") ||
    typeof station.forecastSource !== "string" ||
    !(
      station.forecastPublishedAt === null ||
      typeof station.forecastPublishedAt === "string"
    ) ||
    !record(station.pollutants)
  )
    return false;
  return POLLUTANTS.every((code) => {
    const p = station.pollutants[code];
    return (
      record(p) &&
      finiteOrNull(p.value) &&
      finiteOrNull(p.grade) &&
      typeof p.label === "string" &&
      typeof p.guide === "string" &&
      typeof p.station === "string" &&
      Array.isArray(p.hourly) &&
      p.hourly.every(
        (h: unknown) =>
          record(h) &&
          typeof h.at === "string" &&
          finiteOrNull(h.value) &&
          finiteOrNull(h.grade) &&
          typeof h.forecast === "boolean",
      ) &&
      Array.isArray(p.daily) &&
      p.daily.every(
        (d: unknown) =>
          record(d) &&
          typeof d.at === "string" &&
          finiteOrNull(d.grade) &&
          typeof d.label === "string",
      )
    );
  });
}
const keyLanguage = (key: string) => {
  try {
    const parts = JSON.parse(key);
    return Array.isArray(parts) ? String(parts[parts.length - 2]) : "";
  } catch {
    return "";
  }
};
/** Cache is untrusted browser persistence: require complete normalized shape and a bounded receipt time. */
export function validateSnapshot(
  value: unknown,
  key: string,
  now = Date.now(),
): Weather | undefined {
  try {
    if (
      !record(value) ||
      typeof value.savedAt !== "number" ||
      !Number.isFinite(value.savedAt) ||
      value.savedAt > now + 60000 ||
      now - value.savedAt > 86400000
    )
      return;
    const w = value.weather;
    if (
      !record(w) ||
      w.schemaVersion !== 1 ||
      !["KMA", "VC"].includes(w.source) ||
      !["live", "demo"].includes(w.mode) ||
      !record(w.location) ||
      !record(w.units)
    )
      return;
    const fetched =
      typeof w.fetchedAt === "string" ? Date.parse(w.fetchedAt) : NaN;
    if (
      !Number.isFinite(fetched) ||
      fetched > now + 60000 ||
      now - fetched > 86400000
    )
      return;
    if (
      !["id", "name", "address", "country"].every(
        (k) => typeof w.location[k] === "string",
      )
    )
      return;
    coordinates(w.location.lat, w.location.lon);
    const units = parseUnits(w.units);
    if (
      !Object.keys(DEFAULT_UNITS).every(
        (k) => w.units[k] === units[k as keyof Units],
      ) ||
      // A snapshot is valid under the language it was saved in, whatever
      // the current UI language is.
      weatherKey(w.location as Place, units, keyLanguage(key)) !== key
    )
      return;
    if (
      !validPoint(w.current) ||
      !(w.yesterday === null || validPoint(w.yesterday)) ||
      !Array.isArray(w.hourly) ||
      !w.hourly.every(validPoint) ||
      !Array.isArray(w.daily) ||
      !w.daily.every(validPoint) ||
      !Array.isArray(w.air) ||
      !w.air.every(validAir) ||
      (w.airSummary !== undefined &&
        (typeof w.airSummary !== "string" ||
          !w.airSummary.trim() ||
          w.airSummary.length > 500))
    )
      return;
    if (
      !["observedAt", "publishedAt", "forecastPublishedAt"].every(
        (k) => w[k] === null || typeof w[k] === "string",
      ) ||
      !Array.isArray(w.notices) ||
      !w.notices.every((n: unknown) => typeof n === "string") ||
      !record(w.availability) ||
      !["available", "partial"].includes(w.availability.weather) ||
      !["available", "unavailable"].includes(w.availability.air)
    )
      return;
    // Older normalization revisions use different cache keys and never reach here.
    return w as Weather;
  } catch {
    return;
  }
}
export async function readSnapshot(key: string): Promise<Weather | undefined> {
  const value = await snapshots("readonly", (s) => s.get(key)),
    weather = validateSnapshot(value, key);
  if (value && !weather) await snapshots("readwrite", (s) => s.delete(key));
  return weather;
}
