# Web client and adapter

Repository evidence: local web implementation prepared 2026-09-24 for [#2558](https://github.com/WizardFactory/TodayWeather/issues/2558). Deployment is unobserved; this document describes executable source and a prepared staging topology.

The new root npm workspace contains `web`, `web-api` and `packages/weather-core`. It does not reuse Cordova startup or import `server/app.js`; running the web server does not start historical gather/scrape jobs. The [implemented diagram](../webapp/diagrams/webapp-implementation.html) has [editable source](../webapp/diagrams/webapp-implementation.json). The [earlier cloud design](../webapp/technical-design.md) is a proposal, not this runtime.

## Request and data flow

`web/src/api.ts` calls same-origin `/api/web/v1/*`. `web-api/src/server.ts` serves only known SPA navigation routes; unknown API/asset paths preserve errors. `web-api/src/api.ts` maps fixed weather/geocode/nation/warning operations to the public HTTPS upstream. Client-supplied URLs are never forwarded. Timeout, byte limits, method checks, rate limiting and JSON checks bound the adapter; no API response caching occurs in the service worker.

Weather uses `/weather/v000903/coord/{latitude},{longitude}`; reverse/address lookup uses `/geocode/v000903/{coord|addr}/...`; nationwide and warning reads use `/v000903/nation/KR` and `/v000903/kma/special`. These reuse existing contracts without changing native paths. No `/gather/*` call exists.

The BFF requests canonical Celsius, m/s, hPa, km and mm physical units plus the selected air standard. `packages/weather-core/src/index.ts` converts to display units exactly once, rejects unknown weather sources or mismatched returned air standards and preserves observed/publication/fetch timestamps separately. KMA sentinel temperatures become null before comparison/conversion. Raw source wall times are not relabelled as UTC. Historical daily rows are filtered against the source current date.

Weather query identity includes place ID, rounded coordinates, all six unit settings, language and schema. Requests are abortable. Browser preferences are versioned and validated; snapshots are IndexedDB records with a 24-hour maximum age and 30-entry bound. Offline/error snapshots retain source timestamps and display a disconnected notice. Empty air results replace previous air data instead of silently retaining it. Demo mode is explicit and never a server fallback for live failures.

## PWA and notifications

Root package scope leaves existing Cordova CommonJS tools unchanged; only the web workspaces declare ESM. The development launcher derives Vite host/port and API mutation Origin from one loopback `WEB_ORIGIN` (default `http://127.0.0.1:5173`), with strict port selection.

Rain selection uses valid numeric fields, preserving zero and falling back past null/sentinels. Periods follow source and series: observations/world hourly one hour, v000903 KMA short three hours and daily totals 24 hours. Explicit snow fields stay separate in upstream precipitation units (KMA already converts snow centimetres to canonical millimetres). Missing amounts have no period. Legacy offline points retain amounts but suppress old inferred periods. Warning image links permit only the exact KMA hosts and are upgraded to HTTPS.

`web/public/sw.js` receives a build digest and hashed asset list from `scripts/web-precache.mjs`. Installation precaches the app shell; a new worker waits for an explicit update action. Activation retains one previous cache for old tabs. Unknown routes and all `/api/` requests bypass shell fallback. Install and offline behavior require HTTPS or a local secure-context exception.

Web notifications are optional and disabled by default. `web-api/src/notifications.ts` uses a signed HttpOnly SameSite cookie for anonymous installation ownership, strict mutation Origin checks in the API, CSRF tokens, per-rule revisions and bounded subscription destination hosts. Rules are persisted atomically in a restrictive local file. A 30-second in-process scheduler resolves weekday/time in each rule's IANA timezone, deduplicates DST repeated wall-clock times and sends generic city reminders. It does not evaluate rain, snow or air conditions. Provider acceptance is not device receipt.

The notification store and scheduler require one process and a durable volume. They are not a distributed queue or database. `infra/web/` prepares Caddy TLS and a Node container; no CloudFront, S3, API Gateway or Lambda web resources have been provisioned.

## Verification and release boundaries

The shell digest includes worker, manifest, icons, HTML and asset bytes. Unhashed reads use the current cache; previous caches are consulted only for old hashed assets. Server/worker navigation patterns have a compatibility test. Favorite removal reads current server capabilities and completes enabled rule cleanup before local success; failures retain the favorite.

Ticks claim and persist dedupe keys in one short store transaction, then deliver outside the store queue with at most four concurrent sends across reminders and test pushes. Queued deliveries recheck rule revision and subscription identity; stale expiry responses cannot delete replacement subscriptions. Captured invocation times are retained; subsequent ticks recover up to five minute slots, while startup checks the current minute. Durable claims prefer possible missed delivery after a crash over duplicates; already in-flight pushes cannot be recalled. Place IDs must match catalog or canonical coordinate identities and coordinates.

See [implementation status](../webapp/implementation.md), [deployment runbook](../../infra/web/README.md) and [verification evidence](../../reports/sdlc/webapp-implementation/). The bounded 2026-09-24 upstream reads found missing domestic yesterday/air data and stale nationwide air, despite HTTP 200. Neither this client nor the BFF repairs collectors or underlying providers. Real push delivery, Safari/iOS installed behavior, international provider availability, conditional alerts, native-purchase policy and public hosting remain release gates.

A first service-worker claim does not reload an already usable page; it preserves in-flight navigation and unsaved notification edits. A later controller replacement still reloads to adopt the activated update. The browser regression delays actual worker registration until after editing the form, then verifies the first real claim preserves the edit.
