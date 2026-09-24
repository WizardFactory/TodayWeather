import { afterEach, describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { createApi, type ApiConfig } from "../src/api";
import kma from "../../docs/rewrite/examples/client-kma-response.json";
const servers: Server[] = [];
async function start(options: Partial<ApiConfig> = {}) {
  const server = createServer(
    createApi({
      mode: "demo",
      upstream: "https://weather.example",
      origin: "http://localhost",
      ...options,
    }),
  );
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((r) => {
          s.closeAllConnections();
          s.close(() => r());
        }),
    ),
  );
});
describe("isolated web API", () => {
  it("returns explicitly labeled sample data and changed units", async () => {
    const base = await start();
    const r = await fetch(
      base + "/api/web/v1/weather?lat=37.567&lon=126.978&temperatureUnit=F",
    );
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.mode).toBe("demo");
    expect(d.units.temperatureUnit).toBe("F");
    expect(d.current.temperature).toBeGreaterThan(32);
  });
  it("rejects invalid coordinates/units rather than silently defaulting", async () => {
    const base = await start();
    for (const q of [
      "lat=&lon=0",
      "lat=91&lon=0",
      "lat=0&lon=181",
      "lat=0&lon=0&temperatureUnit=X",
    ])
      expect((await fetch(base + "/api/web/v1/weather?" + q)).status).toBe(400);
  });
  it("keeps API missing route and method status truthful", async () => {
    const base = await start();
    expect((await fetch(base + "/api/missing")).status).toBe(404);
    expect(
      (
        await fetch(base + "/api/web/v1/weather?lat=0&lon=0", {
          method: "POST",
        })
      ).status,
    ).toBe(405);
  });
  it("live mode never silently returns demo after upstream failure", async () => {
    const base = await start({
      mode: "live",
      fetch: async () => new Response("provider down", { status: 503 }),
    });
    const r = await fetch(base + "/api/web/v1/weather?lat=0&lon=0");
    expect(r.status).toBe(502);
    expect((await r.json()).error.code).toBe("UPSTREAM_FAILURE");
  });
  it("rejects HTML at status 200 and upstream redirects", async () => {
    for (const response of [
      new Response("<html>error</html>", {
        headers: { "content-type": "text/html" },
      }),
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/" },
      }),
    ]) {
      const base = await start({ mode: "live", fetch: async () => response });
      expect(
        (await fetch(base + "/api/web/v1/weather?lat=0&lon=0")).status,
      ).toBe(502);
    }
  });
  it("uses explicit v000903, canonical physical units and valid zero coordinates", async () => {
    let called = "";
    const base = await start({
      mode: "live",
      fetch: async (input) => {
        called = String(input);
        return Response.json({
          ...kma.response,
          location: { lat: 0, long: 0 },
        });
      },
    });
    const r = await fetch(
      base +
        "/api/web/v1/weather?lat=0&lon=0&precipitationUnit=in&windSpeedUnit=mph",
    );
    expect(r.status).toBe(200);
    expect(called).toContain("/weather/v000903/coord/0,0");
    expect(called).toContain("precipitationUnit=mm");
    expect(called).not.toContain("mph");
    expect((await r.json()).mode).toBe("live");
  });
  it("returns nation, warnings and search without legacy runtime", async () => {
    const base = await start();
    expect(
      (await (await fetch(base + "/api/web/v1/nation/KR")).json()).weather
        .length,
    ).toBeGreaterThan(0);
    expect(
      (await (await fetch(base + "/api/web/v1/warnings/KR")).json()).items
        .length,
    ).toBeGreaterThan(0);
    expect(
      (await (await fetch(base + "/api/web/v1/locations/search?q=부산")).json())
        .items[0].id,
    ).toBe("busan");
  });
  it("does not promise push when sender is not configured", async () => {
    const base = await start();
    const r = await fetch(base + "/api/web/v1/capabilities");
    expect(r.status).toBe(200);
    expect((await r.json()).notifications.enabled).toBe(false);
  });
});
