# Correction verification

Required: intended failing regressions before source fixes, green tests after correction, post-refactor tests, then separate composed browser smoke on the production build. Existing CI trace supplies actual C2 Red evidence; setup failures do not count as Red.

- Domain: KMA/world current/hourly/daily zero/missing/sentinel/rain/snow values, periods and conversions; warning URL hosts; catalog/coordinate identity.
- Notifications: deferred sender does not block reads or mutations; four-send global limit; duplicate concurrent ticks; captured-time/catch-up limit; cancellation/revision; stale 410 versus replacement subscription; test-send failure remains truthful.
- Platform: load all three existing native version modules without starting native tools; web build remains ESM internally; shared loopback dev configuration and production Origin rejection.
- Worker: actual source execution against deterministic cache fixtures plus real browser CacheStorage with an older retained shell; current icon/manifest wins, old hashed assets remain readable, offline navigation works; shell/worker-only bytes change build digest. Route compatibility matrix covers unknown API/assets and decimal coordinate links.
- Browser: await dialog completion and assert exactly two dialogs for cancel/accept; delayed/failed capabilities and failed rule deletion retain the favorite; successful cleanup removes it; precipitation period/snow UI and legacy snapshots remain safe. Test mocks are explicit; main broader smoke retains actual demo BFF requests.

Run isolated npm workspaces only. Node 22.22.2 and installed Chromium; no legacy server, external provider, real push, Docker deployment or native build. Preserve original screenshots/reports and use correction evidence paths.
