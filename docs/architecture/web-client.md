# Static web client

Repository evidence: local web implementation prepared 2026-09-24 for [#2558](https://github.com/WizardFactory/TodayWeather/issues/2558). Deployment is unobserved; this document describes executable source and a prepared staging topology.

The new root npm workspace contains `web` and `packages/weather-core`. It does not reuse Cordova startup or import `server/app.js`; running local web tooling does not start historical gather/scrape jobs. The [implemented diagram](../webapp/diagrams/webapp-implementation.html) has [editable source](../webapp/diagrams/webapp-implementation.json). The [technical design](../webapp/technical-design.md) records the same static-only runtime and future parity boundaries.

## Request and data flow

`web/src/api.ts` defaults to direct/live transport. `web/src/direct-api.ts` maps fixed operations to the existing public HTTPS API, enforces a 15-second abort and 2 MB JSON read limit, and normalizes raw payloads in the browser. Requests omit credentials and reject redirects; existing public API CORS must permit the web origin. Network/CORS failures show Korean retry guidance; a browser cannot distinguish their exact cause. Cancellation and timeout handling remain separate. Catalog search and disabled static notification capabilities resolve locally. No `/api/web/v1` requests or new API backend are needed.

`infra/web/static/stack.json` prepares a separate private S3 bucket and CloudFront distribution for `app.tdywx.xyz`. OAC grants only that distribution object reads. Its viewer-request function rewrites known SPA links to `index.html` while preserving API/unknown/missing asset errors. Shell files revalidate, hashed assets are immutable, and old assets survive upload. CSP allows connections to the existing API. The local static preview uses the same function and CSP. No production resource is implied by the template.

Only direct transport is supported: unset `VITE_WEB_TRANSPORT` or set it to `direct`; `proxy` is rejected. The former Node adapter and its Docker recipe are removed. `VITE_WEB_MODE=demo` loads browser-owned raw fixtures from `web/src/demo/`; live is the default.

Weather uses `/weather/v000903/coord/{latitude},{longitude}`; reverse/address lookup uses `/geocode/v000903/{coord|addr}/...`; nationwide and warning reads use `/v000903/nation/KR` and `/v000903/kma/special`. These reuse existing contracts without changing native paths. No `/gather/*` call exists.

The direct client requests canonical Celsius, m/s, hPa, km and mm physical units plus the selected air standard. `packages/weather-core/src/index.ts` converts to display units exactly once, rejects unknown weather sources or mismatched returned air standards and preserves observed/publication/fetch timestamps separately. KMA sentinel temperatures become null before comparison/conversion. Raw source wall times are not relabelled as UTC. Historical daily rows are filtered against the source current date.

Weather query identity includes place ID, rounded coordinates, all six unit settings, language and schema. Normalization cache-key revision v2 uses new query/snapshot keys so previously normalized daily observation totals are not reused; local favorites and settings are unaffected. Requests are abortable. Browser preferences are versioned and validated; snapshots are IndexedDB records with a 24-hour maximum age and 30-entry bound. Offline/error snapshots retain source timestamps and display a disconnected notice. Empty air results replace previous air data instead of silently retaining it. Demo mode is explicit and never a fallback for live failures.

## PWA and notifications

Root package scope leaves existing Cordova CommonJS tools unchanged; only the web workspaces declare ESM. The development launcher derives Vite host/port from one loopback `WEB_ORIGIN` (default `http://127.0.0.1:5173`), with strict port selection.

Rain selection preserves valid zero and rejects null/sentinels. KMA daily rain reads the forecast `r06` only; the accumulated observation `rn1` cannot replace it, including when `r06` is missing. Daily KMA coverage is not established as a full day, so its period remains unknown and the UI labels the value as a forecast. Current/hourly KMA and DSF selection remain source-specific: observations/world hourly use one hour, KMA short uses three hours, and DSF daily uses 24 hours. Explicit snow fields stay separate in upstream precipitation units (KMA already converts snow centimetres to canonical millimetres). Zero snowfall remains in normalized data but is omitted from the UI; positive values below 0.1 display as `<0.1` in the selected unit. Missing amounts have no period. Legacy offline points suppress old inferred periods. Warning image links permit only the exact KMA hosts and are upgraded to HTTPS. KR warning timestamps carrying an explicit UTC offset or `Z` render in `Asia/Seoul` with a KST label; naive KMA wall times retain their existing meaning.

`web/public/sw.js` receives a build digest and hashed asset list from `scripts/web-precache.mjs`. Installation precaches the app shell; a new worker waits for an explicit update action. Activation retains one previous cache for old tabs. Unknown routes and all `/api/` requests bypass shell fallback. Install and offline behavior require HTTPS or a local secure-context exception.

The notification route explains that browser notifications are unavailable, recommends using the existing mobile app and links back to weather. No store link is provided. It does not request permission, register a push subscription, save a rule or send a test notification. Favorite deletion updates local state without server-side cleanup. Web Push scheduling is a future feature requiring a separate design; native push endpoints and workers are unchanged.

The [static recipe](../../infra/web/static/README.md) prepares hosting only. No web server, notification store, timer, queue, VAPID secret or session cookie is part of the browser deployment. Node is required only by local/CI tooling.

## Verification and release boundaries

The shell digest includes worker, manifest, icons, HTML and asset bytes. Unhashed reads use the current cache; previous caches are consulted only for old hashed assets. The CloudFront navigation function is exercised by the static browser suite. A first service-worker claim does not reload an already usable page; it preserves ongoing interaction. A later controller replacement reloads to adopt an explicitly activated update.

Tests exercise the production bundle using only a static file server, intercept raw external API fixtures and reject local `/api/` requests. Domain/storage/transport tests cover normalization, invalid payloads, cancellation and local persistence. These checks do not start the legacy server or collectors.

See [implementation status](../webapp/implementation.md) and [static deployment runbook](../../infra/web/static/README.md). The bounded 2026-09-24 upstream reads found missing domestic yesterday/air data and stale nationwide air, despite HTTP 200. This client does not repair collectors or underlying providers. International catalog entries remain available; translated failure guidance does not repair upstream 501 responses or missing CORS headers. City air measurements remain a separate backend task. Safari/iOS installed behavior, international provider availability, native-purchase policy and final-domain hosting checks remain release gates. Web Push and conditional alerts remain separate parity gaps, not required services for hosting the current client.

## Mixed KMA forecast and text-only air fallback

The core adapter merges KMA `short` (three-hour) and `shortest` (one-hour) points into a timestamp-sorted unique timeline, including midnight rollover. Valid nonempty shortest fields take precedence at matching timestamps; missing/sentinel fields retain valid short fields. Rain/snow amounts keep their corresponding accumulation duration, so a three-hour fallback is never labelled as one-hour rain. Unique shortest points with `rn1=-1` retain null precipitation. DSF hourly selection is unchanged. Weather views still select current/future points for display.

Optional `Weather.airSummary` preserves only a trimmed string (maximum 500 characters) from `current.summaryAir`. It does not create stations, numbers, grades, air timestamps or availability. When no station is available, both weather and air views show this provider wording with an explicit unverified-observation-time caveat. React renders it as text. Existing numeric station data remains primary. Snapshot validation accepts older records without the optional field and rejects malformed/overlong summaries; offline/stale notices remain in force. Nationwide air is not substituted for missing city measurements.
