import {
  coordinates,
  DEFAULT_UNITS,
  normalizeWeather,
  normalizeNation,
  normalizeWarnings,
  parseUnits,
  placeId,
  PLACES,
  shortenAddress,
  type Place,
} from "@todayweather/core";
import type { TransportSettings } from "./transport-config";
import { language, t } from "./i18n";
import { placeSearchText } from "./places";

/** The API asked us to wait; `retryAfterMs` is the requested pause. */
export class RateLimitError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
  }
}
export async function readJson(response: Response): Promise<any> {
  if (response.status === 429) {
    // Honor Retry-After when the API exposes it; otherwise assume a minute.
    const header = response.headers.get("Retry-After") ?? "",
      parsed = /^\d+$/.test(header.trim())
        ? Number(header) * 1000
        : Date.parse(header) - Date.now(),
      known = Number.isFinite(parsed) && parsed > 0;
    await response.body?.cancel().catch(() => undefined);
    throw new RateLimitError(
      known
        ? t("error.rateLimitSeconds", { seconds: Math.ceil(parsed / 1000) })
        : t("error.rateLimit"),
      known ? parsed : 60000,
    );
  }
  if (response.status === 503) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(t("error.unavailable"));
  }
  if (!response.headers.get("Content-Type")?.includes("json"))
    throw new Error(t("error.badResponse"));
  const reader = response.body?.getReader();
  if (!reader) throw new Error(t("error.empty"));
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 2_000_000) {
        await reader.cancel();
        throw new Error(t("error.tooLarge"));
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(t("error.unreadable"));
  }
  if (!response.ok)
    throw new Error(
      typeof data?.error?.message === "string"
        ? data.error.message
        : t("error.connect"),
    );
  return data;
}
function geo(value: any): Place {
  const c = coordinates(
    value?.location?.lat,
    value?.location?.long ?? value?.location?.lon,
  );
  if (!value || typeof value !== "object") throw new Error(t("error.geocode"));
  const address = String(value.address || "");
  return {
    id: placeId(c.lat, c.lon),
    // Mobile display name: name || getShortenAddress(address).
    name: String(
      value.name || shortenAddress(address) || address || "선택한 지역",
    ).slice(0, 160),
    address: String(value.address || "").slice(0, 300),
    country: String(value.country || "").slice(0, 3),
    ...c,
  };
}
const RETRY_DELAY_MS = 1000;
// Build-time constant: live builds drop the demo fixtures entirely.
const DEMO_BUILD = import.meta.env.VITE_WEB_MODE === "demo";
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const done = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", done);
      resolve();
    }, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}
export async function directApi(
  path: string,
  settings: TransportSettings,
  signal: AbortSignal,
  init?: RequestInit,
): Promise<unknown> {
  if ((init?.method ?? "GET") !== "GET")
    throw new Error(t("error.notificationsUnavailable"));
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error(t("error.unsupported"));
  const url = new URL(path, "https://web.invalid");
  if (url.origin !== "https://web.invalid")
    throw new Error(t("error.unsupported"));
  const route = url.pathname,
    mode = settings.mode;
  const units = parseUnits(Object.fromEntries(url.searchParams));
  const upstream = async (p: string, options: { noStore?: boolean } = {}) => {
    // One delayed retry for gateway (502) or network failures; a CloudFront
    // 502 without CORS headers surfaces as a network failure.
    for (let attempt = 0; ; attempt++) {
      let response: Response | undefined;
      try {
        response = await fetch(settings.apiOrigin + p, {
          signal,
          credentials: "omit",
          redirect: "error",
          // The selected UI language: server text follows it where the
          // backend supports that language.
          headers: {
            Accept: "application/json",
            "Accept-Language": language(),
          },
          // Geocode results can contain the user's position; keep them out of the HTTP cache.
          ...(options.noStore ? { cache: "no-store" as const } : {}),
        });
      } catch {
        if (signal.aborted) throw signal.reason;
      }
      if (attempt === 0 && (!response || response.status === 502)) {
        await response?.body?.cancel().catch(() => undefined);
        await wait(RETRY_DELAY_MS, signal);
        continue;
      }
      if (!response)
        // CORS prevents inspecting a failed response. Never echo provider/network details.
        throw new Error(t("error.connect"));
      return readJson(response);
    }
  };
  const query = new URLSearchParams({
    ...DEFAULT_UNITS,
    airUnit: units.airUnit,
    airForecastSource: "kaq",
  }).toString();
  if (route === "/capabilities")
    return {
      mode,
      notifications: {
        enabled: false,
        reason: t("error.notificationsUseApp"),
      },
      billing: { enabled: false },
      search: { catalog: true, geocode: mode === "live" },
    };
  if (route === "/places") return { items: PLACES };
  if (route.startsWith("/places/")) {
    const p = PLACES.find((p) => p.id === route.slice(8));
    if (!p) throw new Error(t("error.sharedPlace"));
    return p;
  }
  if (route === "/locations/search") {
    const q = (url.searchParams.get("q") ?? "")
      .trim()
      .slice(0, 120)
      .toLocaleLowerCase();
    return {
      items: PLACES.filter((p) => !q || placeSearchText(p).includes(q)).slice(
        0,
        20,
      ),
      canResolve: mode === "live" && q.length >= 2,
      mode,
    };
  }
  if (route === "/locations/resolve") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 2 || q.length > 120)
      throw new Error(t("error.searchTooShort"));
    if (mode === "demo") throw new Error(t("error.demoSearch"));
    return geo(
      await upstream("/geocode/v000903/addr/" + encodeURIComponent(q), {
        noStore: true,
      }),
    );
  }
  if (route === "/weather" || route === "/locations/reverse") {
    const c = coordinates(
      url.searchParams.get("lat"),
      url.searchParams.get("lon"),
    );
    const p = PLACES.find(
      (p) => Math.abs(p.lat - c.lat) < 0.015 && Math.abs(p.lon - c.lon) < 0.015,
    ) ?? {
      id: placeId(c.lat, c.lon),
      name: "선택한 지역",
      address: "",
      country: "",
      ...c,
    };
    if (route === "/locations/reverse")
      return mode === "demo"
        ? { ...p, ...c }
        : geo(
            await upstream(`/geocode/v000903/coord/${c.lat},${c.lon}`, {
              noStore: true,
            }),
          );
    if (mode === "demo" && units.airUnit !== "airkorea")
      throw new Error(t("error.demoAirUnit"));
    const raw =
      mode === "demo" && DEMO_BUILD
        ? {
            ...structuredClone((await import("./demo/weather.json")).default),
            name: p.name,
            address: p.address,
            country: p.country,
            location: { lat: c.lat, long: c.lon },
          }
        : await upstream(`/weather/v000903/coord/${c.lat},${c.lon}?${query}`);
    return normalizeWeather(raw, { units, mode, location: p });
  }
  if (route === "/nation/KR") {
    if (mode === "demo" && units.airUnit !== "airkorea")
      throw new Error(t("error.demoAirUnit"));
    const raw =
      mode === "demo" && DEMO_BUILD
        ? (await import("./demo/nation.json")).default
        : await upstream("/v000903/nation/KR?" + query);
    return normalizeNation(raw, { units, mode });
  }
  if (route === "/warnings/KR") {
    const raw =
      mode === "demo" && DEMO_BUILD
        ? (await import("./demo/warnings.json")).default
        : await upstream("/v000903/kma/special");
    return {
      mode,
      fetchedAt: new Date().toISOString(),
      items: normalizeWarnings(raw),
    };
  }
  throw new Error(t("error.featureUnavailable"));
}
