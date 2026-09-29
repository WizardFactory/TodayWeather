import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

it("removes only app shell caches, unregisters and returns app windows to the placeholder", async () => {
  const handlers: Record<string, (event: any) => void> = {};
  const order: string[] = [];
  const navigate = vi.fn(async () => {
    order.push("navigate");
  });
  const remove = vi.fn(async (key) => {
    order.push(key);
    return true;
  });
  const unregister = vi.fn(async () => {
    order.push("unregister");
    return true;
  });
  const skipWaiting = vi.fn(async () => {});
  runInNewContext(readFileSync("infra/web/static/recovery-worker.js", "utf8"), {
    URL,
    self: {
      addEventListener: (name: string, fn: any) => {
        handlers[name] = fn;
      },
      skipWaiting,
      registration: { scope: "https://app.todayweather.ai/", unregister },
      clients: {
        claim: async () => {
          order.push("claim");
        },
        matchAll: async () => [
          { url: "https://app.todayweather.ai/weather/seoul/hourly", navigate },
          {
            url: "https://example.org/",
            navigate: () => {
              throw Error("foreign navigation");
            },
          },
        ],
      },
    },
    caches: {
      keys: async () => ["tw-shell-old", "tw-shell-new", "other-app"],
      delete: remove,
    },
  });
  let pending: Promise<unknown>;
  const event = {
    waitUntil: (promise: Promise<unknown>) => {
      pending = promise;
    },
  };
  handlers.install(event);
  await pending!;
  expect(skipWaiting).toHaveBeenCalledOnce();
  handlers.activate(event);
  await pending!;
  expect(remove.mock.calls).toEqual([["tw-shell-old"], ["tw-shell-new"]]);
  expect(unregister).toHaveBeenCalledOnce();
  expect(navigate).toHaveBeenCalledWith("https://app.todayweather.ai/");
  expect(order.indexOf("unregister")).toBeLessThan(order.indexOf("navigate"));
  expect(order.indexOf("claim")).toBeLessThan(order.indexOf("unregister"));
});
