# Web client and adapter

Repository evidence: local web implementation prepared 2026-09-24 for [#2558](https://github.com/WizardFactory/TodayWeather/issues/2558). Deployment is unobserved; this document describes executable source and a prepared staging topology.

The new root npm workspace contains `web`, `web-api` and `packages/weather-core`. It does not reuse Cordova startup or import `server/app.js`; running the web server does not start historical gather/scrape jobs. The [implemented diagram](../webapp/diagrams/webapp-implementation.html) has [editable source](../webapp/diagrams/webapp-implementation.json). The [earlier cloud design](../webapp/technical-design.md) is a proposal, not this runtime.

## Request and data flow

`web/src/api.ts` calls same-origin `/api/web/v1/*`. `web-api/src/server.ts` serves only known SPA navigation routes; unknown API/asset paths preserve errors. `web-api/src/api.ts` maps fixed weather/geocode/nation/warning operations to the public HTTPS upstream. Client-supplied URLs are never forwarded. Timeout, byte limits, method checks, rate limiting and JSON checks bound the adapter; no API response caching occurs in the service worker.

Weather uses `/weather/v000903/coord/{latitude},{longitude}`; reverse/address lookup uses `/geocode/v000903/{coord|addr}/...`; nationwide and warning reads use `/v000903/nation/KR` and `/v000903/kma/special`. These reuse existing contracts without changing native paths. No `/gather/*` call exists.

The BFF requests canonical Celsius, m/s, hPa, km and mm physical units plus the selected air standard. `packages/weather-core/src/index.ts` converts to display units exactly once, rejects unknown weather sources or mismatched returned air standards and preserves observed/publication/fetch timestamps separately. KMA sentinel temperatures become null before comparison/conversion. Raw source wall times are not relabelled as UTC. Historical daily rows are filtered against the source current date.

Weather query identity includes place ID, rounded coordinates, all six unit settings, language and schema. Requests are abortable. Browser preferences are versioned and validated; snapshots are IndexedDB records with a 24-hour maximum age and 30-entry bound. Offline/error snapshots retain source timestamps and display a disconnected notice. Empty air results replace previous air data instead of silently retaining it. Demo mode is explicit and never a server fallback for live failures.

## PWA and notifications

`web/public/sw.js` receives a build digest and hashed asset list from `scripts/web-precache.mjs`. Installation precaches the app shell; a new worker waits for an explicit update action. Activation retains one previous cache for old tabs. Unknown routes and all `/api/` requests bypass shell fallback. Install and offline behavior require HTTPS or a local secure-context exception.

Web notifications are optional and disabled by default. `web-api/src/notifications.ts` uses a signed HttpOnly SameSite cookie for anonymous installation ownership, strict mutation Origin checks in the API, CSRF tokens, per-rule revisions and bounded subscription destination hosts. Rules are persisted atomically in a restrictive local file. A 30-second in-process scheduler resolves weekday/time in each rule's IANA timezone, deduplicates DST repeated wall-clock times and sends generic city reminders. It does not evaluate rain, snow or air conditions. Provider acceptance is not device receipt.

The notification store and scheduler require one process and a durable volume. They are not a distributed queue or database. `infra/web/` prepares Caddy TLS and a Node container; no CloudFront, S3, API Gateway or Lambda web resources have been provisioned.

## Verification and release boundaries

See [implementation status](../webapp/implementation.md), [deployment runbook](../../infra/web/README.md) and [verification evidence](../../reports/sdlc/webapp-implementation/). The bounded 2026-09-24 upstream reads found missing domestic yesterday/air data and stale nationwide air, despite HTTP 200. Neither this client nor the BFF repairs collectors or underlying providers. Real push delivery, Safari/iOS installed behavior, international provider availability, conditional alerts, native-purchase policy and public hosting remain release gates.
