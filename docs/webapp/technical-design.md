# Static webapp technical design

Current decision: a separate responsive PWA with **direct browser calls to the existing public API**, hosted at `app.tdywx.xyz` using private S3 and CloudFront. This supersedes the initial web BFF and notification-service proposal of 2026-09-24. The Node API workspace and Docker hosting option have been removed. See [implementation status](implementation.md), [product scope](specification.md) and [release plan](implementation-plan.md).

## Components and repository boundaries

| Component | Responsibility |
| --- | --- |
| `web/` | React/TypeScript/Vite UI, routes, query cancellation, settings and snapshots |
| `packages/weather-core/` | Pure provider normalization, units, dates, availability and catalog identities |
| `web/src/direct-api.ts` | Fixed external read operations, bounded fetch/JSON validation and normalization |
| `web/src/demo/` | Synthetic raw fixtures selected only by explicit demo mode |
| `web/public/sw.js` | App-shell caching and controlled install/update lifecycle |
| `infra/web/static/` | Private S3/OAC and CloudFront preparation, known-route function, HTTPS/cache/CSP configuration |
| Existing public TodayWeather service | Existing versioned weather/geocode/nation/warning APIs; no route or collector change required |

Root npm workspaces contain only the web client and shared core. Root Node >=22.12 is build/local tooling; legacy `server/` runtime requirements are separate. Do not import `server/app.js` or reuse Cordova startup to build the browser app. Native consumers, collectors, database versions and existing push workers remain unchanged.

## Public API contract

Base origin: `https://todayweather.wizardfactory.net`. The browser sends credential-free HTTPS GETs to these fixed operations:

| User operation | Existing path / local source |
| --- | --- |
| Coordinate weather | `/weather/v000903/coord/{lat},{lon}` |
| Reverse geocode | `/geocode/v000903/coord/{lat},{lon}` |
| Address resolution | `/geocode/v000903/addr/{encodedAddress}` |
| Nationwide weather/air | `/v000903/nation/KR` |
| Korean special warnings | `/v000903/kma/special` |
| Catalog search and public place identity | Browser-local `PLACES` |
| Favorites, settings and offline snapshots | Validated localStorage and IndexedDB |
| Notifications | Unavailable guidance; no subscription, rule, mutation or sender API |

There is no `/api/web/v1` hosting dependency. Same-origin `/api/` requests and unknown navigation paths must never become successful app-shell responses. Weather-address and geocode-address routes are different contracts: resolve an address first, then request coordinate weather. Never use `/gather/*` as a health check.

Finite coordinates must satisfy latitude [-90,90] and longitude [-180,180]; zero is valid. Coordinates are rounded to three decimal places for browser identities/requests, with explicit `lat,lon` wire order. Encode address path segments. Sharing uses curated public city IDs rather than exposing exact current-location coordinates.

The client requests canonical Celsius, m/s, hPa, km and mm physical units, `airForecastSource=kaq` and the selected air standard. Convert physical values once in the shared core. All six unit settings, location, language and schema belong to query/snapshot identity. Returned air-standard mismatch and unknown sources are errors, not opportunities to guess units.

## Failure, time and data semantics

Direct reads have a 15-second abort budget and 2 MB response bound, reject redirects and omit credentials. Browser CORS must allow the actual web origin; CSP must allow the specific API origin. An error response without CORS may appear as a generic network failure. Browser validation and refresh deduplication cannot enforce upstream quotas; assess existing API rate controls before launch.

Preserve source observation/publication times separately from fetched time. KMA sentinel temperatures and negative amounts become unavailable; true zero stays zero. Never turn a refreshed old observation into a fresh-data claim. Historical daily rows are filtered against the source current date. KMA one-hour and three-hour forecasts merge by timestamp, keeping field-level valid data and original rain/snow accumulation durations. Missing amounts have no inferred period.

Text-only `current.summaryAir` becomes a bounded, escaped provider summary only when station data is absent. It does not create pollutant readings or timestamps. Show the unknown-observation-time caveat. Nationwide air does not substitute for city station measurements.

Live failures show retry/error or a clearly labelled previous snapshot, never synthetic data. `VITE_WEB_MODE=demo` is an explicit build-time option. `VITE_WEB_TRANSPORT` is either unset or `direct`; proxy mode is rejected. No secret belongs in browser configuration.

## Persistence, privacy and PWA

Browser preferences are versioned and validated, with local backup/import and recoverable corruption handling. Snapshots have a 24-hour maximum age and 30-entry bound. Their keys include location and unit settings. Browser storage can be denied or evicted; native app storage is inaccessible from this web origin. Account/device synchronization remains future scope.

Geolocation is requested by a user action; manual search remains available after denial or timeout. No background tracking is implemented. Avoid logging full coordinates, search text or private browser data. No notification endpoint, token, VAPID key or ownership cookie is stored by this app.

The service worker precaches the shell and hashed assets, not API responses. Shell bytes determine the build digest. Current-cache unversioned files and retained previous hashed assets support existing tabs. Updates wait for user activation; first controller claim does not reload the page. Known-route navigation fallback preserves missing-asset/API/unknown-route errors. Verify installed and new sessions across releases.

## Notification and parity boundaries

The current app provides a notification-unavailable page, recommends using the existing mobile app, and links back to the selected city’s weather. It does not provide a store link. It has no alarm editor, permission request, subscription persistence, scheduler, delivery queue or push event handler. Installing the PWA does not enable alerts.

Web Push and condition-based alerts remain open in [#2558](https://github.com/WizardFactory/TodayWeather/issues/2558). A future proposal must separately specify ownership, durable scheduling, rule/timezone semantics, endpoint validation, retries, deduplication, deletion, privacy and actual device delivery. The removed Node prototype is not a supported fallback. Do not send browser subscriptions to legacy native token endpoints.

Native widgets/Watch, continuous location, billing and native-purchase transfer remain explicit product boundaries. The current static release must not be described as complete mobile parity.

## Hosting and release

The [static runbook](../../infra/web/static/README.md) documents the selected host name and requested existing bucket, `tdywx-app-141248341265-apne2`. The template creates new resources; reusing the existing bucket/distribution requires a fresh configuration check, especially the known-route viewer-request function, OAC, certificate, cache policy, CSP and DNS. Historical observations are not a live configuration guarantee.

Serve S3 through CloudFront OAC/HTTPS with public bucket access blocked. Cache hashed assets immutably and revalidate HTML, manifest and worker. Keep previous hashed assets. Do not use distribution-wide 403/404-to-200 fallback or replace the existing API distribution's default origin with S3.

Deployment method selection is deferred. CI verifies the static bundle and publishes build/browser artifacts; a production workflow or upload is not implied. The prepared uploader defaults to dry-run, checks destination/release identity and uploads assets before entrypoints. Its upload is ordered rather than transactional. Promote a verified complete artifact; wait for invalidation and test final-domain CORS/CSP, routes and installed-worker updates. Rollback uses a complete archived artifact and the same checks.

Release monitoring must distinguish UI failures, API transport failures, source age and upstream capacity. Domain ownership, operating budget, data/asset rights, supported-device behavior and any provider repairs require explicit release evidence. This design provisions no resources and changes no legacy deployment trigger.
