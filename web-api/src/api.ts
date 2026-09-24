import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
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
  type Units,
} from "@todayweather/core";
import demoWeather from "../fixtures/weather.json";
import demoNation from "../fixtures/nation.json";
import demoWarnings from "../fixtures/warnings.json";

export type ApiConfig = {
  mode: "demo" | "live";
  upstream: string;
  origin: string;
  fetch?: typeof fetch;
  trustProxy?: boolean;
  notifications?: NotificationRoutes;
};
export type NotificationRoutes = {
  capabilities: () => unknown;
  handle: (
    req: IncomingMessage,
    path: string,
    body: unknown,
  ) => Promise<{
    status?: number;
    body: unknown;
    headers?: Record<string, string>;
  }>;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function createApi(config: ApiConfig) {
  const upstream = new URL(config.upstream);
  if (
    upstream.protocol !== "https:" ||
    upstream.username ||
    upstream.password ||
    upstream.search ||
    upstream.hash
  )
    throw new Error("UPSTREAM_API_BASE_URL must be an HTTPS origin");
  const fetcher = config.fetch ?? fetch;
  const limits = new Map<string, { since: number; count: number }>();
  async function upstreamJson(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(new URL(path, upstream), {
        headers: { Accept: "application/json", "Accept-Language": "ko" },
        signal: AbortSignal.timeout(12000),
        redirect: "error",
      });
    } catch (error) {
      throw new ApiError(
        error instanceof Error && error.name === "TimeoutError" ? 504 : 502,
        "UPSTREAM_FAILURE",
        "날씨 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    if (!response.ok)
      throw new ApiError(
        502,
        "UPSTREAM_FAILURE",
        "날씨 제공 서비스가 응답하지 않습니다.",
      );
    if (!response.headers.get("content-type")?.includes("json"))
      throw new ApiError(
        502,
        "UPSTREAM_SCHEMA",
        "날씨 서비스가 올바른 자료를 반환하지 않았습니다.",
      );
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (!reader)
      throw new ApiError(502, "UPSTREAM_SCHEMA", "날씨 자료가 비어 있습니다.");
    try {
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        length += r.value.length;
        if (length > 2_000_000) {
          await reader.cancel();
          throw new Error("Response too large");
        }
        chunks.push(r.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new ApiError(
        502,
        "UPSTREAM_SCHEMA",
        "날씨 서비스 자료를 읽을 수 없습니다.",
      );
    }
  }
  const canonicalQuery = (units: Units) =>
    new URLSearchParams({
      ...DEFAULT_UNITS,
      airUnit: units.airUnit,
      airForecastSource: "kaq",
    }).toString();
  const geo = (v: unknown): Place => {
    if (!v || typeof v !== "object")
      throw new ApiError(
        502,
        "UPSTREAM_SCHEMA",
        "지역 정보를 확인하지 못했습니다.",
      );
    const r = v as Record<string, any>,
      c = coordinates(r.location?.lat, r.location?.long ?? r.location?.lon);
    return {
      id: placeId(c.lat, c.lon),
      name: String(r.name || r.address || "선택한 지역").slice(0, 160),
      address: String(r.address || "").slice(0, 300),
      country: String(r.country || "").slice(0, 3),
      ...c,
    };
  };
  async function body(req: IncomingMessage) {
    let data = "";
    for await (const chunk of req) {
      data += chunk;
      if (data.length > 32768)
        throw new ApiError(413, "TOO_LARGE", "요청이 너무 큽니다.");
    }
    try {
      return data ? JSON.parse(data) : {};
    } catch {
      throw new ApiError(400, "INVALID_JSON", "올바르지 않은 요청입니다.");
    }
  }
  return async (req: IncomingMessage, res: ServerResponse) => {
    const id = randomUUID();
    function send(
      status: number,
      value: unknown,
      headers: Record<string, string> = {},
    ) {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": id,
        ...headers,
      });
      res.end(JSON.stringify(value));
    }
    try {
      const url = new URL(req.url ?? "/", "http://localhost"),
        path = url.pathname;
      const forwarded = req.headers["x-forwarded-for"];
      const key =
          config.trustProxy && typeof forwarded === "string"
            ? forwarded.split(",").at(-1)!.trim().slice(0, 100)
            : (req.socket.remoteAddress ?? "unknown"),
        now = Date.now();
      if (limits.size > 5000)
        for (const [k, v] of limits)
          if (now - v.since > 60000) limits.delete(k);
      let limit = limits.get(key);
      if (!limit || now - limit.since >= 60000) {
        limit = { since: now, count: 0 };
        limits.set(key, limit);
      }
      if (++limit.count > 180) {
        send(
          429,
          {
            error: {
              code: "RATE_LIMITED",
              message: "요청이 많습니다. 잠시 후 다시 시도해 주세요.",
              requestId: id,
            },
          },
          { "Retry-After": "60" },
        );
        return;
      }
      if (path === "/api/health") {
        send(200, { status: "ok", mode: config.mode });
        return;
      }
      const prefix = "/api/web/v1",
        route = path.slice(prefix.length);
      if (!path.startsWith(prefix + "/"))
        throw new ApiError(404, "NOT_FOUND", "요청한 API가 없습니다.");
      const notificationRoute =
        /^\/(installations|subscriptions|notification-rules|notifications\/test)(\/|$)/.test(
          route,
        );
      if (notificationRoute) {
        if (!config.notifications)
          throw new ApiError(
            503,
            "NOTIFICATIONS_UNAVAILABLE",
            "현재 웹 알림을 준비 중입니다. 기존 모바일 앱 알림을 이용해 주세요.",
          );
        if (req.method !== "GET" && req.headers.origin !== config.origin)
          throw new ApiError(
            403,
            "ORIGIN_REJECTED",
            "허용되지 않은 요청입니다.",
          );
        const result = await config.notifications.handle(
          req,
          route,
          await body(req),
        );
        send(result.status ?? 200, result.body, result.headers);
        return;
      }
      if (req.method !== "GET")
        throw new ApiError(
          405,
          "METHOD_NOT_ALLOWED",
          "지원하지 않는 요청 방식입니다.",
        );
      const units = (() => {
        try {
          return parseUnits(Object.fromEntries(url.searchParams));
        } catch {
          throw new ApiError(
            400,
            "INVALID_UNITS",
            "단위 설정을 확인해 주세요.",
          );
        }
      })();
      const mode = config.mode;
      if (route === "/capabilities") {
        send(200, {
          mode,
          notifications: config.notifications?.capabilities() ?? {
            enabled: false,
            reason: "웹 알림 서버가 아직 설정되지 않았습니다.",
          },
          billing: { enabled: false },
          search: { catalog: true, geocode: mode === "live" },
        });
        return;
      }
      if (route === "/places") {
        send(200, { items: PLACES });
        return;
      }
      if (route.startsWith("/places/")) {
        const p = PLACES.find((p) => p.id === route.slice(8));
        if (!p)
          throw new ApiError(
            404,
            "PLACE_NOT_FOUND",
            "공유한 지역을 찾을 수 없습니다.",
          );
        send(200, p);
        return;
      }
      if (route === "/locations/search") {
        const q = (url.searchParams.get("q") ?? "")
          .trim()
          .slice(0, 120)
          .toLocaleLowerCase();
        const items = PLACES.filter(
          (p) =>
            !q ||
            `${p.name} ${p.address} ${p.id}`.toLocaleLowerCase().includes(q),
        );
        send(200, {
          items: items.slice(0, 20),
          canResolve: mode === "live" && q.length >= 2,
          mode,
        });
        return;
      }
      if (route === "/locations/resolve") {
        const q = (url.searchParams.get("q") ?? "").trim();
        if (q.length < 2 || q.length > 120)
          throw new ApiError(
            400,
            "INVALID_QUERY",
            "두 글자 이상 지역명을 입력해 주세요.",
          );
        if (mode === "demo")
          throw new ApiError(
            503,
            "DEMO_SEARCH",
            "예제 모드에서는 추천 지역을 선택해 주세요.",
          );
        send(
          200,
          geo(
            await upstreamJson(
              "/geocode/v000903/addr/" + encodeURIComponent(q),
            ),
          ),
        );
        return;
      }
      if (route === "/locations/reverse" || route === "/weather") {
        let c;
        try {
          c = coordinates(
            url.searchParams.get("lat"),
            url.searchParams.get("lon"),
          );
        } catch {
          throw new ApiError(
            400,
            "INVALID_COORDINATES",
            "위도와 경도를 확인해 주세요.",
          );
        }
        const p = PLACES.find(
          (p) =>
            Math.abs(p.lat - c.lat) < 0.015 && Math.abs(p.lon - c.lon) < 0.015,
        ) ?? {
          id: placeId(c.lat, c.lon),
          name: "선택한 지역",
          address: "",
          country: "",
          ...c,
        };
        if (route === "/locations/reverse") {
          send(
            200,
            mode === "demo"
              ? { ...p, ...c }
              : geo(
                  await upstreamJson(
                    `/geocode/v000903/coord/${c.lat},${c.lon}`,
                  ),
                ),
          );
          return;
        }
        if (mode === "demo" && units.airUnit !== "airkorea")
          throw new ApiError(
            422,
            "DEMO_AIR_STANDARD",
            "예제 자료는 한국 대기환경 기준만 제공합니다.",
          );
        const raw =
          mode === "demo"
            ? {
                ...structuredClone(demoWeather),
                name: p.name,
                address: p.address,
                country: p.country,
                location: { lat: c.lat, long: c.lon },
              }
            : await upstreamJson(
                `/weather/v000903/coord/${c.lat},${c.lon}?${canonicalQuery(units)}`,
              );
        try {
          send(200, normalizeWeather(raw, { units, mode, location: p }));
        } catch {
          throw new ApiError(
            502,
            "UPSTREAM_SCHEMA",
            "일부 날씨 자료의 형식이나 단위를 확인하지 못했습니다.",
          );
        }
        return;
      }
      if (route === "/nation/KR") {
        if (mode === "demo" && units.airUnit !== "airkorea")
          throw new ApiError(
            422,
            "DEMO_AIR_STANDARD",
            "예제 자료는 한국 대기환경 기준만 제공합니다.",
          );
        const raw =
          mode === "demo"
            ? demoNation
            : await upstreamJson("/v000903/nation/KR?" + canonicalQuery(units));
        send(200, normalizeNation(raw, { units, mode }));
        return;
      }
      if (route === "/warnings/KR") {
        const raw =
          mode === "demo"
            ? demoWarnings
            : await upstreamJson("/v000903/kma/special");
        send(200, {
          mode,
          fetchedAt: new Date().toISOString(),
          items: normalizeWarnings(raw),
        });
        return;
      }
      throw new ApiError(404, "NOT_FOUND", "요청한 API가 없습니다.");
    } catch (error) {
      const e =
        error instanceof ApiError
          ? error
          : new ApiError(
              502,
              "UPSTREAM_SCHEMA",
              "자료를 처리하지 못했습니다. 다시 시도해 주세요.",
            );
      send(e.status, {
        error: {
          code: e.code,
          message: e.message,
          retryable: e.status >= 500,
          requestId: id,
        },
      });
    }
  };
}
