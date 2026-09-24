import { describe, it, expect } from "vitest";
import {
  dueAlarm,
  validateRule,
  validateSubscription,
  NotificationService,
  type NotificationRule,
} from "../src/notifications";
import { DEFAULT_UNITS, PLACES } from "@todayweather/core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
const input = {
  place: PLACES[0],
  units: DEFAULT_UNITS,
  timezone: "Asia/Seoul",
  days: [1, 2, 3, 4, 5],
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
describe("owned web notifications", () => {
  it("rejects arbitrary outbound destinations and invalid keys", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/x",
      "https://127.0.0.1/x",
      "https://fcm.googleapis.com.evil.test/x",
      "https://user@fcm.googleapis.com/x",
    ])
      expect(() =>
        validateSubscription({ ...subscription, endpoint }),
      ).toThrow();
    expect(validateSubscription(subscription)).toEqual(subscription);
  });
  it("validates weekdays, times, coordinates and timezones", () => {
    expect(validateRule(input, "rule").times).toEqual(["07:00"]);
    for (const patch of [
      { days: [7] },
      { times: ["24:00"] },
      { timezone: "invalid" },
      { place: { ...PLACES[0], lat: 100 } },
    ])
      expect(() => validateRule({ ...input, ...patch }, "r")).toThrow();
  });
  it("resolves weekdays in the rule timezone and dedupes DST repeated hour by wall time", () => {
    const r = validateRule(input, "r");
    expect(dueAlarm(r, new Date("2026-09-23T22:00:00Z"))).toBe(
      "r:2026-09-24:07:00",
    );
    expect(dueAlarm(r, new Date("2026-09-26T22:00:00Z"))).toBeNull();
    const dst = {
      ...r,
      timezone: "America/New_York",
      days: [0],
      times: ["01:30"],
    };
    expect(dueAlarm(dst, new Date("2026-11-01T05:30:00Z"))).toBe(
      dueAlarm(dst, new Date("2026-11-01T06:30:00Z")),
    );
  });
  it("persists ownership/revisions, rejects CSRF, deduplicates sends and retains state on restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tw-notify-"));
    let sends = 0;
    const config = {
      directory,
      secret: "x".repeat(40),
      publicKey: "test",
      privateKey: "test",
      subject: "mailto:test@example.com",
      secure: false,
      send: async () => {
        sends++;
      },
    };
    try {
      const service = new NotificationService(config),
        created = await service.handle(request("POST"), "/installations", {});
      const cookie = created.headers!["Set-Cookie"].split(";")[0],
        csrf = (created.body as { csrf: string }).csrf;
      await expect(
        service.handle(
          request("PUT", { cookie }),
          "/subscriptions/current",
          subscription,
        ),
      ).rejects.toThrow();
      const headers = { cookie, "x-csrf-token": csrf };
      await service.handle(
        request("PUT", headers),
        "/subscriptions/current",
        subscription,
      );
      const result = await service.handle(
        request("PUT", headers),
        "/notification-rules/r",
        input,
      );
      expect((result.body as { item: NotificationRule }).item.revision).toBe(1);
      await expect(
        service.handle(request("PUT", headers), "/notification-rules/r", input),
      ).rejects.toThrow(/변경/);
      await service.tick(new Date("2026-09-23T22:00:00Z"));
      await service.tick(new Date("2026-09-23T22:00:00Z"));
      expect(sends).toBe(1);
      const other = await service.handle(request("POST"), "/installations", {});
      const otherCookie = other.headers!["Set-Cookie"].split(";")[0];
      expect(
        (
          await service.handle(
            request("GET", { cookie: otherCookie }),
            "/notification-rules",
            {},
          )
        ).body,
      ).toEqual({ items: [] });
      const restarted = new NotificationService(config);
      const rules = await restarted.handle(
        request("GET", { cookie }),
        "/notification-rules",
        {},
      );
      expect((rules.body as { items: unknown[] }).items.length).toBe(1);
      await restarted.handle(
        request("DELETE", headers),
        "/subscriptions/current",
        {},
      );
      await restarted.tick(new Date("2026-09-24T22:00:00Z"));
      expect(sends).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
