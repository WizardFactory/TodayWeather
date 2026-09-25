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
    ).toBe("DSF");
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
