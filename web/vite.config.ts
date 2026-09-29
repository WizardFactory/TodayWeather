import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readTransportSettings } from "./src/transport-config";
type Env = Record<string, string | undefined>;
type Git = (command: string) => string;
const git: Git = (command) =>
  execFileSync("git", command.split(" "), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
/** Source commit for release.json: CI's GITHUB_SHA, else the local HEAD. */
export function releaseCommit(env: Env, run: Git = git): string {
  if (env.GITHUB_SHA) return env.GITHUB_SHA;
  try {
    const head = run("rev-parse HEAD").trim();
    if (!head) return "unknown";
    // Uncommitted changes make the build unreproducible from the commit.
    return run("status --porcelain").trim() ? head + "-dirty" : head;
  } catch {
    return "unknown";
  }
}
/** Build time; SOURCE_DATE_EPOCH (seconds) pins it for reproducible builds. */
function releaseBuiltAt(env: Env): string {
  const epoch = Number(env.SOURCE_DATE_EPOCH);
  return new Date(
    env.SOURCE_DATE_EPOCH && Number.isFinite(epoch) ? epoch * 1000 : Date.now(),
  ).toISOString();
}
export default defineConfig(({ mode }) => {
  const settings = readTransportSettings({
    ...loadEnv(mode, process.cwd(), "VITE_"),
    ...process.env,
  });
  return {
    plugins: [
      react(),
      {
        name: "static-release",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "release.json",
            source: JSON.stringify(
              {
                schemaVersion: 1,
                siteOrigin: "https://app.todayweather.ai",
                ...settings,
                commit: releaseCommit(process.env),
                builtAt: releaseBuiltAt(process.env),
              },
              null,
              2,
            ),
          });
        },
      },
    ],
    server: {
      host: "127.0.0.1",
      port: 5173,
    },
    build: { target: "es2022", sourcemap: false },
  };
});
