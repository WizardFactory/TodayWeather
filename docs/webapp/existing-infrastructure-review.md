# Deploying the webapp without an additional Node service

Reviewed 2026-09-24 at repository revision `525a4a27`. Scope: feasibility and operating evidence, not implementation or deployment. AK requested reuse of current infrastructure without an additional Node server. The existing mobile feature-parity objective remains in force. **Historical review:** references to the adapter below describe revision `525a4a27`, not the current runtime. The direct browser migration is now implemented, the Node workspace is removed, and deployment method selection is deferred. See [current implementation](implementation.md).

Raw inspection and probe receipts are retained locally under ignored `reports/sdlc/`; the dated findings and limits below are the maintained summary.

## Conclusion

An additional persistent Node server is **not an architectural requirement** for weather, air, geocoding, nation, warnings, favorites, settings or the PWA shell. At the reviewed revision the web client depended on `/api/web/v1`; the review found that its read-side work could move into the browser while retaining the existing public API. That migration has since been implemented.

Recommended direction: serve `web/dist` from private S3 behind CloudFront on a dedicated web origin, and call the existing `https://todayweather.wizardfactory.net` versioned API from the browser. Keep shared normalization in `packages/weather-core`. This originally required a client transport refactor and static hosting configuration. The current bundle no longer depends on `/api/web/v1`; see the [static runbook](../../infra/web/static/README.md).

Web Push needs server-side subscription ownership, persistent rules, scheduling and sending. It can be provided without a new always-running Node service, but cannot be completed by uploading static files. The review considered a supported-runtime Lambda service with durable storage/scheduling or reuse of a verified existing push worker. Neither is implemented or selected by the current static-only decision; browser notifications remain unavailable. A temporary read-only milestone does not complete the agreed parity release.

## Evidence and freshness

| Evidence | Observation | Boundary |
| --- | --- | --- |
| [Operating topology](../architecture/aws-code-correlation.md) | Existing CloudFront routes weather/geocode to API Gateway/Lambda and direct versioned service paths to EC2 | Original snapshot September 20 |
| Fresh AWS configuration | September 24, 14:39 UTC: the same distribution has API Gateway `/production` for `weather/*` and `geocode/*`; default and push behaviors use the service origin | Read-only configuration, not a new deployment or host inspection |
| Lambda comparison | All four public Lambda code hashes match the September 20 evidence | Environment and EC2 code were not freshly inspected; current API resources are not a deployed stage export |
| Browser probe | Credential-free fetch from a separate HTTPS origin read weather, reverse geocode, nation and warnings with HTTP 200 and response type `cors` | One Seoul location, Korean language/default units, Chromium; no worldwide availability claim |
| Address browser follow-up | Address geocode for Seoul also returned browser-readable HTTP 200, wildcard CORS and valid coordinates | First browser attempt failed with `TypeError: Failed to fetch`; cause unproven. Server-side follow-up also returned 200 |
| [Shared adapter](../../packages/weather-core/src/index.ts) | Pure normalization has no Node runtime import and is already used by the browser workspace | Live weather/nation/warning normalization was executed separately in Node by the probe, not within a deployed webapp |
| [EC2 internals](../architecture/ec2-internals.md) | September 20: Node 10.15.3, nginx, ten PM2 cluster workers, service mode | Historical host observation only; not grounds to install the Node 22 web service unchanged |
| [Push architecture](../architecture/push-notifications.md) | Native registrations/tokens and separate alarm/alert loops exist in source | The running push worker, current delivery and generic Web Push compatibility remain unverified |

The HTTP observations establish transport feasibility, not source freshness, accuracy or complete mobile parity. Existing missing/stale provider data remain independent issues. No collection route, notification mutation, push send, SSH command or production change was executed.

## Exact read-operation mapping

Existing public base: `https://todayweather.wizardfactory.net`. Every path below is a GET unless explicitly browser-local. The left column records the removed wrapper at the reviewed revision. Current executable mapping: [direct browser transport](../../web/src/direct-api.ts).

| Historical adapter operation | Current direct/local equivalent | Browser responsibility |
| --- | --- | --- |
| `/weather?lat=&lon=&...units` | `/weather/v000903/coord/{lat},{lon}` | Request canonical physical units and requested air standard; call `normalizeWeather` with selected display units |
| `/locations/reverse?lat=&lon=` | `/geocode/v000903/coord/{lat},{lon}` | Validate returned coordinates and convert `location.long` to `Place.lon`; retain stable place identity |
| `/locations/resolve?q=` | `/geocode/v000903/addr/{encodedAddress}` | Encode the path segment, validate shape and expose recoverable search failure |
| `/nation/KR?...units` | `/v000903/nation/KR` | Canonical query plus requested air standard; `normalizeNation` |
| `/warnings/KR` | `/v000903/kma/special` | `normalizeWarnings`, preserve publication information and approved image handling |
| `/locations/search?q=` | Browser-local `PLACES` filtering | Preserve limit, submission freshness and separate address-resolution fallback |
| `/places`, `/places/:id` | Browser-local `PLACES` / existing `resolvePlace` | Preserve catalog and canonical coordinate identities |
| `/capabilities` | Public build/runtime capability configuration | Explicit live/demo and notification configuration; it is not an authorization mechanism |
| Favorites/settings/offline snapshots | Existing localStorage/IndexedDB | Retain validation, age limits and corruption recovery |
| `/api/health` | Separate static release availability and existing API availability checks | Do not claim a static file proves provider health; never probe `/gather/*` |

