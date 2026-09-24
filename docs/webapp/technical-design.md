# Webapp technical and deployment design

Proposed architecture, 2026-09-24; not current deployment evidence. Product requirements: [specification](specification.md). Source baseline: [mobile API architecture](../architecture/mobile-api.md); official references are linked below.

## Architecture decision

Use `web/` for a React + TypeScript + Vite responsive SPA/PWA, React Router for navigation, TanStack Query for remote state and pure domain selectors for weather/air charts. Pin supported versions and Node LTS during implementation. Do not make modern dependencies part of the legacy `client/` or `server/` install.

React's official guidance favors considering a framework and describes the extra routing/data/rendering work of a standalone SPA. Here, the priority is an app-like parity client over an existing service; static hosting and isolated releases favor a SPA. If indexable regional weather pages and per-region rich link previews become primary requirements, revisit an SSR/SSG framework before building a public place-page catalog. [React guidance](https://react.dev/learn/build-a-react-app-from-scratch), [Vite deployment](https://vite.dev/guide/static-deploy.html).

| Option | Benefit | Cost and decision |
| --- | --- | --- |
| Publish patched `client/www` | Reuses many templates immediately | Cordova bootstrap/plugins, old build chain and phone-focused charts remain; useful only as a bounded prototype, not recommended production baseline |
| Separate modern PWA + web BFF | Independent build/deploy, typed contract adapters, desktop UX and browser capabilities | Rebuild presentation and characterize data; recommended for parity |
| SSR/SSG web framework + BFF | Better regional landing pages and server-rendered metadata | Extra rendering/cache/runtime ownership; reconsider if SEO becomes a primary goal |

Reuse domain vocabulary, translations, icons, source mappings, synthetic fixtures and chart semantics after audit. Port parser logic into typed, tested adapters; do not import the Angular runtime, raw secrets or mutable singleton storage. Existing native applications remain supported independently.

## Proposed components

- **PWA:** responsive screens, install manifest, foreground geolocation, service worker, offline snapshots and settings.
- **Web edge:** a new CloudFront distribution/domain with HTTPS, private S3 origin for static artifacts and `/api/*` routed to a dedicated API origin.
- **Web BFF:** a small Lambda-backed API Gateway service in `web-api/`; input validation, upstream allowlist, timeout/error normalization, rate limiting, trace IDs and response adaptation. It wraps existing public versioned APIs; it is not a collector or unrestricted proxy.
- **Existing weather system:** public weather/geocode gateway and KMA/world/nation/warning implementations. Its current release configuration/source ownership must be revalidated; gateway source is outside this checkout.
- **Web notification service:** installation/subscription ownership, persistent rules, due-time scheduler and condition evaluator, dispatch queue/worker and Web Push. Dedicated storage is proposed; do not put web endpoint objects into native token columns.

See the [interactive architecture](diagrams/webapp-architecture.html). Components and connections labeled proposed do not imply infrastructure has been created.

## Web API contract

New prefix `/api/web/v1`. Versioning isolates the new normalized schema from legacy consumers. Restrict methods, endpoint paths and upstream host; clients cannot choose an arbitrary upstream URL. Secrets remain server-side. The browser uses same-origin requests; server-side BFF calls do not require browser CORS. This does not solve provider outages, source licensing or capacity.

| Proposed method/path | Upstream or behavior |
| --- | --- |
| `GET /locations/search?q=&language=` | Provider adapter/current supported Places integration; return candidate label/country/provider ID; debounce 300 ms, minimum input, bounded results and quota |
| `GET /locations/resolve?id=&language=` | Resolve validated provider ID to coordinates, or use `/geocode/v000903/addr/:encodedAddress`; this is distinct from unsupported weather-by-address |
| `GET /locations/reverse?lat=&lon=&language=` | `/geocode/v000903/coord/:lat,:long` |
| `GET /weather?lat=&lon=&...units&language=` | `/weather/v000903/coord/:lat,:long`, six unit parameters and `airForecastSource=kaq`; normalize KMA/world responses |
| `GET /nation/KR?...units&language=` | `/v000903/nation/KR`; preserve separate weather/air collections and data ages |
| `GET /warnings/KR?language=` | `/v000903/kma/special`; structured text and approved image handling |
| `GET /places/:publicPlaceId` | Approved public-region catalog/resolution for share URLs; no private favorite lookup |
| `POST /installations` | Create limited anonymous web installation/session for notification ownership; no account required for reading weather |
| `PUT /subscriptions/current`, `DELETE /subscriptions/current` | Upsert/remove the authenticated installation's Web Push subscription; idempotent |
| `GET /notification-rules`, `PUT /notification-rules/:id`, `DELETE /notification-rules/:id` | Owned city rules; explicit saved revision/result; no native city-index identity |
| `POST /notifications/test` | Throttled optional test, owner only; distinguish queue acceptance from device display |

