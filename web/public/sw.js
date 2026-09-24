/* The build injects a content digest and exact hashed asset list. API data lives in IndexedDB, never this cache. */
const VERSION = "__BUILD_VERSION__";
const CACHE = "tw-shell-" + VERSION;
const ASSETS = /*__PRECACHE__*/ [
  "/",
  "/index.html",
  "/icon.svg",
  "/manifest.webmanifest",
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("tw-shell-") && key !== CACHE)
            .slice(0, -1)
            .map((key) => caches.delete(key)),
        ),
      ),
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
      caches.match(request).then((cached) => cached ?? fetch(request)),
    );
});
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data = {};
      try {
        data = event.data?.json() ?? {};
      } catch {}
      const url =
        typeof data.url === "string" &&
        /^\/(weather|air|locations)(\/|$)/.test(data.url) &&
        !data.url.startsWith("//")
          ? data.url
          : "/locations";
      await self.registration.showNotification(
        typeof data.title === "string" ? data.title : "오늘날씨",
        {
          body:
            typeof data.body === "string" ? data.body : "날씨를 확인해 주세요.",
          icon: "/icons/icon-192.png",
          tag: typeof data.tag === "string" ? data.tag : undefined,
          data: { url, place: data.place },
        },
      );
    })(),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    event.notification.data?.url ?? "/locations",
    self.location.origin,
  );
  if (url.origin !== self.location.origin) return;
  event.waitUntil(self.clients.openWindow(url.href));
});