Use versioned coordinate weather. The existing weather-address Lambda is unsupported; `/geocode/.../addr` and `/weather/.../addr` are different operations. The checked Lambda bundles still report `nodejs6.10`; browser reuse does not require modifying or upgrading them, but any later Lambda code change needs a separate supported-runtime migration assessment.

## Migration findings and continuing hosting requirements

1. The migration introduced a browser transport module behind [web/src/api.ts](../../web/src/api.ts). Canonical queries, geocode-to-Place adaptation, catalog search and normalization now execute in the browser. Keep UI-facing normalized shapes so existing [App](../../web/src/App.tsx), weather views, snapshots and query identities remain compatible.
2. Preserve canonical C/m/s/hPa/km/mm requests, `airForecastSource=kaq` and the selected `airUnit`. Convert physical units exactly once in `weather-core`. Preserve null/sentinel, precipitation-period and snowfall handling, source timestamps and air-standard checks.
3. Direct public GETs use `credentials: 'omit'`, simple `Accept` and `Accept-Language: ko` headers, cancellation and bounded timeout/response size. Do not add JSON request Content-Type, installation cookies or CSRF headers to read-only GETs. Wildcard CORS supports credential-free reads, not credentialed access. `no-cors` would produce an unreadable opaque response and is not a fix. [MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).
4. Preserve schema validation, HTML/error detection, offline fallback and recoverable errors. Historical Lambda error responses omit CORS, so a failed cross-origin request may be visible only as a generic network failure. Do not promise an exact HTTP error code for every failure. Record the initial address-probe failure without inventing its cause.
5. Static hosting configuration now owns CSP and other response headers previously served by the removed Node wrapper. Allow only the explicit HTTPS API host in `connect-src`; the former self-only policy would block direct API fetch. No provider/VAPID private key or session secret belongs in a browser build.
6. Publish the entire production `web/dist` with the generated service worker. Use a private regular S3 bucket with CloudFront OAC and HTTPS; preserve hashed asset retention and revalidate HTML, manifest and worker. Rewrite only known HTML navigation routes to `index.html`, retaining missing-asset and unknown-path errors. [AWS OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).
7. Keep the existing API distribution's default EC2 origin and versioned routes intact. Replacing its default behavior with S3 could break nation, warnings and other legacy routes. A new static-only distribution avoids this change. A carefully isolated behavior on an existing distribution is possible, but needs an explicit complete route inventory; it is not a simple default-origin swap.
8. The removed wrapper's process-local rate limiter and generated request IDs do not exist on the direct path. Browser validation cannot enforce server-side quotas. Assess existing gateway/edge rate controls and traffic before launch; client refresh/deduplication remains useful but is not abuse protection. Direct calls still traverse the existing API caches; the BFF never bypassed those caches either.

For a same-origin alternative, configure distinct web-CDN API behaviors to existing API Gateway and service origins, preserving versioned paths or explicitly rewriting a web-only prefix. Normalize responses in the browser. This still avoids a Node BFF, but requires more routing/cache policy work. A URI rewrite alone does not reselect the cache behavior or origin, so the correct origin must already be selected. Avoid collision between the app's `/weather/:id/hourly` navigation and the legacy `/weather/v000903/coord/...` API prefix. [AWS edge-function restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-function-restrictions-all.html).

## Historical Web Push alternatives — not selected or implemented

The removed prototype used an atomic local file and in-process timer with a one-process assumption. It was not portable unchanged to Lambda or the ten-process legacy PM2 cluster. The current client contains no sender; [current hosting scope](../../infra/web/README.md) is static-only. The following alternatives are retained as historical research, not deployment instructions.

| Option | Additional always-running Node service | Required changes and judgment |
| --- | --- | --- |
| Static web + existing read API | None | Good read-side deployment target; push is incomplete until an implementation below exists |
| Extend the existing push system | None, if the existing worker is verified and reused | Separate web installation/subscription records, ownership/authentication, Web Push sender, rule lifecycle and stable IDs; inspect deployed runtime and actual worker before selection. Native token endpoints are not a drop-in interface |
| Serverless web notification API/sender | None | Supported-runtime Lambda, shared durable store, EventBridge Scheduler and bounded delivery/retry/deduplication; optional queue as needed. Recommended for isolation from old native workers, with new managed resources and implementation work |

Any future notification design must independently establish installation ownership, rule revisions, subscriptions, endpoint validation, deduplication, deletion and secrets. Do not assume the removed cookie/session model or routes still exist. Generic reminders and weather-condition alerts remain separate future scopes.

Service workers receive pushes but do not provide a reliable scheduled sender while the app is closed. Web Push subscriptions carry endpoints/encryption material rather than the current native `fcmToken`/`registrationId` contract. [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API). AWS documents scheduled Lambda invocation through EventBridge Scheduler; choosing that mechanism does not establish an implemented rule store or device delivery. [AWS scheduling guidance](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-run-lambda-schedule.html).

## Current handoff and proof

The recommended read-side migration has been implemented in `web/src/api.ts`, `web/src/direct-api.ts`, the shared core and static hosting configuration. Demo fixtures belong to the browser. The former optional Node server is removed, including its notification implementation and deployment recipe. The [implementation architecture](../architecture/web-client.md) and web diagrams describe the current boundary.

Verification serves only static files and covers mapped external operations, network/CORS errors, canonical/display units and air standards, search/location races, local favorites, snapshot corruption/offline recovery, deep links/404s and worker lifecycle. Notification UI must report unavailable without attempting subscription or rule operations. Future alert support requires separate persistence and actual device-delivery evidence.

The original 2026-09-24 review itself changed no application source, AWS resource, GitHub record or deployment. Subsequent implementation does not refresh the AWS/provider observations above. Final-domain and installed-device checks remain release work; deployment method selection is deferred.
