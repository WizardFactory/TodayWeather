import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import world from "../../docs/rewrite/examples/client-world-response.json";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const html = (status: number) =>
  new Response("<html>bad gateway</html>", {
    status,
    headers: { "Content-Type": "text/html" },
  });
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv("VITE_WEB_TRANSPORT", "direct");
  vi.stubEnv("VITE_WEB_MODE", "live");
  fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function settle<T>(promise: Promise<T>) {
  const result = promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(5000);
  return result as Promise<{ value?: T; error?: Error }>;
}
describe("one delayed retry for gateway failures", () => {
  it("retries a 502 once and then succeeds", async () => {
    fetcher
      .mockResolvedValueOnce(html(502))
      .mockResolvedValueOnce(json(world.response));
    const { api } = await import("../src/api");
    const r = await settle(
      api<any>("/weather?lat=48.85&lon=2.35&airUnit=airnow"),
    );
    expect(r.value?.source).toBe("VC");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("retries a network failure once and gives up after the second failure", async () => {
    fetcher.mockRejectedValue(new TypeError("Failed to fetch"));
    const { api } = await import("../src/api");
    const r = await settle(api<any>("/nation/KR"));
    expect(r.error?.message).toContain("연결하지 못했습니다");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not retry other statuses or successful but invalid bodies", async () => {
    const { api } = await import("../src/api");
    fetcher.mockResolvedValue(html(501));
    await settle(api<any>("/weather?lat=35.69&lon=139.692"));
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockReset();
    fetcher.mockResolvedValue(json({ error: { message: "nope" } }, 404));
    await settle(api<any>("/warnings/KR"));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not retry after abort, even while waiting", async () => {
    fetcher.mockResolvedValueOnce(html(502));
    const { api } = await import("../src/api");
    const controller = new AbortController();
    const pending = api<any>("/nation/KR", controller.signal).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort(new DOMException("stop", "AbortError"));
    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).name).toBe("AbortError");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("asks the browser not to store geocode responses", async () => {
    fetcher.mockImplementation(() =>
      json({
        name: "명동",
        address: "대한민국 서울특별시 중구 명동",
        country: "KR",
        location: { lat: 37.564, long: 126.985 },
      }),
    );
    const { api } = await import("../src/api");
    const p = (
      await settle(api<any>("/locations/reverse?lat=37.564&lon=126.985"))
    ).value;
    expect(p.name).toBe("명동");
    expect(fetcher.mock.calls[0][1].cache).toBe("no-store");
    fetcher.mockImplementation(() =>
      json({
        address: "대한민국 서울특별시 중구 명동",
        country: "KR",
        location: { lat: 37.564, long: 126.985 },
      }),
    );
    const q = (await settle(api<any>("/locations/resolve?q=명동"))).value;
    expect(q.name).toBe("서울시 명동");
    expect(fetcher.mock.calls[1][1].cache).toBe("no-store");
    fetcher.mockImplementation(() => json(world.response));
    await settle(api<any>("/weather?lat=48.85&lon=2.35&airUnit=airnow"));
    expect(fetcher.mock.calls[2][1].cache).toBeUndefined();
  });
});
