# Shared agent instructions

This file is the canonical repository guidance for Codex and Claude Code. CLI-specific entrypoints must import or link here; do not duplicate common rules.

## Communication and preservation

- Communicate with AK in Korean. Use English as the primary language for repository content.
- Preserve existing user changes, instructions, skills and configuration. Inspect the working tree before editing and keep changes within the requested scope.
- When installing or updating a skill, maintain one canonical copy at `.agents/skills/<name>/` for repository scope or `~/.agents/skills/<name>/` for user scope. Link it into both Codex and Claude Code skill directories, configure required hooks for both, and verify discovery and execution in the intended scope before reporting completion.
- When available, read the shared user policy at `~/.agents/policies/sdlc.md` at task intake and follow its SDLC selection. Simple questions do not require a development workflow. Do not copy user-level policy into this file.

## Read the architecture first

Use the [architecture index](docs/architecture/README.md), then the document relevant to the task:

- [Service overview](docs/architecture/service-overview.md): components, process modes, data stores, native variants and deployment evidence.
- [Weather collection](docs/architecture/weather-collection.md): timers, domestic ingestion, scrape jobs, DSF/AQI cache fills and failure behavior.
- [Mobile API flow](docs/architecture/mobile-api.md): app URL construction, middleware order, response conversion and native clients.
- [AWS/code correlation](docs/architecture/aws-code-correlation.md): timestamped AWS routing, deployed Lambda behavior and remaining host-level gaps.
- [Evidence and limitations](docs/architecture/evidence.md): source lookup map and missing external dependencies.
- [Service EC2 internals](docs/architecture/ec2-internals.md): observed nginx/PM2 topology, host configuration, database sockets and deployed-code differences.
- [EC2 SSH access](docs/architecture/ec2-access.md): user-confirmed SSH command and local key location.

Treat repository claims as revision-bound and AWS claims as timestamped observations. Recheck relevant implementation before changing behavior.

## Repository map and edit locations

| Area | Start here |
| --- | --- |
| HTTP startup and modes | `server/bin/www`, `server/app.js`, `server/config/config.js` |
| Current API surface | `server/routes/v000903/index.js`; follow reused older routers |
| Domestic collection | `server/controllers/controllerManager.js`, `server/routes/v000001/routeGather.js`, `server/lib/collectTownForecast.js`, `server/lib/kmaScraper.js` |
| Domestic response | `server/controllers/controllerTown.js`, `server/controllers/controllerTown24h.js` |
| World response/cache | `server/controllers/worldWeather/controllerWorldWeather.js`, `dsf.controller.js`, `controllerAqi.js` |
| App requests and state | `client/www/js/service.weatherutil.js`, `service.weatherinfo.js`, `service.storage.js`, startup/tab controllers |
| Platform builds | `client/gulpfile.js`, product package/config variants, `tw.ios/`, `ta.ios/`, `applewatch/` |

Prefer shared app edits in `client/www/` when that is the intended build source. Native widgets and bundled platform `www` trees can differ; inspect the relevant build task before assuming files are generated, disposable or synchronized. Avoid bulk edits to bundled vendor libraries or Cordova platform code for application-only changes.

## Architecture constraints to preserve

- The app builds `/weather/v000903/...` and `/geocode/v000903/...`. The 2026-09-20 AWS/deployed-source evidence verifies CloudFront -> API Gateway -> Lambda; weather coordinates dispatch to EC2 KMA address or DSF coordinates. Gateway code is outside this checkout. Recheck current evidence before relying on that deployment mapping; the inspected service host uses a 5bca407 checkout with config/logger edits, service mode and DB version 2.0. Separate gather/Mongo internals remain unverified. Weather address Lambda is unsupported (501); unversioned weather defaults to v000901.
- Domestic weather is largely gathered before requests; the latest DSF/AQI path can call providers during a request. A legacy collector's presence does not establish startup wiring.
- `SERVER_MODE` selects background work, not route visibility. Its default `local` starts both gather and scrape. Inspect startup side effects before running the server; use an isolated configured environment for runtime verification.
- `/gather/*` GET handlers can call providers and write data. Do not use them as health probes; `/health` is the explicit basic health route.
- Respect KMA middleware order, requested units, invalid-value sentinels, publication times, yesterday/local-midnight comparisons and coordinate order. Mongo geographic arrays are `[longitude, latitude]`; app locations use `{lat, long}`.
- Account for `DB_DATA_VERSION` when changing domestic storage or reads. Do not silently drop compatibility with one format or older mounted API versions.
- WeatherInfo's ten-minute memory refresh gate and the HTTP wrapper's overlapping two-second retry timers are different mechanisms. Check failure behavior before describing retries or caches.
- Native widgets use their own request code and older paths. Consider widget and app compatibility when changing contracts or shared preferences.

## Verification and documentation

- Choose checks that match the change. For behavior changes, cover the relevant regression and an additional functional check using isolated dependencies. For documentation, validate links, source claims and diagram artifacts without starting collection.
- `server/package.json` defines `npm test` (Mocha) and `npm run e2e`. Inspect the selected tests first: the legacy suite includes database and provider integrations. A missing dependency or credential means not run, not passed.
- Historical build/CI commands are not proof of current compatibility. Gulp tasks may replace configuration/resources and run Cordova operations; Travis contains an old deployment recipe. Read commands before executing them and distinguish local build authorization from deployment authorization.
- Keep credentials and private release configuration out of docs, logs and commits. Record environment variable names and prerequisites rather than secret values.
- When changing a route, collector, response, mode or storage contract, update the affected architecture document and Archify JSON. Regenerate HTML through the installed Archify skill and verify artifact, browser and visual results separately. Do not manually patch generated HTML.
- Report what changed, the checks actually executed, and material limitations. Do not claim a live provider call, mobile build, deployment, Claude execution or cross-provider review based only on source inspection or adapter presence.
