import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../web/dist/", import.meta.url);
const assets = (await readdir(new URL("assets/", root))).map(
  (file) => "/assets/" + file,
);
const html = await readFile(new URL("index.html", root));
const version = createHash("sha256")
  .update(html)
  .update(assets.join("\n"))
  .digest("hex")
  .slice(0, 16);
const worker = await readFile(new URL("sw.js", root), "utf8");
await writeFile(
  new URL("sw.js", root),
  worker
    .replace("__BUILD_VERSION__", version)
    .replace(
      /\/\*__PRECACHE__\*\/\s*\[[\s\S]*?\]/,
      JSON.stringify([
        "/",
        "/index.html",
        "/icon.svg",
        "/manifest.webmanifest",
        "/icons/icon-192.png",
        "/icons/icon-512.png",
        ...assets,
      ]),
    ),
);
