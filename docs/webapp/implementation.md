# Webapp implementation and release status

Issue: [WizardFactory/TodayWeather#2558](https://github.com/WizardFactory/TodayWeather/issues/2558). Implemented locally on 2026-09-24. The full mobile parity release remains open; this is an executable integration candidate, not a deployed or production-approved release.

## Run locally

Use Node >=22.12 (verified with 22.22.2) from the repository root. These npm workspaces are independent of the historical `client/` and `server/` packages.

```sh
npm ci --ignore-scripts
WEB_API_MODE=demo npm run dev
```

Open http://localhost:5173. Demo mode is deliberately labelled on weather, air, national and warning screens. It uses synthetic fixtures copied from `docs/rewrite/examples/`; changing cities does not make those fixtures real observations. Demo air units are restricted to the fixture's Korean standard.

```sh
# Real upstream reads; no legacy server, collectors or database startup.
npm run dev

# Production bundle, also needed to exercise service worker/offline behavior.
npm run build
WEB_API_MODE=demo WEB_ORIGIN=http://localhost:4174 npm start
```

Open http://localhost:4174. Omit `WEB_API_MODE=demo` to use live data. Live provider failures return errors and never substitute synthetic responses. The browser can show a previously received snapshot with an explicit disconnected/stale notice for up to 24 hours.

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

For a preinstalled browser, set `PLAYWRIGHT_EXECUTABLE_PATH`. Browser tests own a demo server on port 4174; stop other servers on that port first. CI installs Chromium and runs these commands without production credentials. CI has been authored, not executed remotely.

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
| Notifications | Owned browser subscription, weekday/time rules, explicit save/cancel, test send, unsubscribe, delete-favorite reconciliation | Optional server configuration, real APNs/FCM/browser delivery; conditional rain/snow/air rules are **not implemented** |
| Sharing/install/help | Catalog-only share links, install help, privacy/storage/provider guidance, PWA manifest and icons | HTTPS/iOS home-screen install and all supported device checks |
| Store purchases/widgets | Honest web availability/price and native-feature guidance | No native purchase migration, billing, native widgets/watch or background tracking |

Four settings subpages are consolidated into `/settings`; weather/air overview is available in the same product. Supported interfaces preserve the user actions, not the old Cordova navigation structure. The paid tier is not represented as implemented.

## Architecture and contracts

See [implemented architecture](../architecture/web-client.md) and its [interactive diagram](diagrams/webapp-implementation.html). The earlier [technical design](technical-design.md) and [proposed cloud diagram](diagrams/webapp-architecture.html) remain a future scaling design. The running candidate uses one Node process serving static assets and a same-origin API. It is **not a Lambda implementation**.

- `packages/weather-core/`: source-aware, unit-aware normalization without mutating provider payloads. KMA `-50` temperatures and negative nonnegative metrics become unavailable; valid zero remains zero. Old daily rows are excluded by source date.
- `web/`: React/TypeScript UI, versioned local preferences, IndexedDB snapshots keyed by location and all units, query cancellation and explicit stale/demo notices. Coordinates are rounded to three decimals; sharing uses a curated public city ID rather than exact current location.
- `web-api/`: fixed upstream paths, bounded timeout/body size, JSON/schema checks, canonical physical unit requests and local conversion; optional owned notification routes.
- `infra/web/`: Docker image and single-replica Caddy/Compose staging recipe. No resources or DNS have been created.

The service worker caches the shell and hashed assets, not API responses. Activation is user initiated for updates; the previous shell cache is retained for existing tabs. Browser snapshots are separate and expire after 24 hours. Maps and warnings require a network connection. Losing browser storage loses local favorites and snapshots; anonymous notification ownership expires after 90 days without activity and is not an account-recovery mechanism.

## Evidence from live reads

Bounded public reads on 2026-09-24 returned HTTP 200 for health, domestic coordinate weather, reverse geocode, national data and warnings. See [probe receipt](../../reports/sdlc/webapp-implementation/api-probe.json). A successful response does not establish data quality:

- Seoul's KMA current temperature was 25.2 C, while its yesterday temperature used `-50`; the upstream summary reported an invalid +75 degree comparison. The client computes comparisons from validated values instead.
- Daily data mixed April 2025 rows with September 2026 rows. The adapter excluded historical rows from the future forecast.
- Nationwide air included a 2021 observation timestamp; it is visibly stale. Domestic weather did not include an air station list.

No provider freshness repair, legacy server mutation, database migration or mobile release has been performed. A public release with maximum parity must resolve these upstream and device gates, plus the explicit feature gaps above; keep #2558 open.
