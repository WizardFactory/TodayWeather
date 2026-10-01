import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "./resolver.mjs";
const writeChanged = (path, content) => {
  let previous;
  try {
    previous = readFileSync(path, "utf8");
  } catch {}
  if (previous !== content) writeFileSync(path, content);
};
const root = dirname(fileURLToPath(import.meta.url));
const outputs = compile(
  JSON.parse(readFileSync(resolve(root, "tokens.json"), "utf8")),
);
mkdirSync(resolve(root, "generated"), { recursive: true });
for (const [name, content] of Object.entries(outputs))
  writeChanged(resolve(root, "generated", name), content);
console.log(`Generated ${Object.keys(outputs).length} token outputs`);

// Production consumes the same deterministic outputs as the reference gallery.
const web = resolve(root, "../../web/src/generated");
mkdirSync(web, { recursive: true });
for (const [name, content] of Object.entries(outputs))
  writeChanged(resolve(web, name), content);

await import("../../scripts/pwa-theme-generate.mjs");
