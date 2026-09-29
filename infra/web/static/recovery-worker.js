/* Emergency placeholder recovery. Served as /sw.js only during an approved rollback.
 * Keep this URL available with no-cache for returning clients. Offline clients
 * cannot be forced to update. Preferences and IndexedDB are deliberately retained.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("tw-shell-"))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
      const windows = await self.clients.matchAll({ type: "window" });
      await self.registration.unregister();
      const root = new URL(self.registration.scope);
      // A tab may close during recovery; it must not prevent other tabs recovering.
      await Promise.allSettled(
        windows
          .filter((client) => new URL(client.url).origin === root.origin)
          .map((client) => client.navigate(root.href)),
      );
    })(),
  );
});
