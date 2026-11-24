#!/usr/bin/env node
// Checks that every GTM source answers with the configured credentials. Read-only; prints no value.
// Exit code: 0 when every source is ok, 1 otherwise.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkAll, passed } from "./access.mjs";

export async function main({ env = process.env, deps, out = (line) => console.log(line) } = {}) {
  const results = await checkAll(env, deps ?? {
    fetchImpl: fetch,
    read: readFileSync,
    run: (cmd, args, options) => spawnSync(cmd, args, { ...options, stdio: "ignore" }),
    processEnv: process.env,
    nowMs: Date.now(),
  });
  for (const { name, status } of results) out(`${name.padEnd(18)} ${status}`);
  return results.every((r) => passed(r.status)) ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main();
