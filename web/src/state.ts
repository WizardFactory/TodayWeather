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
export type Settings = {
  units: Units;
  theme: "light" | "dark" | "photo" | "classic";
  startup: "hourly" | "daily" | "air" | "overview" | "locations";
  refreshMinutes: number;
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
    units: { ...DEFAULT_UNITS },
    theme: "light",
    startup: "hourly",
    refreshMinutes: 30,
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
    let units = DEFAULT_UNITS;
    try {
      units = parseUnits(s.units);
    } catch {
      /* Reset invalid units. */
    }
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
export function weatherKey(place: Place, units: Units): string {
  return JSON.stringify([
    place.id,
    place.lat,
    place.lon,
    ...Object.keys(DEFAULT_UNITS).map((k) => units[k as keyof Units]),
    "ko",
    "v1",
  ]);
}
export function addPlace(state: SavedState, place: Place): SavedState {
  const found = state.places.find(
    (p) => p.id === place.id || (p.lat === place.lat && p.lon === place.lon),
  );
  if (found) return { ...state, selectedId: found.id };
  if (state.places.length >= 30)
    throw new Error("관심지역은 최대 30개까지 저장할 수 있습니다.");
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
export async function writeSnapshot(
  key: string,
  weather: Weather,
): Promise<void> {
  await snapshots("readwrite", (s) =>
    s.put({ weather, savedAt: Date.now() }, key),
  );
  const keys = await snapshots("readonly", (s) => s.getAllKeys());
  // Small fixed bound; prune by recorded save time, not lexical coordinate order.
  if (keys && keys.length > 30) {
    const entries = await snapshots("readonly", (s) => s.getAll());
    if (entries) {
      const sorted = keys
        .map((k, i) => ({ key: k, time: entries[i]?.savedAt ?? 0 }))
        .sort((a, b) => a.time - b.time);
      for (const old of sorted.slice(0, keys.length - 30))
        await snapshots("readwrite", (s) => s.delete(old.key));
    }
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
    typeof p.precipitationHours === "number" &&
    Number.isFinite(p.precipitationHours)
  );
}
function validAir(station: unknown): boolean {
  if (
    !record(station) ||
    typeof station.name !== "string" ||
    !(station.observedAt === null || typeof station.observedAt === "string") ||
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
      Array.isArray(p.hourly) &&
      p.hourly.every(
        (h: unknown) =>
          record(h) &&
          typeof h.at === "string" &&
          finiteOrNull(h.value) &&
          finiteOrNull(h.grade),
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
      !["KMA", "DSF"].includes(w.source) ||
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
      weatherKey(w.location as Place, units) !== key
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
      !w.air.every(validAir)
    )
      return;
    if (
      !["observedAt", "publishedAt"].every(
        (k) => w[k] === null || typeof w[k] === "string",
      ) ||
      !Array.isArray(w.notices) ||
      !w.notices.every((n: unknown) => typeof n === "string") ||
      !record(w.availability) ||
      !["available", "partial"].includes(w.availability.weather) ||
      !["available", "unavailable"].includes(w.availability.air)
    )
      return;
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
