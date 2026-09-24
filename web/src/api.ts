import { type Place, type Units, type Weather } from "@todayweather/core";
import { readSnapshot, weatherKey, writeSnapshot } from "./state";
import { directApi, readJson } from "./direct-api";
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
    if (settings.transport === "direct")
      return (await directApi(path, settings, controller.signal, init)) as T;
    return (await readJson(
      await fetch("/api/web/v1" + path, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      }),
    )) as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
export const unitQuery = (units: Units) =>
  new URLSearchParams(units).toString();
/** Establish server capability and finish rule cleanup before the caller removes local state. */
export async function deletePlaceRules(placeId: string): Promise<void> {
  const caps = await api<Capabilities>("/capabilities");
  if (caps.notifications?.enabled === false) return;
  if (caps.notifications?.enabled !== true)
    throw new Error("알림 상태를 확인하지 못했습니다.");
  const session = await api<{ csrf: string }>("/installations", undefined, {
    method: "POST",
  });
  const rules = await api<{ items: { id: string; place: Place }[] }>(
    "/notification-rules",
  );
  for (const rule of rules.items.filter((rule) => rule.place.id === placeId))
    await api("/notification-rules/" + encodeURIComponent(rule.id), undefined, {
      method: "DELETE",
      headers: { "X-CSRF-Token": session.csrf },
    });
}
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
  notifications: { enabled: boolean; reason?: string; publicKey?: string };
  billing: { enabled: boolean };
  search: { catalog: boolean; geocode: boolean };
};
