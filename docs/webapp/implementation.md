# Webapp implementation and release status

Issue: [WizardFactory/TodayWeather#2558](https://github.com/WizardFactory/TodayWeather/issues/2558). Initial implementation prepared on 2026-09-24; updated to a static-only client. The full mobile parity release remains open; this is an executable integration candidate, not a deployed or production-approved release.

## Run locally

Use Node >=22.12 (verified with 22.22.2) from the repository root. These npm workspaces are independent of the historical `client/` and `server/` packages.

```sh
npm ci --ignore-scripts
npm run dev
```

Open http://127.0.0.1:5173. The default is **direct/live**: the browser calls the existing public API and the launcher starts only Vite. Set a loopback `WEB_ORIGIN` for another development host/port. For explicitly labelled synthetic data use `VITE_WEB_MODE=demo npm run dev`; changing cities does not make demo fixtures real observations.

```sh
# Build only the static client. No API process is needed.
npm run build
npm start
```

Open http://127.0.0.1:4174 to exercise the production bundle, service worker and snapshots. Live failures never substitute demo responses; a previously received snapshot may be shown with a disconnected/stale notice for up to 24 hours. The preview is a local file server, not a production requirement.

Deploy `web/dist` using the [S3 + CloudFront runbook](../../infra/web/static/README.md) and template for **app.tdywx.xyz**. No AWS resources or DNS were created by this implementation.

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests own a static-only server on port 4174 and intercept external API reads with synthetic raw provider fixtures. They assert that the browser makes no `/api/` requests; they do not prove live provider freshness. Set `PLAYWRIGHT_EXECUTABLE_PATH` for a preinstalled browser. CI also publishes `web-static-dist` for review.

Only direct transport is supported. Omit `VITE_WEB_TRANSPORT` or set it to `direct`; `proxy` is rejected. `VITE_WEB_MODE` selects `live` or labelled `demo` data at build time. The former web API workspace, notification sender and Docker deployment recipe have been removed. Node runs build/development/preview tools only.

## Implemented surface

| Mobile capability | Web implementation | Remaining release work |
| --- | --- | --- |
| Startup and saved locations | Explicit search/current-location consent, catalog + live geocode, 30 favorites, delete/restore, start screen | OS permission matrix and non-Korean geocode/provider checks |
| Current/hourly weather | Current values, yesterday delta, merged KMA one-hour/three-hour forecast, KMA precipitation shown only as observed or approximate `rn1` amounts (D45), forecast publication time, hourly chart and accessible numeric table | Upstream missing yesterday values remain unavailable |
| Daily/combined weather | Yesterday and future daily rows, KMA daily forecast amounts hidden with past-day observed accumulation only, AM/PM icons, min/max range, overview | Confirm every legacy ancillary metric/provider format |
| Air details | Seven pollutants, station selection, hourly/daily series, independent observation timestamps; text-only provider summary with unknown-time caveat when station data is absent | Live air availability and all four provider standards |
| Nationwide weather/air | Schematic regional map and complete numeric lists; weather/pollutant tabs | Repair stale upstream nationwide air feed before release |
| Special weather reports | Structured bulletins, offset-qualified KR publication times in KST and official links | Provider freshness and active-warning device checks |
| Preferences | Six unit families, four themes, startup/refresh, local backup/import | Photo theme uses a sky color treatment, not native photo packs |
| Notifications | Unavailable guidance recommending the existing mobile app, with a return-to-weather link; no permission request, subscription or scheduling form | Web Push and conditional rain/snow/air rules remain a separately scoped future feature |
| Sharing/install/help | Catalog-only share links, install help, privacy/storage/provider guidance, PWA manifest and icons | HTTPS/iOS home-screen install and all supported device checks |
| Store purchases/widgets | Honest web availability/price and native-feature guidance | No native purchase migration, billing, native widgets/watch or background tracking |

Four settings subpages are consolidated into `/settings`; weather/air overview is available in the same product. Supported interfaces preserve the user actions, not the old Cordova navigation structure. The paid tier is not represented as implemented.

## Architecture and contracts

See [implemented architecture](../architecture/web-client.md) and its [interactive diagram](diagrams/webapp-implementation.html). The [technical design](technical-design.md) and [hosting diagram](diagrams/webapp-architecture.html) use the same static-only boundary. The default runtime is a static PWA on private S3/CloudFront with direct calls to the existing public API. It requires no new persistent Node service or API Lambda.

- `packages/weather-core/`: source-aware, unit-aware normalization without mutating provider payloads. KMA `-50` temperatures and negative nonnegative metrics become unavailable; valid zero remains zero. Daily rows older than the source's yesterday are excluded by source date. KMA `r06`/`s06` are never shown as amounts; KMA rain comes only from `rn1`, marked as observed (current 1 hour, past short 3 hours, past-day accumulation) or approximate (shortest 1-hour category lower bound) per [D45](../architecture/web-client.md#precipitation-and-snow-d45). Zero snowfall stays in data but is hidden in the UI, while positive values below 0.1 mm (0.01 in) display as `<0.1` (`<0.01`).
- `web/`: React/TypeScript UI, versioned local preferences, IndexedDB snapshots keyed by location and all units, query cancellation and explicit stale/demo notices. Normalization cache-key revision v3 separates new weather query/snapshot keys from older normalized values; favorites and settings are preserved. Snapshots are shown first while refreshing, deleted with their place and pruned after 24 hours. Coordinates are rounded to three decimals; sharing uses a curated public city ID rather than exact current location.
- `web/src/direct-api.ts`: fixed public API operations, bounded reads, JSON/schema checks, canonical physical units and local normalization; local catalog and capabilities. Network/CORS failures receive Korean retry guidance without guessing their cause; cancellation and timeouts retain their own handling. The overseas catalog remains available, but error messaging cannot repair upstream availability.
- `web/src/demo/`: browser-owned synthetic raw fixtures, selected only by explicit demo mode.
- `infra/web/static/`: private S3/OAC, CloudFront/TLS/DNS template, route function and guarded dry-run uploader. Deployment method selection and AWS changes remain separate operator tasks.

The service worker caches the shell and hashed assets, not API responses. Activation is user initiated for updates; the previous shell cache is retained for existing tabs. Browser snapshots are separate and expire after 24 hours. Maps and warnings require a network connection. Losing browser storage loses local favorites and snapshots.

## Evidence from live reads

Bounded public reads on 2026-09-24 returned HTTP 200 for health, domestic coordinate weather, reverse geocode, national data and warnings. Raw probe receipts are local, ignored SDLC records. A successful response does not establish data quality:

- Seoul's KMA current temperature was 25.2 C, while its yesterday temperature used `-50`; the upstream summary reported an invalid +75 degree comparison. The client computes comparisons from validated values instead.
- Daily data mixed April 2025 rows with September 2026 rows. The adapter excluded historical rows from the future forecast.
- Nationwide air included a 2021 observation timestamp; it is visibly stale. Domestic weather did not include an air station list.

No provider freshness repair, legacy server mutation, database migration or mobile release has been performed. A public release with maximum parity must resolve these upstream and device gates, plus the explicit feature gaps above; keep #2558 open.

## Verification records

Run the checks in the static deployment runbook and `npm run test:e2e` against the built static files. The [Web app workflow](../../.github/workflows/web.yml) publishes `web-browser-evidence` and `web-static-dist` as CI artifacts. Local SDLC reports under `reports/sdlc/` are ignored and are not part of this PR; maintained implementation and operating guidance live under `docs/` and `infra/`. Historical results above retain their original dates and scope.
