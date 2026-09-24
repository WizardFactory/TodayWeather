import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../web/dist/", import.meta.url);
const assets = (await readdir(new URL("assets/", root)))
  .sort()
  .map((file) => "/assets/" + file);
const shell = [
  "/",
  "/index.html",
  "/icon.svg",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  ...assets,
];
const worker = await readFile(
  new URL("../web/public/sw.js", import.meta.url),
  "utf8",
);
const digest = createHash("sha256").update(worker);
for (const file of shell.filter((file) => file !== "/")) {
  const bytes = await readFile(new URL(file.slice(1), root));
  digest
    .update(file)
    .update("\0")
    .update(String(bytes.length))
    .update("\0")
    .update(bytes);
}
const version = digest.digest("hex").slice(0, 16);
await writeFile(
  new URL("sw.js", root),
  worker
    .replace("__BUILD_VERSION__", version)
    .replace(/\/\*__PRECACHE__\*\/\s*\[[\s\S]*?\]/, JSON.stringify(shell)),
);
