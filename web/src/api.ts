import { type Place, type Units, type Weather } from "@todayweather/core";
import { readSnapshot, weatherKey, writeSnapshot } from "./state";
import { directApi } from "./direct-api";
import { readTransportSettings } from "./transport-config";
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
      controller.abort(
        new DOMException("요청 시간이 초과되었습니다.", "TimeoutError"),
      ),
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
): Promise<{ weather: Weather; snapshot: boolean }> {
  const key = weatherKey(place, units);
  try {
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      throw new Error("오프라인 상태입니다.");
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
    const cached = await readSnapshot(key);
    if (cached) return { weather: cached, snapshot: true };
    throw error;
  }
}
export type Capabilities = {
  mode: "live" | "demo";
  notifications: { enabled: false; reason: string };
  billing: { enabled: boolean };
  search: { catalog: boolean; geocode: boolean };
};
