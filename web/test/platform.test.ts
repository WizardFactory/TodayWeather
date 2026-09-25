import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
describe("native and development boundaries", () => {
  it("loads existing Cordova CommonJS modules with an isolated legacy Q stub", () => {
    const dir = mkdtempSync(join(tmpdir(), "tw-native-scope-"));
    mkdirSync(join(dir, "q"));
    writeFileSync(join(dir, "q/index.js"), "module.exports = {};\n");
    try {
      for (const platform of ["tw.ios", "ta.ios", "applewatch"]) {
        const result = spawnSync(
          process.execPath,
          [platform + "/cordova/lib/versions.js"],
          { encoding: "utf8", env: { ...process.env, NODE_PATH: dir } },
        );
        expect(result.stderr).not.toContain("ES module scope");
        expect(result.status, result.stderr).toBe(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("uses the same explicit loopback Origin and Vite listener", () => {
    const calls: { args: string[]; options: any }[] = [];
    const source = transformSync(readFileSync("scripts/web-dev.mjs", "utf8"), {
      format: "cjs",
    }).code;
    runInNewContext(source, {
      URL,
      require: () => ({
        spawn: (_: string, args: string[], options: any) => {
          calls.push({ args, options });
          return { on() {} };
        },
      }),
      process: {
        env: {
          WEB_ORIGIN: "http://127.0.0.1:5182",
          VITE_WEB_TRANSPORT: "direct",
          WEB_API_MODE: "demo",
        },
        on() {},
      },
      setTimeout,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].options.env.VITE_WEB_MODE).toBe("live");
    expect(calls[0].args).toEqual(
      expect.arrayContaining([
        "--host",
        "127.0.0.1",
        "--port",
        "5182",
        "--strictPort",
      ]),
    );
  });
  it("changes the shell digest when only a manifest or worker changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "tw-shell-build-"));
    try {
      for (const sub of [
        "scripts",
        "web/dist/assets",
        "web/dist/icons",
        "web/public",
      ])
        mkdirSync(join(dir, sub), { recursive: true });
      copyFileSync(
        "scripts/web-precache.mjs",
        join(dir, "scripts/web-precache.mjs"),
      );
      const worker = readFileSync("web/public/sw.js", "utf8");
      const run = () => {
        writeFileSync(
          join(dir, "web/dist/sw.js"),
          readFileSync(join(dir, "web/public/sw.js")),
        );
        const result = spawnSync(
          process.execPath,
          [join(dir, "scripts/web-precache.mjs")],
          { encoding: "utf8" },
        );
        expect(result.status, result.stderr).toBe(0);
        return readFileSync(join(dir, "web/dist/sw.js"), "utf8").match(
          /const VERSION = "([^"]+)"/,
        )![1];
      };
      writeFileSync(join(dir, "web/public/sw.js"), worker);
      for (const file of [
        "index.html",
        "icon.svg",
        "manifest.webmanifest",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "assets/test.js",
      ])
        writeFileSync(join(dir, "web/dist", file), file);
      const first = run();
      writeFileSync(join(dir, "web/dist/manifest.webmanifest"), "changed");
      const second = run();
      expect(second).not.toBe(first);
      writeFileSync(
        join(dir, "web/public/sw.js"),
        worker + "\n// worker update\n",
      );
      expect(run()).not.toBe(second);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
