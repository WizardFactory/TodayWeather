import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Fails fast when web/dist is older than its sources (G22). */
export default function globalSetup() {
  // Explicit opt-out for recording Red runs against a deliberately older build.
  if (process.env.WEB_E2E_ALLOW_STALE_DIST === "1") return;
  const built = statSync("web/dist/index.html", { throwIfNoEntry: false });
  if (!built)
    throw new Error("web/dist is missing; run npm run build:web first.");
  const newest = (path: string): number => {
    const s = statSync(path);
    if (!s.isDirectory()) return s.mtimeMs;
    return Math.max(
      0,
      ...readdirSync(path).map((name) => newest(join(path, name))),
    );
  };
  const sources = Math.max(
    ...[
      "web/src",
      "web/public",
      "web/index.html",
      "web/vite.config.ts",
      "scripts/web-precache.mjs",
      "packages/weather-core/src",
      ...readdirSync("web")
        .filter((name) => name.startsWith(".env"))
        .map((name) => join("web", name)),
    ].map(newest),
  );
  if (sources > built.mtimeMs)
    throw new Error(
      "web/dist is older than its sources (web app, build config, precache script or weather-core); run npm run build:web first.",
    );
}
