/* The build injects a content digest and exact hashed asset list. API data lives in IndexedDB, never this cache. */
const VERSION = "__BUILD_VERSION__";
const CACHE = "tw-shell-" + VERSION;
const ASSETS = /*__PRECACHE__*/ [
  "/",
  "/index.html",
  "/icon.svg",
  "/manifest.webmanifest",
  "/theme.js",
];
// A cache is usable as a fallback only after every shell file was stored.
const COMPLETE = "/__complete__";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        await cache.addAll(ASSETS);
        await cache.put(COMPLETE, new Response("1"));
      })
      .catch(async (error) => {
        await caches.delete(CACHE);
        throw error;
      }),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(async (keys) => {
        const others = keys.filter(
          (key) => key.startsWith("tw-shell-") && key !== CACHE,
        );
        // A newer release may still be installing into its incomplete cache.
        const installing = !!self.registration?.installing;
        const complete = [];
        const incomplete = [];
        for (const key of others) {
          const cache = await caches.open(key);
          // Shells written before the marker existed are complete when they
          // hold index.html (addAll is all-or-nothing).
          if (
            (await cache.match(COMPLETE)) ||
            (await cache.match("/index.html"))
          )
            complete.push(key);
          else incomplete.push(key);
        }
        // Keep only the newest complete previous shell for old tabs.
        const keep = complete[complete.length - 1];
        await Promise.all(
          others
            .filter(
              (key) =>
                key !== keep && !(installing && incomplete.includes(key)),
            )
            .map((key) => caches.delete(key)),
        );
      }),
      self.clients.claim(),
    ]),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (request.mode === "navigate") {
    const known =
      /^\/(?:$|start\/?$|locations\/?$|settings(?:\/[^.]*)?$|help\/?$|membership\/?$|warnings\/?$|(?:air|place|notifications)\/[^/]+\/?$|weather\/[^/]+\/(?:hourly|daily|overview)\/?$|nation\/(?:weather|air)\/?$)/.test(
        url.pathname,
      );
    if (known)
      event.respondWith(
        fetch(request).catch(
          async () =>
            (await (await caches.open(CACHE)).match("/index.html")) ??
            Response.error(),
        ),
      );
    return;
  }
  if (ASSETS.includes(url.pathname) || url.pathname.startsWith("/assets/"))
    event.respondWith(
      (async () => {
        const current = await (await caches.open(CACHE)).match(request);
        if (current) return current;
        // Old tabs may still request an older hashed chunk. Unhashed shell files must never fall back.
        if (url.pathname.startsWith("/assets/")) {
          const keys = (await caches.keys())
            .filter((key) => key.startsWith("tw-shell-") && key !== CACHE)
            .reverse();
          for (const key of keys) {
            const previous = await (await caches.open(key)).match(request);
            if (previous) return previous;
          }
        }
        return fetch(request);
      })(),
    );
});
