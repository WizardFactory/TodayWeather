import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
it("uses the current shell but retains previous hashed assets", async () => {
  const handlers: Record<string, Function> = {};
  const current = new Map([
    ["/manifest.webmanifest", "new manifest"],
    ["/index.html", "new index"],
  ]);
  const previous = new Map([
    ["/manifest.webmanifest", "old manifest"],
    ["/index.html", "old index"],
    ["/assets/old.js", "old tab chunk"],
  ]);
  const path = (r: any) =>
    typeof r === "string" ? r : new URL(r.url).pathname;
  const caches = {
    keys: async () => ["tw-shell-old", "tw-shell-__BUILD_VERSION__"],
    open: async (key: string) => ({
      match: async (r: any) =>
        (key === "tw-shell-old" ? previous : current).get(path(r)),
    }),
    match: async (r: any) => previous.get(path(r)) ?? current.get(path(r)),
  };
  runInNewContext(readFileSync("web/public/sw.js", "utf8"), {
    URL,
    Response,
    caches,
    fetch: async () => "network",
    self: {
      location: { origin: "https://web.example" },
      addEventListener: (name: string, fn: Function) => (handlers[name] = fn),
    },
  });
  const request = async (p: string) => {
    let result: any;
    handlers.fetch({
      request: { url: "https://web.example" + p, method: "GET", mode: "cors" },
      respondWith: (r: any) => (result = r),
    });
    return await result;
  };
  expect(await request("/manifest.webmanifest")).toBe("new manifest");
  expect(await request("/assets/old.js")).toBe("old tab chunk");
});
it("keeps server and worker navigation routes compatible", () => {
  const regex = (file: string) =>
    new RegExp(
      readFileSync(file, "utf8")
        .split("\n")
        .find((l) => l.trim().startsWith("/^\\/(?:$|start"))!
        .trim()
        .slice(1, -7),
    );
  const server = regex("web-api/src/server.ts"),
    worker = regex("web/public/sw.js");
  for (const path of [
    "/",
    "/settings",
    "/weather/p_37.567_126.978/hourly",
    "/nation/air",
    "/api/web/v1/missing",
    "/assets/missing.js",
    "/unknown",
  ])
    expect(worker.test(path), path).toBe(server.test(path));
  expect(server.test("/api/web/v1/missing")).toBe(false);
  expect(server.test("/weather/p_37.567_126.978/hourly")).toBe(true);
});
