# Webapp implementation and release plan

Updated for the static-only decision. The browser client and static hosting preparation exist; the former Node adapter and notification service are removed. Follow [implementation status](implementation.md), [specification](specification.md) and [technical design](technical-design.md). Full mobile parity remains open in [#2558](https://github.com/WizardFactory/TodayWeather/issues/2558).

## Current scope and remaining work

| Workstream | Current boundary | Remaining evidence / owner |
| --- | --- | --- |
| Browser foundation | React/Vite, shared normalization, local preferences and snapshots | Browser/version/accessibility matrix; frontend/QA |
| Weather and locations | Direct public API, catalog/address search, geolocation, current/yesterday/hourly/daily/overview | Provider freshness, international coverage, recovered-observation provenance; API/frontend |
| Air and national data | Pollutant/station views, provider text fallback, nationwide maps/lists, warnings | Actual station availability, stale national feed and warning freshness; API owner |
| PWA | Static shell, install help, controlled updates and offline recovery | iOS/Android installed sessions, old/new releases, storage denial/eviction; QA |
| Notifications | Unavailable/mobile-app guidance only | Separate product/design decision before any browser subscription or sender implementation |
| Hosting | S3/OAC/CloudFront template, navigation function and guarded uploader | Reuse existing resources after current configuration check; deployment method deferred; operations |
| Commercial/native parity | Explicit unsupported purchase/widget/watch behavior | Resolve branding, monetization, transfer and account-sync choices; AK/product |

The original 2026-09-24 estimate of 8–12 weeks assumed a larger parity implementation including a new notification backend. It is historical planning context, not a remaining-duration estimate for this static client. Re-estimate any future alerts, commercial work or provider repair as separate scope after requirements and owners are known.

## Source ownership

| Location | Purpose |
| --- | --- |
| `web/`, root package/lockfile and tooling | Independent browser workspace, build and local static preview |
| `packages/weather-core/` | Typed provider/units/time/catalog normalization |
| `web/src/direct-api.ts`, `web/src/demo/` | Fixed external API operations and explicit browser-local demo data |
| `web/public/` | Manifest/icons/service worker |
| `infra/web/static/`, `scripts/deploy-web-static.mjs` | Static hosting preparation and ordered uploader |
| `.github/workflows/web.yml` | Build/test and artifact publication; not a production deployment workflow |
| `docs/webapp/`, `docs/architecture/web-client.md`, web diagrams | Product boundaries, current architecture and operating guidance |
| `client/`, native bundles and `server/` | Separate existing products/services; no migration required for static hosting |

Do not copy native configuration secrets into the browser bundle or reintroduce an optional web server to run demo fixtures. Production uses direct/live; demo remains explicitly labelled and is rejected by the production uploader.

## Verification plan

From the repository root, run `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e`. These are reproducible commands, not a claim that every future revision passed. CI publishes `web-static-dist` and browser evidence. Actual results must be bound to the reviewed revision.

| Layer | Required coverage |
| --- | --- |
| Domain/provider fixtures | Source discriminators; KMA/DSF current/hourly/daily/air; malformed arrays and application errors |
| Units and time | All six settings, midnight/yesterday, zero/sentinel handling, mixed forecast durations, snow and optional air summaries |
| Direct transport | Exact public paths, encoded address, omitted credentials, abort/size/error handling, no live-to-demo fallback |
| State/concurrency | Search submission freshness, late location results, city/unit changes, favorite deletion and preference restoration |
| Static browser journeys | Weather/air/nation/warnings/settings/help; notification-unavailable guidance; zero local `/api/` requests |
| Storage and worker lifecycle | Offline/corrupt/expired records, first worker claim, explicit update, previous assets and rollback-compatible reads |
| Hosting and release | Correct deep links and error routes, private S3/OAC, CSP/cache/TLS, guarded dry-run, destination mismatch and interrupted upload |
| Final-domain checks | Real API CORS/CSP and freshness, exact supported browser/device versions, installed iOS/Android PWA behavior |

Use isolated fixtures and static file servers for local tests. Do not start the legacy service or run its integration suite merely to verify a browser change; startup may connect databases and launch collection. Never use `/gather/*` as a read-only probe. Actual API success does not prove accurate or fresh observations.

Future notification implementation needs its own ownership, persistence, timing/DST, cancellation, duplicate/expiry, privacy and real-device tests. Those are not supported operations or required processes of the current static app.

## Release and rollback decisions

The domain is **app.tdywx.xyz** and the requested bucket is **tdywx-app-141248341265-apne2**. Operations must recheck the existing distribution, certificate, DNS, OAC and route function before reuse. The new-resource template does not adopt an existing bucket. Preserve the public API distribution and existing native routes.

Deployment method selection is postponed. The manual uploader is prepared and defaults to dry-run; any later automation must use the same verified complete artifact and checks. This plan does not authorize resource creation, production upload or deployment-trigger changes.

Before release, resolve operating ownership/budget, asset/data/search permissions, provider gaps and explicit commercial/native exceptions. Run the final-domain and installed-device checks from the [runbook](../../infra/web/static/README.md). Announce only features verified in the static client; the release is not complete mobile parity.

Archive each verified artifact with its source revision. Keep old hashed files and roll back by restoring a complete prior release, invalidating CloudFront and checking new and already-installed sessions. Upload interruption may leave mixed files; retry the same artifact or restore the archived release before declaring recovery. Define wrong-city/unit/date, source-age, error-rate and upstream-load rollback triggers with operations before public exposure.
