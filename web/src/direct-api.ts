import {
  coordinates,
  DEFAULT_UNITS,
  normalizeWeather,
  normalizeNation,
  normalizeWarnings,
  parseUnits,
  placeId,
  PLACES,
  type Place,
} from "@todayweather/core";
import type { TransportSettings } from "./transport-config";

export async function readJson(response: Response): Promise<any> {
  if (!response.headers.get("Content-Type")?.includes("json"))
    throw new Error(
      "서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("자료가 비어 있습니다.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 2_000_000) {
        await reader.cancel();
        throw new Error("자료 크기가 허용 범위를 초과했습니다.");
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
    throw new Error("날씨 서비스 자료를 읽을 수 없습니다.");
  }
  if (!response.ok)
    throw new Error(
      typeof data?.error?.message === "string"
        ? data.error.message
        : "날씨 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  return data;
}
function geo(value: any): Place {
  const c = coordinates(
    value?.location?.lat,
    value?.location?.long ?? value?.location?.lon,
  );
  if (!value || typeof value !== "object")
    throw new Error("지역 정보를 확인하지 못했습니다.");
  return {
    id: placeId(c.lat, c.lon),
    name: String(value.name || value.address || "선택한 지역").slice(0, 160),
    address: String(value.address || "").slice(0, 300),
    country: String(value.country || "").slice(0, 3),
    ...c,
  };
}
export async function directApi(
  path: string,
  settings: TransportSettings,
  signal: AbortSignal,
  init?: RequestInit,
): Promise<unknown> {
  if ((init?.method ?? "GET") !== "GET")
    throw new Error("정적 웹앱에서는 웹 알림을 아직 사용할 수 없습니다.");
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("지원하지 않는 요청입니다.");
  const url = new URL(path, "https://web.invalid");
  if (url.origin !== "https://web.invalid")
    throw new Error("지원하지 않는 요청입니다.");
  const route = url.pathname,
    mode = settings.mode;
  const units = parseUnits(Object.fromEntries(url.searchParams));
  const upstream = async (p: string) => {
    let response: Response;
    try {
      response = await fetch(settings.apiOrigin + p, {
        signal,
        credentials: "omit",
        redirect: "error",
        headers: { Accept: "application/json", "Accept-Language": "ko" },
      });
    } catch {
      if (signal.aborted) throw signal.reason;
      // CORS prevents inspecting a failed response. Never echo provider/network details.
      throw new Error(
        "날씨 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    return readJson(response);
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
        reason:
          "정적 웹앱의 웹 알림은 아직 제공하지 않습니다. 기존 모바일 앱 알림을 이용해 주세요.",
      },
      billing: { enabled: false },
      search: { catalog: true, geocode: mode === "live" },
    };
  if (route === "/places") return { items: PLACES };
  if (route.startsWith("/places/")) {
    const p = PLACES.find((p) => p.id === route.slice(8));
    if (!p) throw new Error("공유한 지역을 찾을 수 없습니다.");
    return p;
  }
  if (route === "/locations/search") {
    const q = (url.searchParams.get("q") ?? "")
      .trim()
      .slice(0, 120)
      .toLocaleLowerCase();
    return {
      items: PLACES.filter(
        (p) =>
          !q ||
          `${p.name} ${p.address} ${p.id}`.toLocaleLowerCase().includes(q),
      ).slice(0, 20),
      canResolve: mode === "live" && q.length >= 2,
      mode,
    };
  }
  if (route === "/locations/resolve") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 2 || q.length > 120)
      throw new Error("두 글자 이상 지역명을 입력해 주세요.");
    if (mode === "demo")
      throw new Error("예제 모드에서는 추천 지역을 선택해 주세요.");
    return geo(
      await upstream("/geocode/v000903/addr/" + encodeURIComponent(q)),
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
        : geo(await upstream(`/geocode/v000903/coord/${c.lat},${c.lon}`));
    if (mode === "demo" && units.airUnit !== "airkorea")
      throw new Error("예제 자료는 한국 대기환경 기준만 제공합니다.");
    const raw =
      mode === "demo"
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
      throw new Error("예제 자료는 한국 대기환경 기준만 제공합니다.");
    const raw =
      mode === "demo"
        ? (await import("./demo/nation.json")).default
        : await upstream("/v000903/nation/KR?" + query);
    return normalizeNation(raw, { units, mode });
  }
  if (route === "/warnings/KR") {
    const raw =
      mode === "demo"
        ? (await import("./demo/warnings.json")).default
        : await upstream("/v000903/kma/special");
    return {
      mode,
      fetchedAt: new Date().toISOString(),
      items: normalizeWarnings(raw),
    };
  }
  throw new Error("요청한 기능을 사용할 수 없습니다.");
}
