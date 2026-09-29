import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { PLACES } from "@todayweather/core";
import { isOld, matchPlace, weatherStaleTime } from "../src/format";

describe("staleness uses real elapsed time (audit F2)", () => {
  const now = Date.parse("2026-09-25T12:00:00+09:00");
  it("reads naive KMA wall times as KST and applies the exact limit", () => {
    expect(isOld("2026-09-25 08:59", 3, now)).toBe(true);
    expect(isOld("2026-09-25 09:01", 3, now)).toBe(false);
    expect(isOld("2026-09-25T09:30", 3, now)).toBe(false);
    expect(isOld("2026-09-24 11:59", 24, now)).toBe(true);
    expect(isOld("2026-09-24 12:30", 24, now)).toBe(false);
  });
  it("respects explicit offsets and ignores unknown formats", () => {
    expect(isOld("2026-09-25T00:00:00.000Z", 3, now)).toBe(false);
    expect(isOld("2026-09-24T23:59:00.000Z", 3, now)).toBe(true);
    expect(isOld("yesterday", 3, now)).toBe(false);
    expect(isOld(null, 3, now)).toBe(false);
  });
});

describe("search submission picks the intended place (audit F5)", () => {
  it("prefers exact names and unique prefixes over address substrings", () => {
    expect(matchPlace("서울", PLACES)?.id).toBe("seoul");
    expect(matchPlace("Busan", [...PLACES])?.id).toBe("busan");
    expect(matchPlace("부", PLACES)?.id).toBe("busan");
    expect(matchPlace("동구", PLACES)).toBeUndefined();
    expect(matchPlace("중구", PLACES)).toBeUndefined();
    expect(matchPlace("서구", PLACES)).toBeUndefined();
    expect(matchPlace("", PLACES)).toBeUndefined();
  });
});

describe("snapshot results are refetched promptly (audit F1)", () => {
  it("treats snapshot fallbacks as stale and live results as fresh", () => {
    expect(weatherStaleTime({ snapshot: true })).toBe(0);
    expect(weatherStaleTime({ snapshot: false })).toBe(600000);
    expect(weatherStaleTime(undefined)).toBe(600000);
  });
});

describe("service worker keeps one complete previous shell (audit F8)", () => {
  it("deletes incomplete caches and keeps the newest complete previous cache", async () => {
    const handlers: Record<string, Function> = {};
    const stores: Record<string, Map<string, string>> = {
      "tw-shell-old": new Map([["/index.html", "legacy shell"]]),
      "tw-shell-prev": new Map([["/__complete__", "1"]]),
      "tw-shell-failed": new Map(),
      "tw-shell-__BUILD_VERSION__": new Map([["/__complete__", "1"]]),
    };
    const deleted: string[] = [];
    const caches = {
      keys: async () => Object.keys(stores),
      open: async (key: string) => ({
        match: async (r: string) => stores[key]?.get(r),
        addAll: async () => {},
        put: async () => {},
      }),
      delete: async (key: string) => {
        deleted.push(key);
        delete stores[key];
        return true;
      },
    };
    runInNewContext(readFileSync("web/public/sw.js", "utf8"), {
      URL,
      Response,
      caches,
      fetch: async () => "network",
      self: {
        location: { origin: "https://web.example" },
        clients: { claim: async () => {} },
        addEventListener: (name: string, fn: Function) => (handlers[name] = fn),
      },
    });
    let done: Promise<unknown> = Promise.resolve();
    handlers.activate({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(deleted.sort()).toEqual(["tw-shell-failed", "tw-shell-old"]);
  });
});

describe("error paths of the direct API adapter (audit G14 / Retry-After)", () => {
  let fetcher: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules();
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
  const response = (body: BodyInit | null, init: ResponseInit) =>
    new Response(body, init);
  it("explains rate limiting with the Retry-After wait and does not retry", async () => {
    fetcher.mockResolvedValue(
      response("busy", {
        status: 429,
        headers: { "Content-Type": "text/plain", "Retry-After": "30" },
      }),
    );
    const { api } = await import("../src/api");
    await expect(api("/nation/KR")).rejects.toThrow("30초");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects broken JSON, empty bodies and JSON error statuses with Korean messages", async () => {
    const { api } = await import("../src/api");
    fetcher.mockResolvedValueOnce(
      response("{bad", { headers: { "Content-Type": "application/json" } }),
    );
    await expect(api("/warnings/KR")).rejects.toThrow("읽을 수 없습니다");
    fetcher.mockResolvedValueOnce(
      response(null, { headers: { "Content-Type": "application/json" } }),
    );
    await expect(api("/warnings/KR")).rejects.toThrow();
    fetcher.mockResolvedValueOnce(
      response(JSON.stringify({ error: { message: "Not found" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(api("/warnings/KR")).rejects.toThrow("Not found");
  });
  it("times out after 15 seconds with a Korean message", async () => {
    vi.useFakeTimers();
    fetcher.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal!.addEventListener("abort", () =>
            reject(init.signal!.reason),
          ),
        ),
    );
    const { api } = await import("../src/api");
    const pending: Promise<Error> = api("/warnings/KR").then(
      () => new Error("resolved"),
      (e: unknown) => e as Error,
    );
    await vi.advanceTimersByTimeAsync(15001);
    expect(String((await pending).message)).toContain("시간이 초과");
  });
});
