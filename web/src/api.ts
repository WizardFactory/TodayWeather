import { type Place, type Units, type Weather } from "@todayweather/core";
import { readSnapshot, weatherKey, writeSnapshot } from "./state";
import { directApi } from "./direct-api";
import { readTransportSettings } from "./transport-config";
import { LANGUAGES, t } from "./i18n";
const settings = readTransportSettings(import.meta.env);
export async function api<T>(
  path: string,
  signal?: AbortSignal,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException(t("error.timeout"), "TimeoutError")),
    15000,
  );
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    return (await directApi(path, settings, controller.signal, init)) as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
export const unitQuery = (units: Units) =>
  new URLSearchParams(units).toString();
export async function fetchWeather(
  place: Place,
  units: Units,
  signal: AbortSignal,
): Promise<{
  weather: Weather;
  snapshot: boolean;
  /** Rate limited: do not ask again before this time (Retry-After). */
  retryAt?: number;
  notice?: string;
}> {
  const key = weatherKey(place, units);
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      throw new Error(t("error.offline"));
    const weather = await api<Weather>(
      `/weather?lat=${place.lat}&lon=${place.lon}&${unitQuery(units)}`,
      signal,
    );
    weather.location = {
      ...weather.location,
      ...place,
      name: place.name === "선택한 지역" ? weather.location.name : place.name,
      address: place.address || weather.location.address,
      country: place.country || weather.location.country,
    };
    await writeSnapshot(key, weather);
    return { weather, snapshot: false };
  } catch (error) {
    if (signal.aborted) throw error;
    const cached = await readAnySnapshot(key);
    if (cached) {
      const wait = (error as { retryAfterMs?: number }).retryAfterMs;
      return wait
        ? {
            weather: cached,
            snapshot: true,
            retryAt: Date.now() + wait,
            notice: (error as Error).message,
          }
        : { weather: cached, snapshot: true };
    }
    throw error;
  }
}
export type Capabilities = {
  mode: "live" | "demo";
  notifications: { enabled: false; reason: string };
  billing: { enabled: boolean };
  search: { catalog: boolean; geocode: boolean };
};
/** Stored snapshot for immediate rendering; null when absent, expired or invalid. */
export async function readStoredWeather(key: string): Promise<Weather | null> {
  return (await readAnySnapshot(key)) ?? null;
}
/**
 * The snapshot for this language, else the same place and units saved in
 * another UI language (only server text differs), so switching language
 * offline keeps the stored weather.
 */
async function readAnySnapshot(key: string): Promise<Weather | undefined> {
  const own = await readSnapshot(key);
  if (own) return own;
  let parts: unknown[];
  try {
    parts = JSON.parse(key);
  } catch {
    return;
  }
  const at = parts.length - 2; // [..., language, normalization revision]
  for (const other of LANGUAGES) {
    if (other === parts[at]) continue;
    const found = await readSnapshot(
      JSON.stringify([...parts.slice(0, at), other, ...parts.slice(at + 1)]),
    );
    if (found) return found;
  }
}
