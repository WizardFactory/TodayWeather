#!/usr/bin/env node
// Checks that every GTM source answers with the configured credentials. Read-only; prints no value.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkAll, passed } from "./access.mjs";

const results = await checkAll(process.env, {
  fetchImpl: fetch,
  read: readFileSync,
  run: (cmd, args, options) => spawnSync(cmd, args, { ...options, stdio: "ignore" }),
  nowMs: Date.now(),
});
for (const { name, status } of results) console.log(`${name.padEnd(18)} ${status}`);
process.exit(results.every((r) => passed(r.status)) ? 0 : 1);