All new endpoints are proposals, not callable today. Define payload schemas/OpenAPI before implementation. Search provider integration needs API restrictions, attribution, billing/quota and permitted caching review; do not carry old browser keys forward. [Google autocomplete documentation](https://developers.google.com/maps/documentation/javascript/place-autocomplete-overview).

Finite numeric coordinates must satisfy latitude [-90,90], longitude [-180,180]; zero is valid. Normalize precision once (initial candidate: three decimal places, matching legacy behavior) and test coastal/border regions before adopting it. Wire paths are `lat,long`; internal model uses `{lat, lon}` with an explicit adapter. Always encode addresses/path segments. New code never relies on unversioned weather defaults.

Retain all six unit settings (`temperatureUnit`, `windSpeedUnit`, `pressureUnit`, `distanceUnit`, `precipitationUnit`, `airUnit`) and a normalized locale in request/cache identity. All upstream headers/query forwarding must be explicit; anonymous public reads do not forward installation cookies. The upstream precipitation-unit anomaly A04 is a **release gate for unit parity**: characterize every supported unit combination; if confirmed, separately fix the backend with regression evidence or adopt a verified canonical-unit conversion adapter. Do not mark it solved by changing frameworks.

Return an envelope containing `schemaVersion`, `location`, `timezone` when reliably known, `units`, `source`, section-level observation/publication times, `fetchedAt`, optional upstream age metadata, `current`, `hourly`, `daily`, `air` and `availability`. Validate provider discriminators against captured supported payloads; unknown/malformed bodies become an explicit upstream-schema error. Preserve ambiguous source times as such rather than inventing timezone precision.

Error envelope: `{error:{code,message,retryable,requestId}}` with real HTTP status (400 invalid input, 429 quota, 502 invalid/upstream failure, 504 timeout). HTML and application-error bodies with HTTP 200 are failures too. Partial air absence may still produce a valid weather result with unavailable/stale air metadata. Normalize known sentinel values by field; keep zero intact.

## Request freshness, caching and local persistence

Request key: API schema/version + location coordinates + six units + language + air source. Tie completion to stable location ID and request generation. Abort superseded requests where possible; an old result cannot mutate selected-city state. Debounce/deduplicate logical calls. Foreground auto-refresh checks the legacy ten-minute threshold but honors manual refresh; visible-tab return triggers a freshness check. User refresh interval options remain available with their foreground limitation clearly explained.

Initial timeout proposal: one BFF upstream attempt within a 12-second budget; client timeout 15 seconds. No overlapping timed attempts. Disable automatic transport retries initially, exposing manual retry and `Retry-After` for rate limits; tune only after measuring the existing gateway's internal retries. Abort/detach does not guarantee the upstream stopped, so enforce server concurrency limits.

At first beta, disable CDN caching for `/api/*`. Add caching only after proving units/language/source separation and upstream age semantics. Retain provider timestamps so a freshly fetched old forecast is not presented as new. Proposed foreground weather refresh threshold is ten minutes; air/warnings have source-specific stale thresholds agreed after inspecting publication cadence. These are independent of CDN and provider TTLs.

Use small versioned preferences in localStorage, IndexedDB for bounded last successful snapshots/favorites, and Cache Storage for versioned app assets. Do not cache subscription/billing writes or opaque API errors through the service worker. Store received units/source/observation times with each snapshot. Expire weather snapshots after 24 hours for offline display by default; retain only a small bounded set per saved location and evict oldest first. Never portray offline warnings as current.

Namespace `tw.web.v1`, validate/migrate schema with rollback-compatible reads and clear invalid-record recovery. Offer user-triggered web favorites/settings export/import; exclude notification secrets and precise current location by default. Native app storage cannot be read by this origin. Storage can be evicted or denied, so session-only fallback and recoverable startup are required. [MDN storage behavior](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).

Location access is user-triggered over HTTPS; manual search remains available. Do not background-track the device. Avoid recording precise locations, full search text, subscription endpoints or keys in access/analytics logs; configure both edge and API logging accordingly, not just application logging. [MDN geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API).

## Notifications and feature boundaries

Web Push uses a service-worker `PushSubscription` with endpoint/encryption material, rather than a Cordova native token. Keep the legacy `/v000902/push*` and native workers unchanged during initial web integration. [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API).

1. Detect notification/service-worker/push capabilities; show a functional unavailable state when absent. On iOS/iPadOS, plan the supported home-screen install and user-gesture permission flow; verify exact devices at release. [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
2. Use a random installation identity with a signed Secure/HttpOnly/SameSite cookie, same-origin/CSRF checks on mutations and ownership checks on every rule/subscription action. No public sequential ID grants access. Anonymous installation ownership is not cross-device identity.
3. Store endpoint/keys encrypted at rest with restricted access, timezone, city coordinates/label, units, weekdays, alarm times, alert start/end and revision. UI Save succeeds only after persistent server acknowledgement; use idempotency keys/revisions for retries. Expire inactive installations under an explicit retention policy; propose 90 days since last use and document deletion behavior.
4. Use a durable due-time schedule, queue and worker. Resolve next fire from wall time plus IANA timezone, covering DST/overnight windows; derive condition alerts from verified existing rain/snow/air rules and fixtures, not from a newly invented alert definition. Evaluate shared weather per region/time bucket to avoid one upstream call per subscriber; size fanout/limits in the spike.
5. Record schedule time → queue acceptance → provider acceptance separately; display/click evidence is only available when actually observed. Dedupe by rule/time/event, bound retries, honor provider backpressure, expire terminal 404/410 subscriptions, reconcile on next visit and provide a send kill switch. Accept OS delivery delays; no exact-time guarantee.
6. Validate subscription endpoints against supported push-provider HTTPS hosts and public destinations, reject redirects/private networks, and use a maintained sender library. Public subscription URLs are untrusted outbound targets, not arbitrary fetch destinations.

Browser background sync is not the alarm clock; scheduling stays server-side because browser support/timing is conditional. [MDN periodic sync](https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API). A web current-location alert uses the last explicitly saved location, which must be shown in the UI; continuous movement tracking remains a native-only difference.

Commercial proposal: keep beta free/ad-free. If paid web access is chosen, add managed identity, hosted checkout, verified idempotent billing webhooks, server-authoritative entitlements, refunds/expiry and support flows. A native purchase bridge needs account linking and server verification; neither a copied localStorage flag nor a client receipt alone grants access. Provider and commercial terms are decisions to validate separately.

## Hosting, environments and deployment

Recommend new AWS resources alongside existing infrastructure: private S3 + CloudFront for `web.<owned-domain>` (placeholder), `/api/*` → API Gateway/Lambda, separate notification table/queue/workers and secrets. Use an AWS region chosen for users/upstream latency and owner requirements; no region or resource is provisioned by this design. Static S3 plus a same-domain API is an established hosting pattern. [AWS SPA guidance](https://docs.aws.amazon.com/solutions/improved-single-page-application-performance-using-amazon-cloudfront/).

Use S3 REST origin + OAC and HTTPS, rather than a public website bucket. Separate dev/preview, staging and production configs, domains, storage, sender credentials and subscriptions. Preview uses fixtures by default and never sends real production notifications. Server-only configuration includes `UPSTREAM_API_BASE_URL`, provider credentials and `WEB_PUSH_PRIVATE_KEY`; browser build configuration contains only public origin/feature metadata and the public push key. [AWS origin access](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-overview.html).

Serve hashed assets with long immutable caching; `index.html`, manifest and service-worker entry use revalidation/short TTL as appropriate. Rewrite only known HTML navigation routes to `/index.html` in the static behavior. Never apply distribution-wide 403/404 → 200 fallback that could hide API errors; `/api/*`, missing assets and unknown paths retain actual status. Implement/test the scoped viewer-request function explicitly. [AWS URL rewrite example](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/example_cloudfront_functions_url_rewrite_single_page_apps_section.html).

Baseline headers: CSP restricted to required sources (including chosen map/image provider), frame restrictions, content-type protection, referrer policy and scoped permissions policy. Render warning text safely; approved HTTPS images may fail independently. Rate limits/quota protect provider spend and legacy service capacity. A browser-visible API URL is not a secret or access-control mechanism.

Proposed pipeline: scoped CI → immutable artifact + digest → staging deploy → browser/contract/push evidence → authorized production promotion of the same artifact → canary exposure → expansion. Path filters isolate web pipelines from old mobile/server release recipes. Infrastructure belongs in versioned IaC; short-lived deploy credentials, separate roles and auditable releases. Actual release authority is a later task boundary.

Rollback restores the prior HTML/asset release and BFF alias; retain old hashed assets and compatibility with at least the previous cache schema. A service worker can outlive an edge rollback: use a network-revalidated update/kill mechanism, compatible activation and verify both existing-installed and new sessions. Stop web push via its own flag without touching native sending. Avoid destructive data migrations in the first rollout.

Monitor source age, BFF schema/errors/latency, cache behavior, request amplification and upstream saturation, browser startup failures, notification lag/failures and subscription cleanup. Alert thresholds and on-call owner are launch gates. Cost planning must include CDN bytes/requests, Lambda duration, API requests, storage/queue/scheduler, logging, search provider quota, images and notification fanout. No fixed monthly price is quoted without traffic/region/payload inputs.

## Unverified release dependencies

Current API host, deployed gateway source/ownership, provider freshness/world coverage, geocoder/search quota, asset/data redistribution permissions, upstream unit correctness, cache policy, push condition semantics/capacity and paid policy remain prerequisites. Historical EC2/AWS documentation is evidence for investigation, not a fresh availability test. None prevents designing or implementing isolated UI/fixtures; each gates the related production claim.
