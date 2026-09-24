import {
  randomBytes,
  randomUUID,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";
import webpush, { type PushSubscription } from "web-push";
import {
  coordinates,
  parseUnits,
  PLACES,
  placeId,
  type Place,
  type Units,
} from "@todayweather/core";
import { ApiError, type NotificationRoutes } from "./api";
export type NotificationRule = {
  id: string;
  place: Place;
  units: Units;
  timezone: string;
  days: number[];
  times: string[];
  enabled: boolean;
  alert: { enabled: boolean; start: string; end: string };
  revision: number;
};
type Install = {
  id: string;
  subscription?: PushSubscription;
  rules: NotificationRule[];
  seen: number;
  deliveries: Record<string, number>;
};
type Store = { version: 1; installations: Record<string, Install> };
type Delivery = {
  ownerId: string;
  subscription: PushSubscription;
  payload: unknown;
  rule?: { id: string; revision: number };
};
export type NotificationConfig = {
  directory: string;
  secret: string;
  publicKey: string;
  privateKey: string;
  subject: string;
  secure: boolean;
  send?: (subscription: PushSubscription, payload: string) => Promise<unknown>;
};
export function validateSubscription(input: unknown): PushSubscription {
  const r = input as PushSubscription;
  try {
    const u = new URL(r.endpoint);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.href.length > 2048
    )
      throw Error();
    const host = u.hostname,
      allowed =
        host === "fcm.googleapis.com" ||
        host === "updates.push.services.mozilla.com" ||
        host === "web.push.apple.com" ||
        host.endsWith(".push.apple.com") ||
        host.endsWith(".notify.windows.com");
    if (!allowed) throw Error();
    if (
      Buffer.from(r.keys.p256dh, "base64url").length !== 65 ||
      Buffer.from(r.keys.auth, "base64url").length !== 16
    )
      throw Error();
    return {
      endpoint: u.href,
      keys: { p256dh: r.keys.p256dh, auth: r.keys.auth },
    };
  } catch {
    throw new ApiError(
      400,
      "INVALID_SUBSCRIPTION",
      "지원하지 않는 알림 구독입니다.",
    );
  }
}
const timeValid = (v: unknown): v is string =>
  typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export function validateRule(input: unknown, id: string): NotificationRule {
  const r = input as NotificationRule;
  try {
    if (
      !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
      !r ||
      typeof r.enabled !== "boolean" ||
      !Array.isArray(r.days) ||
      r.days.length > 7 ||
      r.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
      !Array.isArray(r.times) ||
      r.times.length > 6 ||
      r.times.some((t) => !timeValid(t)) ||
      typeof r.timezone !== "string"
    )
      throw Error();
    new Intl.DateTimeFormat("en", { timeZone: r.timezone }).format();
    if (
      typeof r.place?.name !== "string" ||
      r.place.name.length > 160 ||
      typeof r.place.id !== "string" ||
      r.place.id.length > 100
    )
      throw Error();
    const c = coordinates(r.place.lat, r.place.lon),
      units = parseUnits(r.units);
    const known = PLACES.find((p) => p.id === r.place.id);
    if (
      known
        ? known.lat !== c.lat || known.lon !== c.lon
        : r.place.id !== placeId(c.lat, c.lon)
    )
      throw Error();
    if (
      !r.alert ||
      typeof r.alert.enabled !== "boolean" ||
      !timeValid(r.alert.start) ||
      !timeValid(r.alert.end)
    )
      throw Error();
    return {
      id,
      place: {
        id: r.place.id,
        name: r.place.name,
        address: String(r.place.address ?? "").slice(0, 300),
        country: String(r.place.country ?? "").slice(0, 3),
        ...c,
      },
      units,
      timezone: r.timezone,
      days: [...new Set(r.days)].sort(),
      times: [...new Set(r.times)].sort(),
      enabled: r.enabled,
      alert: {
        enabled: r.alert.enabled,
        start: r.alert.start,
        end: r.alert.end,
      },
      revision: Number.isInteger(r.revision) ? r.revision : 0,
    };
  } catch {
    throw new ApiError(
      400,
      "INVALID_RULE",
      "알림 지역, 요일, 시각과 시간대를 확인해 주세요.",
    );
  }
}
export function dueAlarm(rule: NotificationRule, now: Date): string | null {
  if (!rule.enabled) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: rule.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      value("weekday"),
    ),
    time = `${value("hour")}:${value("minute")}`;
  if (!rule.days.includes(day) || !rule.times.includes(time)) return null;
  // A wall-clock key suppresses repeated alarms in the DST fall-back hour.
  return `${rule.id}:${value("year")}-${value("month")}-${value("day")}:${time}`;
}
export class NotificationService implements NotificationRoutes {
  private state: Store = { version: 1, installations: {} };
  private ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private file: string;
  private activeSends = 0;
  private sendWaiters: (() => void)[] = [];
  private lastTickMinute?: number;
  constructor(private config: NotificationConfig) {
    if (config.secret.length < 32)
      throw new Error("Session secret must have at least 32 characters");
    if (!config.send)
      webpush.setVapidDetails(
        config.subject,
        config.publicKey,
        config.privateKey,
      );
    this.file = join(config.directory, "notifications.json");
    this.ready = this.load();
  }
  private async load() {
    await mkdir(this.config.directory, { recursive: true, mode: 0o700 });
    try {
      const data = JSON.parse(await readFile(this.file, "utf8"));
      if (data.version !== 1 || !data.installations)
        throw Error("Unsupported notification store");
      this.state = data;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  private async persist() {
    const temp = this.file + ".tmp";
    await writeFile(temp, JSON.stringify(this.state), { mode: 0o600 });
    await rename(temp, this.file);
  }
  private async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      await this.ready;
      return fn();
    });
    this.queue = task.catch(() => {});
    return task;
  }
  private sign(value: string) {
    return createHmac("sha256", this.config.secret)
      .update(value)
      .digest("base64url");
  }
  private session(req: IncomingMessage): Install | undefined {
    const token = (req.headers.cookie ?? "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("tw-install="))
      ?.slice(11);
    if (!token) return;
    const [id, signature] = token.split(".");
    if (!id || !signature) return;
    const expected = this.sign(id);
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      return;
    const install = this.state.installations[id];
    if (!install || Date.now() - install.seen > 90 * 86400000) return;
    return install;
  }
  capabilities() {
    return {
      enabled: true,
      publicKey: this.config.publicKey,
      alertsEnabled: false,
      reason:
        "정시 알림을 사용할 수 있습니다. 조건별 날씨 알림은 제공 자료와 규칙 검증 후 활성화됩니다.",
    };
  }
  async handle(req: IncomingMessage, path: string, body: unknown) {
    const result = await this.transaction(async () => {
      let owner = this.session(req);
      if (path === "/installations" && req.method === "POST") {
        if (!owner) {
          const now = Date.now();
          for (const [id, v] of Object.entries(this.state.installations))
            if (now - v.seen > 90 * 86400000)
              delete this.state.installations[id];
          if (Object.keys(this.state.installations).length >= 10000)
            throw new ApiError(
              503,
              "CAPACITY",
              "알림 등록을 잠시 사용할 수 없습니다.",
            );
          owner = {
            id: randomBytes(24).toString("base64url"),
            rules: [],
            seen: now,
            deliveries: {},
          };
          this.state.installations[owner.id] = owner;
        }
        owner.seen = Date.now();
        await this.persist();
        return {
          body: {
            csrf: this.sign("csrf:" + owner.id),
            subscribed: !!owner.subscription,
          },
          headers: {
            "Set-Cookie": `tw-install=${owner.id}.${this.sign(owner.id)}; Path=/api/web/v1; HttpOnly; SameSite=Strict; Max-Age=7776000${this.config.secure ? "; Secure" : ""}`,
          },
        };
      }
      if (!owner)
        throw new ApiError(
          401,
          "NO_INSTALLATION",
          "브라우저 알림 등록을 먼저 진행해 주세요.",
        );
      if (
        req.method !== "GET" &&
        req.headers["x-csrf-token"] !== this.sign("csrf:" + owner.id)
      )
        throw new ApiError(
          403,
          "INVALID_CSRF",
          "알림 설정 세션을 다시 열어 주세요.",
        );
      if (path === "/notification-rules" && req.method === "GET")
        return { body: { items: owner.rules } };
      if (path === "/subscriptions/current" && req.method === "PUT") {
        owner.subscription = validateSubscription(body);
        owner.seen = Date.now();
        await this.persist();
        return { body: { saved: true } };
      }
      if (path === "/subscriptions/current" && req.method === "DELETE") {
        delete owner.subscription;
        owner.rules = owner.rules.map((r) => ({
          ...r,
          enabled: false,
          revision: r.revision + 1,
        }));
        await this.persist();
        return { body: { deleted: true } };
      }
      if (path.startsWith("/notification-rules/")) {
        const id = path.slice("/notification-rules/".length),
          index = owner.rules.findIndex((r) => r.id === id);
        if (req.method === "DELETE") {
          if (index >= 0) owner.rules.splice(index, 1);
          await this.persist();
          return { body: { deleted: true } };
        }
        if (req.method === "PUT") {
          if (!owner.subscription)
            throw new ApiError(
              409,
              "NO_SUBSCRIPTION",
              "브라우저 알림 권한과 구독을 먼저 등록해 주세요.",
            );
          const rule = validateRule(body, id);
          if (rule.alert.enabled)
            throw new ApiError(
              422,
              "ALERTS_UNAVAILABLE",
              "조건별 알림은 아직 지원하지 않습니다. 정시 알림을 이용해 주세요.",
            );
          if (index < 0 && owner.rules.length >= 30)
            throw new ApiError(
              400,
              "RULE_LIMIT",
              "최대 30개 지역의 알림을 저장할 수 있습니다.",
            );
          if (index >= 0 && rule.revision !== owner.rules[index].revision)
            throw new ApiError(
              409,
              "REVISION_CONFLICT",
              "다른 창에서 설정을 변경했습니다. 다시 불러와 주세요.",
            );
          rule.revision = (index < 0 ? 0 : owner.rules[index].revision) + 1;
          if (index < 0) owner.rules.push(rule);
          else owner.rules[index] = rule;
          owner.seen = Date.now();
          await this.persist();
          return { body: { item: rule } };
        }
      }
      if (path === "/notifications/test" && req.method === "POST") {
        if (!owner.subscription)
          throw new ApiError(
            409,
            "NO_SUBSCRIPTION",
            "먼저 알림을 등록해 주세요.",
          );
        if (Date.now() - (owner.deliveries.test ?? 0) < 60000)
          throw new ApiError(
            429,
            "TEST_LIMIT",
            "시험 알림은 1분에 한 번 보낼 수 있습니다.",
          );
        owner.deliveries.test = Date.now();
        await this.persist();
        const delivery: Delivery = {
          ownerId: owner.id,
          subscription: structuredClone(owner.subscription),
          payload: {
            title: "오늘날씨 알림 확인",
            body: "웹 알림 연결을 확인했습니다.",
            url: "/locations",
            tag: "tw-test",
          },
        };
        return { body: { accepted: true, displayConfirmed: false }, delivery };
      }
      throw new ApiError(
        405,
        "METHOD_NOT_ALLOWED",
        "지원하지 않는 알림 요청입니다.",
      );
    });
    if ("delivery" in result && result.delivery) {
      const { delivery, ...response } = result;
      if (!(await this.deliver(delivery)))
        throw new ApiError(
          409,
          "SUBSCRIPTION_CHANGED",
          "알림 구독이 변경됐습니다. 다시 확인해 주세요.",
        );
      return response;
    }
    return result;
  }
  private async send(subscription: PushSubscription, payload: unknown) {
    const text = JSON.stringify(payload);
    if (this.config.send) return this.config.send(subscription, text);
    return webpush.sendNotification(subscription, text, {
      TTL: 300,
      timeout: 10000,
    });
  }
  private sameSubscription(
    a: PushSubscription | undefined,
    b: PushSubscription,
  ) {
    return (
      a?.endpoint === b.endpoint &&
      a.keys.auth === b.keys.auth &&
      a.keys.p256dh === b.keys.p256dh
    );
  }
  private async deliver(job: Delivery): Promise<boolean> {
    if (this.activeSends >= 4)
      await new Promise<void>((resolve) => this.sendWaiters.push(resolve));
    else this.activeSends++;
    try {
      const valid = await this.transaction(async () => {
        const owner = this.state.installations[job.ownerId];
        return (
          !!owner &&
          this.sameSubscription(owner.subscription, job.subscription) &&
          (!job.rule ||
            owner.rules.some(
              (rule) =>
                rule.id === job.rule!.id &&
                rule.revision === job.rule!.revision &&
                rule.enabled,
            ))
        );
      });
      if (!valid) return false;
      try {
        await this.send(job.subscription, job.payload);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410)
          await this.transaction(async () => {
            const owner = this.state.installations[job.ownerId];
            if (
              owner &&
              this.sameSubscription(owner.subscription, job.subscription)
            ) {
              delete owner.subscription;
              await this.persist();
            }
          });
        throw error;
      }
      return true;
    } finally {
      const next = this.sendWaiters.shift();
      if (next) next();
      else this.activeSends--;
    }
  }
  async tick(now = new Date()) {
    const jobs = await this.transaction(async () => {
      const end = Math.floor(now.getTime() / 60000) * 60000;
      if (!Number.isFinite(end)) return [];
      // Startup checks the current minute. Later invocations recover at most five wall minutes.
      const start = Math.max(this.lastTickMinute ?? end, end - 4 * 60000);
      this.lastTickMinute = Math.max(this.lastTickMinute ?? end, end);
      const deliveries: Delivery[] = [];
      for (const owner of Object.values(this.state.installations)) {
        if (!owner.subscription || now.getTime() - owner.seen > 90 * 86400000)
          continue;
        for (const rule of owner.rules) {
          for (let minute = start; minute <= end; minute += 60000) {
            const key = dueAlarm(rule, new Date(minute));
            if (!key || owner.deliveries[key]) continue;
            owner.deliveries[key] = now.getTime(); // Persist dedupe before sending: prefer a missed delivery over duplicate storm after a crash.
            for (const [k, t] of Object.entries(owner.deliveries))
              if (now.getTime() - t > 7 * 86400000) delete owner.deliveries[k];
            deliveries.push({
              ownerId: owner.id,
              subscription: structuredClone(owner.subscription),
              rule: { id: rule.id, revision: rule.revision },
              payload: {
                title: `${rule.place.name} · 날씨를 확인할 시간`,
                body: "오늘의 기온과 미세먼지를 확인해 보세요.",
                url: `/weather/${rule.place.id}/hourly`,
                place: rule.place,
                tag: key,
              },
            });
          }
        }
      }
      // One durable claim write per tick, before any network delivery.
      if (deliveries.length) await this.persist();
      return deliveries;
    });
    await Promise.all(
      jobs.map((job) =>
        this.deliver(job).catch((error) => {
          console.error(
            JSON.stringify({
              event: "web_push_send_failed",
              status:
                (error as { statusCode?: number }).statusCode ?? "unknown",
            }),
          );
        }),
      ),
    );
  }
}
