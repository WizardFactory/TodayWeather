import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import kma from "../../docs/rewrite/examples/client-kma-response.json";
import world from "../../docs/rewrite/examples/client-world-response.json";
import { DEFAULT_UNITS, type Weather } from "@todayweather/core";
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_WEB_TRANSPORT", "direct");
  vi.stubEnv("VITE_WEB_MODE", "live");
  fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("static browser API transport", () => {
  it("serves catalog, search and disabled capabilities without a server", async () => {
    fetcher.mockResolvedValue(json({}));
    const { api } = await import("../src/api");
    expect((await api<any>("/capabilities")).notifications.enabled).toBe(false);
    expect((await api<any>("/locations/search?q=부산")).items[0].id).toBe(
      "busan",
    );
    expect((await api<any>("/places/seoul")).id).toBe("seoul");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requests canonical units and normalizes domestic display units once", async () => {
    fetcher.mockResolvedValue(json(kma.response));
    const { api } = await import("../src/api");
    const w = await api<Weather>(
      "/weather?lat=37.567&lon=126.978&temperatureUnit=F",
    );
    expect(w.current.temperature).toBeCloseTo(69.8);
    const [url, init] = fetcher.mock.calls[0];
    const u = new URL(url);
    expect(u.origin).toBe("https://todayweather.wizardfactory.net");
    expect(u.pathname).toBe("/weather/v000903/coord/37.567,126.978");
    expect(u.searchParams.get("temperatureUnit")).toBe("C");
    expect(u.searchParams.get("airForecastSource")).toBe("kaq");
    expect(init.credentials).toBe("omit");
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(w.mode).toBe("live");
  });
  it("normalizes world data and maps coordinate/address geocoding", async () => {
    const { api } = await import("../src/api");
    fetcher.mockResolvedValueOnce(json(world.response));
    expect(
      (await api<Weather>("/weather?lat=48.85&lon=2.35&airUnit=airnow")).source,
    ).toBe("VC");
    fetcher.mockImplementation(() =>
      json({
        address: "서울",
        country: "KR",
        location: { lat: 37.567, long: 126.978 },
      }),
    );
    expect((await api<any>("/locations/resolve?q=서울")).lon).toBe(126.978);
    expect(fetcher.mock.calls[1][0]).toContain(
      "/geocode/v000903/addr/%EC%84%9C%EC%9A%B8",
    );
    await api("/locations/reverse?lat=37.567&lon=126.978");
    expect(fetcher.mock.calls[2][0]).toContain(
      "/geocode/v000903/coord/37.567,126.978",
    );
  });
  it("reads advertised coordinate air separately and preserves the original AQI scale", async () => {
    const { api, fetchCoordinateAirForecast } = await import("../src/api");
    const retrievedAt = new Date().toISOString();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fetcher
      .mockResolvedValueOnce(json({
        ...world.response, airForecastAvailable: true,
        location: { lat: -34.901, long: -56.165 },
        timezone: { timezoneId: "America/Montevideo" },
      }))
      .mockResolvedValueOnce(json({
        source: "openweather", attribution: "OpenWeather", retrievedAt,
        rows: [{ at: future, pollutants: { pm25: 0, pm10: 12, o3: 0.03 }, indexes: { owm: 2, uaqi: 23 } }],
      }));
    const weather = await api<Weather>("/weather?lat=-34.901&lon=-56.165&airUnit=airnow");
    const signal = new AbortController().signal;
    expect(weather.timeZoneId).toBe("America/Montevideo");
    expect(await fetchCoordinateAirForecast(weather, signal)).toEqual({
      source: "openweather", attribution: "OpenWeather", retrievedAt,
      rows: [{ at: future, pollutants: { pm25: 0, pm10: 12, o3: 0.03 }, indexes: { owm: 2 } }],
    });
    expect(fetcher.mock.calls[1][0]).toContain("/weather/v000903/coord/-34.901,-56.165/air-forecast");
    expect(fetcher.mock.calls[1][1].cache).toBe("no-store");
    await expect(fetchCoordinateAirForecast({ ...weather, mode: "demo" }, signal)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockRejectedValueOnce(new TypeError("Offline"));
    await expect(fetchCoordinateAirForecast(weather, signal)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(weather.current.temperature).not.toBeNull();
  });
  it("reads a viewed pollen date without fabricating missing species levels", async () => {
    const { api, fetchCoordinatePollenForecast } = await import("../src/api");
    const retrievedAt = new Date().toISOString();
    fetcher
      .mockResolvedValueOnce(json({
        ...world.response, pollenForecastAvailable: true,
        location: { lat: 35.681, long: 139.767 }, country: "JP",
      }))
      .mockResolvedValueOnce(json({
        source: "google", attribution: "Google Maps", region: "JP", retrievedAt,
        days: [{dateUtc: "2026-11-20", plants: [{code: "JAPANESE_CEDAR"}, {code: "JAPANESE_CYPRESS", index: 0}], types: []}],
      }));
    const weather = await api<Weather>("/weather?lat=35.681&lon=139.767&airUnit=airnow");
    const signal = new AbortController().signal;
    expect(await fetchCoordinatePollenForecast(weather, signal)).toEqual({
      source: "google", attribution: "Google Maps", region: "JP", retrievedAt,
      days: [{dateUtc: "2026-11-20", plants: [{code: "JAPANESE_CEDAR"}, {code: "JAPANESE_CYPRESS", index: 0}], types: []}],
    });
    expect(fetcher.mock.calls[1][0]).toContain("/weather/v000903/coord/35.681,139.767/pollen-forecast");
    expect(fetcher.mock.calls[1][1].cache).toBe("no-store");
    await expect(fetchCoordinatePollenForecast({ ...weather, coordinatePollenForecastAvailable: undefined }, signal)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects invalid input and notification writes locally", async () => {
    fetcher.mockResolvedValue(json({}));
    const { api } = await import("../src/api");
    await expect(api("/weather?lat=999&lon=1")).rejects.toThrow();
    await expect(api("/locations/resolve?q=a")).rejects.toThrow();
    await expect(
      api("/installations", undefined, { method: "POST" }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects malformed geocodes, unknown sources, HTML and oversized responses", async () => {
    const { api } = await import("../src/api");
    fetcher.mockResolvedValueOnce(
      json({ location: { lat: null, long: null } }),
    );
    await expect(api("/locations/reverse?lat=0&lon=0")).rejects.toThrow();
    fetcher.mockResolvedValueOnce(json({ source: "unknown" }));
    await expect(api("/weather?lat=0&lon=0")).rejects.toThrow();
    fetcher.mockResolvedValueOnce(new Response("<html/>"));
    await expect(api("/weather?lat=0&lon=0")).rejects.toThrow();
    fetcher.mockResolvedValueOnce(
      new Response(" ".repeat(2_000_001), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(api("/weather?lat=0&lon=0")).rejects.toThrow();
  });
  it("does not mask upstream failures with demo data and honors cancellation", async () => {
    fetcher.mockRejectedValue(new TypeError("Failed to fetch"));
    const { api } = await import("../src/api");
    await expect(api("/weather?lat=0&lon=0")).rejects.toThrow();
    const c = new AbortController();
    c.abort();
    await expect(api("/places", c.signal)).rejects.toThrow();
  });
  it("localizes network/CORS errors and preserves cancellation identity", async () => {
    const { api } = await import("../src/api");
    fetcher.mockRejectedValue(
      new TypeError("Failed to fetch internal.example"),
    );
    await expect(api("/weather?lat=35.69&lon=139.692")).rejects.toThrow(
      "연결하지 못했습니다",
    );
    const c = new AbortController();
    const reason = new DOMException("cancelled", "AbortError");
    fetcher.mockImplementation(async () => {
      c.abort(reason);
      throw new TypeError("Failed to fetch");
    });
    await expect(api("/weather?lat=35.69&lon=139.692", c.signal)).rejects.toBe(
      reason,
    );
  });
  it("explicit demo mode works without network and labels data", async () => {
    vi.stubEnv("VITE_WEB_MODE", "demo");
    fetcher.mockRejectedValue(new Error("No network"));
    const { api } = await import("../src/api");
    expect((await api<Weather>("/weather?lat=37.567&lon=126.978")).mode).toBe(
      "demo",
    );
    expect(await api<any>("/nation/KR")).toBeDefined();
    expect(await api<any>("/warnings/KR")).toBeDefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects removed proxy mode instead of silently changing transport", async () => {
    vi.stubEnv("VITE_WEB_TRANSPORT", "proxy");
    await expect(import("../src/api")).rejects.toThrow("direct");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it("loads warnings for the viewed coordinates and expires source coverage on read", async () => {
  const { fetchCoordinateWarnings } = await import("../src/api");
  const { warningsAt } = await import("@todayweather/core");
  const now = Date.now();
  const stamp = (offset: number) => new Date(now + offset).toISOString();
  const place = { id: "barcelona", name: "Barcelona", address: "", country: "ES", lat: 41.3874, lon: 2.1686 };
  const snapshot = {
    location: {lat: place.lat, lon: place.lon, country: "ES"},
    checkedAt: stamp(0),
    sources: [{issuer: "AEMET", state: "current", asOf: stamp(-1000), freshUntil: stamp(60000)}],
    warnings: [{issuer: "AEMET", id: "warning", event: "Lluvia", effectiveAt: stamp(-1000), expiresAt: stamp(90000)}],
  };
  fetcher.mockResolvedValueOnce(json(snapshot)).mockResolvedValueOnce(json(snapshot));
  const result = await fetchCoordinateWarnings(place, new AbortController().signal);
  expect(result?.warnings[0]?.id).toBe("warning");
  const [url, init] = fetcher.mock.calls[0];
  expect(new URL(url).pathname).toBe("/weather/v000903/coord/41.3874,2.1686/warnings");
  expect(init.cache).toBe("no-store");
  expect(warningsAt(result!, now + 60000).sources[0].state).toBe("unavailable");
  expect(warningsAt(result!, now + 60000).warnings).toEqual([]);
  expect(await fetchCoordinateWarnings({...place, lat: 40.4168}, new AbortController().signal)).toBeUndefined();
});
