# Webapp implementation and release status

Issue: [WizardFactory/TodayWeather#2558](https://github.com/WizardFactory/TodayWeather/issues/2558). Implemented locally on 2026-09-24. The full mobile parity release remains open; this is an executable integration candidate, not a deployed or production-approved release.

## Run locally

Use Node >=22.12 (verified with 22.22.2) from the repository root. These npm workspaces are independent of the historical `client/` and `server/` packages.

```sh
npm ci --ignore-scripts
npm run dev
```

Open http://127.0.0.1:5173. The default is **direct/live**: the browser calls the existing public API and the launcher starts only Vite. Set a loopback `WEB_ORIGIN` for another development host/port. For explicitly labelled synthetic data use `VITE_WEB_MODE=demo npm run dev`; changing cities does not make demo fixtures real observations.

```sh
# Build only the static client. No API process is needed.
npm run build:web
npm run preview:static
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

The optional older Node adapter remains available with `VITE_WEB_TRANSPORT=proxy npm run dev`. For a proxy production build use `VITE_WEB_TRANSPORT=proxy npm run build`, then configure the API and `npm start` as in the [legacy runbook](../../infra/web/README.md). This mode is not accepted by the static uploader. `WEB_API_MODE` controls that optional server; `VITE_WEB_MODE` controls a direct client at build time.

## Implemented surface

| Mobile capability | Web implementation | Remaining release work |
| --- | --- | --- |
| Startup and saved locations | Explicit search/current-location consent, catalog + live geocode, 30 favorites, delete/restore, start screen | OS permission matrix and non-Korean geocode/provider checks |
| Current/hourly weather | Current values, yesterday delta, broken-line-safe hourly chart and accessible numeric table | Upstream missing yesterday values remain unavailable |
| Daily/combined weather | Valid future daily rows, AM/PM icons, min/max range, overview | Confirm every legacy ancillary metric/provider format |
| Air details | Seven pollutants, station selection, hourly/daily series, independent observation timestamps | Live air availability and all four provider standards |
| Nationwide weather/air | Schematic regional map and complete numeric lists; weather/pollutant tabs | Repair stale upstream nationwide air feed before release |
| Special weather reports | Structured bulletins, publication text and official links | Provider freshness and active-warning device checks |
| Preferences | Six unit families, four themes, startup/refresh, local backup/import | Photo theme uses a sky color treatment, not native photo packs |
| Notifications | Static mode explicitly reports unavailable; optional proxy mode retains owned subscriptions and weekday/time reminders | Static Web Push needs separate backend scheduling; conditional rain/snow/air rules and device verification remain open |
| Sharing/install/help | Catalog-only share links, install help, privacy/storage/provider guidance, PWA manifest and icons | HTTPS/iOS home-screen install and all supported device checks |
| Store purchases/widgets | Honest web availability/price and native-feature guidance | No native purchase migration, billing, native widgets/watch or background tracking |

Four settings subpages are consolidated into `/settings`; weather/air overview is available in the same product. Supported interfaces preserve the user actions, not the old Cordova navigation structure. The paid tier is not represented as implemented.

## Architecture and contracts

See [implemented architecture](../architecture/web-client.md) and its [interactive diagram](diagrams/webapp-implementation.html). The earlier [technical design](technical-design.md) and [proposed cloud diagram](diagrams/webapp-architecture.html) remain a future scaling design. The default runtime is a static PWA on private S3/CloudFront with direct calls to the existing public API. It requires no new persistent Node service or API Lambda.

- `packages/weather-core/`: source-aware, unit-aware normalization without mutating provider payloads. KMA `-50` temperatures and negative nonnegative metrics become unavailable; valid zero remains zero. Old daily rows are excluded by source date.
- `web/`: React/TypeScript UI, versioned local preferences, IndexedDB snapshots keyed by location and all units, query cancellation and explicit stale/demo notices. Coordinates are rounded to three decimals; sharing uses a curated public city ID rather than exact current location.
- `web/src/direct-api.ts`: fixed public API operations, bounded reads, JSON/schema checks, canonical physical units and local normalization; local catalog and capabilities.
- `web-api/`: optional legacy proxy and owned notification routes, excluded from the static runtime.
- `infra/web/static/`: private S3/OAC, CloudFront/TLS/DNS template, route function and guarded dry-run uploader. `infra/web/` also retains the explicitly selected legacy Docker/Caddy recipe. No resources or DNS have been created.

The service worker caches the shell and hashed assets, not API responses. Activation is user initiated for updates; the previous shell cache is retained for existing tabs. Browser snapshots are separate and expire after 24 hours. Maps and warnings require a network connection. Losing browser storage loses local favorites and snapshots; anonymous notification ownership expires after 90 days without activity and is not an account-recovery mechanism.

## Evidence from live reads

Bounded public reads on 2026-09-24 returned HTTP 200 for health, domestic coordinate weather, reverse geocode, national data and warnings. See [probe receipt](../../reports/sdlc/webapp-implementation/api-probe.json). A successful response does not establish data quality:

- Seoul's KMA current temperature was 25.2 C, while its yesterday temperature used `-50`; the upstream summary reported an invalid +75 degree comparison. The client computes comparisons from validated values instead.
- Daily data mixed April 2025 rows with September 2026 rows. The adapter excluded historical rows from the future forecast.
- Nationwide air included a 2021 observation timestamp; it is visibly stale. Domestic weather did not include an air station list.

No provider freshness repair, legacy server mutation, database migration or mobile release has been performed. A public release with maximum parity must resolve these upstream and device gates, plus the explicit feature gaps above; keep #2558 open.
