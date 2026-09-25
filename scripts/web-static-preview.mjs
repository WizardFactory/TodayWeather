/** Local static-only verification server. No proxy, API routes, credentials, or collectors. */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { runInNewContext } from "node:vm";
const root = resolve("web/dist");
const handler = runInNewContext(
  (await readFile("infra/web/static/route-request.js", "utf8")) + "\nhandler;",
);
const policy = JSON.parse(await readFile("infra/web/static/stack.json", "utf8"))
  .Resources.Headers.Properties.ResponseHeadersPolicyConfig;
const headers = {
  "Content-Security-Policy":
    policy.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy,
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  ...Object.fromEntries(
    policy.CustomHeadersConfig.Items.map((h) => [h.Header, h.Value]),
  ),
};
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
createServer(async (req, res) => {
  const result = handler({
    request: {
      uri: new URL(req.url, "http://static").pathname,
      method: req.method,
    },
  });
  if (result.statusCode) {
    res.writeHead(result.statusCode);
    res.end();
    return;
  }
  try {
    const file = join(root, decodeURIComponent(result.uri));
    if (!(await stat(file)).isFile()) throw Error();
    res.writeHead(200, {
      ...headers,
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "Cache-Control": result.uri.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : await readFile(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(Number(process.env.PORT ?? 4174), "127.0.0.1", () =>
  console.log(
    "Static files only: http://127.0.0.1:" + (process.env.PORT ?? 4174),
  ),
);
