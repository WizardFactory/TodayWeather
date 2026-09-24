import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import { NotificationService, validateRule } from "../src/notifications";
import { DEFAULT_UNITS, PLACES } from "@todayweather/core";
const input = {
  place: PLACES[0],
  units: DEFAULT_UNITS,
  timezone: "Asia/Seoul",
  days: [0, 1, 2, 3, 4, 5, 6],
  times: ["07:00"],
  enabled: true,
  alert: { enabled: false, start: "07:00", end: "22:00" },
  revision: 0,
};
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test",
  keys: {
    p256dh: Buffer.alloc(65, 1).toString("base64url"),
    auth: Buffer.alloc(16, 2).toString("base64url"),
  },
};
const request = (method: string, headers: Record<string, string> = {}) =>
  ({ method, headers }) as IncomingMessage;
async function setup(send: () => Promise<unknown>) {
  const directory = await mkdtemp(join(tmpdir(), "tw-review-"));
  const service = new NotificationService({
    directory,
    secret: "test-only-".repeat(5),
    publicKey: "test",
    privateKey: "test",
    subject: "mailto:test@example.com",
    secure: false,
    send,
  });
  const install = await service.handle(request("POST"), "/installations", {});
  const headers = {
    cookie: install.headers!["Set-Cookie"].split(";")[0],
    "x-csrf-token": (install.body as any).csrf,
  };
  await service.handle(
    request("PUT", headers),
    "/subscriptions/current",
    subscription,
  );
  return {
    service,
    headers,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
it("rejects malformed and mismatched notification place identities", () => {
  for (const id of [
    "",
    "../settings",
    "seoul?x=1",
    "unknown",
    "p_91_1",
    "p_1_2",
  ])
    expect(
      () => validateRule({ ...input, place: { ...input.place, id } }, "r"),
      id,
    ).toThrow();
  expect(validateRule(input, "r").place.id).toBe("seoul");
  expect(
    validateRule(
      { ...input, place: { ...input.place, id: "p_37.567_126.978" } },
      "r",
    ).place.id,
  ).toBe("p_37.567_126.978");
});
it("keeps settings responsive during test sends and preserves a replacement on stale 410", async () => {
  let release!: (v?: unknown) => void, started!: () => void;
  const gate = new Promise(
    (_, reject) => (release = () => reject({ statusCode: 410 })),
  );
  const sending = new Promise<void>((r) => (started = r));
  const { service, headers, cleanup } = await setup(async () => {
    started();
    return gate;
  });
  let pending: Promise<unknown> | undefined;
  try {
    pending = service
      .handle(request("POST", headers), "/notifications/test", {})
      .catch((e) => e);
    await sending;
    const replacement = {
      ...subscription,
      keys: {
        ...subscription.keys,
        auth: Buffer.alloc(16, 3).toString("base64url"),
      },
    };
    const mutation = service.handle(
      request("PUT", headers),
      "/subscriptions/current",
      replacement,
    );
    const fast = await Promise.race([
      mutation.then(() => true),
      new Promise((r) => setTimeout(() => r(false), 100)),
    ]);
    release();
    await pending;
    await mutation;
    expect(fast).toBe(true);
    const session = await service.handle(
      request("POST", headers),
      "/installations",
      {},
    );
    expect((session.body as any).subscribed).toBe(true);
  } finally {
    release();
    await pending;
    await cleanup();
  }
});
it("sends with bounded concurrency outside the claim lock and deduplicates concurrent ticks", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let active = 0,
    maximum = 0,
    count = 0;
  const { service, headers, cleanup } = await setup(async () => {
    count++;
    active++;
    maximum = Math.max(maximum, active);
    await gate;
    active--;
  });
  let ticks: Promise<unknown>[] = [];
  try {
    for (let i = 0; i < 6; i++)
      await service.handle(
        request("PUT", headers),
        "/notification-rules/r" + i,
        input,
      );
    const time = new Date("2026-09-23T22:00:00Z");
    ticks = [service.tick(time), service.tick(time)];
    await new Promise((r) => setTimeout(r, 100));
    const read = service.handle(
      request("GET", headers),
      "/notification-rules",
      {},
    );
    const fast = await Promise.race([
      read.then(() => true),
      new Promise((r) => setTimeout(() => r(false), 100)),
    ]);
    const observed = maximum;
    release();
    await Promise.all(ticks);
    await read;
    expect(fast).toBe(true);
    expect(observed).toBe(4);
    expect(maximum).toBe(4);
    expect(count).toBe(6);
  } finally {
    release();
    await Promise.all(ticks);
    await cleanup();
  }
});
it("recovers a missed minute within five minutes and never replays older or duplicate alarms", async () => {
  let count = 0;
  const { service, headers, cleanup } = await setup(async () => {
    count++;
  });
  try {
    await service.handle(
      request("PUT", headers),
      "/notification-rules/r",
      input,
    );
    await service.tick(new Date("2026-09-23T21:59:30Z"));
    await service.tick(new Date("2026-09-23T22:02:00Z"));
    expect(count).toBe(1);
    await service.tick(new Date("2026-09-23T22:02:30Z"));
    expect(count).toBe(1);
    await service.tick(new Date("2026-09-24T22:06:00Z"));
    expect(count).toBe(1);
  } finally {
    await cleanup();
  }
});
it("rechecks queued rule deletion and revision before delivery", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let count = 0;
  const { service, headers, cleanup } = await setup(async () => {
    count++;
    await gate;
  });
  let tick: Promise<unknown> | undefined;
  try {
    for (let i = 0; i < 6; i++)
      await service.handle(
        request("PUT", headers),
        "/notification-rules/r" + i,
        input,
      );
    tick = service.tick(new Date("2026-09-23T22:00:00Z"));
    await new Promise((r) => setTimeout(r, 100));
    expect(count).toBe(4);
    await service.handle(
      request("DELETE", headers),
      "/notification-rules/r4",
      {},
    );
    await service.handle(request("PUT", headers), "/notification-rules/r5", {
      ...input,
      revision: 1,
      times: ["08:00"],
    });
    release();
    await tick;
    expect(count).toBe(4);
  } finally {
    release();
    await tick;
    await cleanup();
  }
});
