import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { createApi } from "./api";
import { NotificationService } from "./notifications";
const mode = process.env.WEB_API_MODE ?? "live";
if (mode !== "live" && mode !== "demo")
  throw new Error("WEB_API_MODE must be live or demo");
const port = Number(process.env.PORT ?? 4174),
  host = process.env.HOST ?? "127.0.0.1",
  origin = process.env.WEB_ORIGIN ?? `http://localhost:${port}`;
let notifications: NotificationService | undefined;
if (process.env.WEB_PUSH_ENABLED === "true") {
  for (const key of [
    "WEB_PUSH_PUBLIC_KEY",
    "WEB_PUSH_PRIVATE_KEY",
    "WEB_PUSH_SUBJECT",
    "WEB_SESSION_SECRET",
    "WEB_DATA_DIR",
  ])
    if (!process.env[key]) throw new Error(`${key} is required for web push`);
  notifications = new NotificationService({
    directory: process.env.WEB_DATA_DIR!,
    secret: process.env.WEB_SESSION_SECRET!,
    publicKey: process.env.WEB_PUSH_PUBLIC_KEY!,
    privateKey: process.env.WEB_PUSH_PRIVATE_KEY!,
    subject: process.env.WEB_PUSH_SUBJECT!,
    secure: origin.startsWith("https:"),
  });
}
const api = createApi({
  mode,
  upstream:
    process.env.UPSTREAM_API_BASE_URL ??
    "https://todayweather.wizardfactory.net",
  origin,
  notifications,
  trustProxy: process.env.WEB_TRUST_PROXY === "true",
});
const root = resolve(process.env.WEB_STATIC_DIR ?? "web/dist");
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  if ((req.url ?? "").startsWith("/api/")) {
    await api(req, res);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  let path;
  try {
    path = decodeURIComponent(
      new URL(req.url ?? "/", "http://localhost").pathname,
    );
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (path.includes("\0") || path.includes("..") || path.includes("\\")) {
    res.writeHead(400);
    res.end();
    return;
  }
  // Only known navigation routes receive the SPA shell. Missing APIs/assets never become HTML 200.
  const navigation =
    /^\/(?:$|start\/?$|locations\/?$|settings(?:\/[^.]*)?$|help\/?$|membership\/?$|warnings\/?$|(?:air|place|notifications)\/[^/]+\/?$|weather\/[^/]+\/(?:hourly|daily|overview)\/?$|nation\/(?:weather|air)\/?$)/.test(
      path,
    );
  const file = join(root, navigation ? "index.html" : path);
  try {
    if (!(await stat(file)).isFile()) throw Error();
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream",
      "Cache-Control": path.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "geolocation=(self)",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});
server.listen(port, host, () =>
  console.log(
    JSON.stringify({
      event: "web_server_ready",
      port,
      mode,
      notifications: !!notifications,
    }),
  ),
);
const timer = notifications
  ? setInterval(
      () =>
        void notifications!
          .tick()
          .catch(() =>
            console.error(JSON.stringify({ event: "web_scheduler_failure" })),
          ),
      30000,
    )
  : undefined;
function close() {
  if (timer) clearInterval(timer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
