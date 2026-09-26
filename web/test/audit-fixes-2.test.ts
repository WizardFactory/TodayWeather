import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInNewContext } from "node:vm";
import { isOld, weatherStaleTime } from "../src/format";
// @ts-expect-error standalone JavaScript deployment command
import { main as deploy } from "../../scripts/deploy-web-static.mjs";
import { releaseCommit } from "../vite.config";

describe("overseas staleness never flags a fresh reading (round 2, F2)", () => {
  it("uses the latest time zone as the end of an overseas local date", () => {
    // 23:00 local in UTC-12 is 11:00Z next day; two hours later is still fresh.
    expect(
      isOld("2026-09-25 23:00", 3, Date.parse("2026-09-26T13:00:00Z"), "local"),
    ).toBe(false);
    expect(
      isOld("2026-09-25 23:00", 3, Date.parse("2026-09-26T15:01:00Z"), "local"),
    ).toBe(true);
  });
});

describe("rate-limited snapshots wait for Retry-After (round 2, N1)", () => {
  it("keeps a rate-limited snapshot fresh until the retry time", () => {
    const now = Date.now();
    const wait = weatherStaleTime({ snapshot: true, retryAt: now + 30000 });
    expect(wait).toBeGreaterThan(25000);
    expect(wait).toBeLessThanOrEqual(30000);
    expect(weatherStaleTime({ snapshot: true })).toBe(0);
    expect(weatherStaleTime({ snapshot: true, retryAt: now - 1 })).toBe(0);
  });
});

describe("Retry-After as an HTTP date (round 3, T7)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("waits until the given date", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_WEB_TRANSPORT", "direct");
    vi.stubEnv("VITE_WEB_MODE", "live");
    const at = new Date(Date.now() + 120000).toUTCString();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("busy", { status: 429, headers: { "Retry-After": at } }),
        ),
    );
    const { api } = await import("../src/api");
    const error = await api("/nation/KR").then(
      () => null,
      (e: unknown) => e as Error & { retryAfterMs?: number },
    );
    expect(error?.retryAfterMs).toBeGreaterThan(110000);
    expect(error?.retryAfterMs).toBeLessThanOrEqual(120000);
  });
});

describe("saved times are shown in KST whatever the device zone (round 3, T7)", () => {
  it("formats an ISO instant in Asia/Seoul", async () => {
    const { kstTime } = await import("../src/components");
    // Pretend the device is in Los Angeles; 15:30Z is 00:30 next day in Seoul.
    const zone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    let text: string;
    try {
      text = kstTime("2026-09-25T15:30:00Z");
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
    expect(text).toContain("9. 26.");
    expect(text).toContain("00:30");
    expect(kstTime("nope")).toBe("정보 없음");
  });
});

describe("429 and 503 are described separately (round 2, N4)", () => {
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
  it("uses rate-limit wording only for 429 and exposes the wait", async () => {
    fetcher.mockResolvedValueOnce(
      new Response("busy", {
        status: 429,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    const { api } = await import("../src/api");
    const error = await api("/nation/KR").then(
      () => null,
      (e: unknown) => e as Error & { retryAfterMs?: number },
    );
    expect(error?.message).toContain("요청이 많아");
    expect(error?.retryAfterMs).toBe(60000);
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "maintenance" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const outage = await api("/nation/KR").then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(outage?.message).not.toContain("요청이 많아");
    expect(outage?.message).toContain("일시적으로");
  });
});

describe("service worker activation spares a newer installing release (round 2, N3)", () => {
  function load(installing: boolean, failInstall = false) {
    const handlers: Record<string, Function> = {};
    const stores: Record<string, Map<string, string>> = {
      "tw-shell-prev": new Map([["/__complete__", "1"]]),
      "tw-shell-next": new Map(),
      "tw-shell-__BUILD_VERSION__": new Map([["/__complete__", "1"]]),
    };
    const deleted: string[] = [];
    const caches = {
      keys: async () => Object.keys(stores),
      open: async (key: string) => {
        stores[key] ??= new Map();
        return {
          match: async (r: string) => stores[key]?.get(r),
          addAll: async (list: string[]) => {
            if (failInstall) throw new Error("fetch failed");
            for (const item of list) stores[key].set(item, "x");
          },
          put: async (r: string, v: unknown) => stores[key].set(r, String(v)),
        };
      },
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
        registration: { installing: installing ? {} : null },
        clients: { claim: async () => {} },
        addEventListener: (name: string, fn: Function) => (handlers[name] = fn),
      },
    });
    return { handlers, stores, deleted };
  }
  it("keeps an incomplete cache while another worker is installing", async () => {
    const { handlers, deleted } = load(true);
    let done: Promise<unknown> = Promise.resolve();
    handlers.activate({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(deleted).not.toContain("tw-shell-next");
  });
  it("writes the completion marker after install", async () => {
    const { handlers, stores } = load(false);
    let done: Promise<unknown> = Promise.resolve();
    handlers.install({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(stores["tw-shell-__BUILD_VERSION__"].has("/__complete__")).toBe(
      true,
    );
  });
  it("deletes its own cache and fails the install when a file is missing", async () => {
    const { handlers, stores, deleted } = load(false, true);
    let done: Promise<unknown> = Promise.resolve();
    handlers.install({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await expect(done).rejects.toThrow("fetch failed");
    expect(deleted).toContain("tw-shell-__BUILD_VERSION__");
    expect(stores["tw-shell-prev"].has("/__complete__")).toBe(true);
  });
});

describe("release identity marks uncommitted builds (round 2, N7)", () => {
  it("adds -dirty when the working tree has changes and trusts CI", () => {
    expect(
      releaseCommit({}, (cmd) =>
        cmd.includes("rev-parse") ? "abc1234\n" : " M web/src/App.tsx\n",
      ),
    ).toBe("abc1234-dirty");
    expect(
      releaseCommit({}, (cmd) =>
        cmd.includes("rev-parse") ? "abc1234\n" : "",
      ),
    ).toBe("abc1234");
    expect(releaseCommit({ GITHUB_SHA: "f00d" }, () => "x")).toBe("f00d");
  });
  it("refuses to execute an upload of a dirty build", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tw-dirty-"));
    try {
      writeFileSync(
        join(dir, "release.json"),
        JSON.stringify({
          schemaVersion: 1,
          mode: "live",
          transport: "direct",
          apiOrigin: "https://todayweather.wizardfactory.net",
          siteOrigin: "https://app.tdywx.xyz",
          commit: "abc1234-dirty",
          builtAt: "2026-09-26T00:00:00.000Z",
        }),
      );
      writeFileSync(join(dir, "index.html"), "<!doctype html>");
      await expect(
        deploy([
          "--dir",
          dir,
          "--bucket",
          "b",
          "--distribution",
          "d",
          "--execute",
        ]),
      ).rejects.toThrow(/uncommitted/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
