# Shared agent instructions

This file is the canonical repository guidance for Codex and Claude Code. CLI-specific entrypoints must import or link here; do not duplicate common rules.

## Communication and preservation

- Communicate with AK in Korean. Use English as the primary language for repository content.
- Preserve existing user changes, instructions, skills and configuration. Inspect the working tree before editing and keep changes within the requested scope.
- When installing or updating a skill, maintain one canonical copy at `.agents/skills/<name>/` for repository scope or `~/.agents/skills/<name>/` for user scope. Link it into both Codex and Claude Code skill directories, configure required hooks for both, and verify discovery and execution in the intended scope before reporting completion.
- When available, read the shared user policy at `~/.agents/policies/sdlc.md` at task intake and follow its SDLC selection. If that path is absent, follow the installed SDLC skill’s normative policy. Simple questions do not require a development workflow. Do not copy user-level policy into this file.

## Read the architecture first

Use the [architecture index](docs/architecture/README.md), then the document relevant to the task:

- [Service overview](docs/architecture/service-overview.md): components, process modes, data stores, native variants and deployment evidence.
- [Weather collection](docs/architecture/weather-collection.md): timers, domestic ingestion, scrape jobs, DSF/AQI cache fills and failure behavior.
- [Mobile API flow](docs/architecture/mobile-api.md): app URL construction, middleware order, response conversion and native clients.
- [AWS/code correlation](docs/architecture/aws-code-correlation.md): timestamped AWS routing, deployed Lambda behavior and remaining host-level gaps.
- [Evidence and limitations](docs/architecture/evidence.md): source lookup map and missing external dependencies.
- [Service EC2 internals](docs/architecture/ec2-internals.md): observed nginx/PM2 topology, host configuration, database sockets and deployed-code differences.
- [EC2 SSH and AWS API access](docs/architecture/ec2-access.md): SSH key, repository AWS credentials, named account profile, verified CLI path and SDK fallback. Read this before concluding that AWS access is unavailable because `aws` is not on PATH or `~/.aws` is absent.

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

## server2 implementation placement

These rules govern server2 work. Ordinary maintenance of legacy behavior in `server/` remains allowed under its existing guidance and is not a server2 placement exception.

- For server2 work, all new assets equivalent to responsibilities or assets in `server/` belong under `server2/`: runtime entrypoints, routes/controllers, providers, response assembly, cache/storage, jobs, push/notice state, configuration/defaults, static data/templates, dependencies/build manifests, tests/fixtures, verification/migration tools, and deployment/operations scripts or service/container configuration. Rust workspace files, `Cargo.toml`, `Cargo.lock`, toolchain settings and server2-only build configuration also belong there. Equivalent responsibilities do not require copying unused APIs or the legacy directory layout.
- Do not place server2 implementation in `server/`, repository-root runtime/build files, shared `scripts/`, or another package. Do not import, include, symlink or read legacy source/data from the new runtime. Documented HTTP forwarding to legacy is allowed during coexistence; port required assets into `server2/` with provenance/license preserved.
- Maintained documentation stays under `docs/`; intent/spec/plan stays in its existing directories; agent rules stay in canonical `AGENTS.md`. Shared `.github/workflows/` entries may invoke server2 commands, but server2-specific logic/configuration belongs under `server2/`. Necessary shared infrastructure wiring is an explicit per-task exception, not a location for implementation.
- Before every server2 task, read the [placement contract](docs/architecture/server2.md#implementation-placement) and [common task contract](plans/issue-2614.md#common-contract-for-every-implementation-task). Declare intended paths and exact outside paths with reasons. Legacy exceptions are limited to a named recorder/export/coexistence change or separately authorized retirement; no new server2 business logic belongs there. Decide new exceptions before dependent edits, never retroactively to excuse misplaced files.
- Before completing a task, review added/modified/renamed paths, dependencies and external assets against the declaration. Fix unexplained violations before completion. The Rust foundation task must introduce the local/CI placement gate before later implementation tasks proceed; until then, record a manual review. This instruction does not claim the automatic gate exists or alter GitHub branch protections.

## Architecture constraints to preserve

- The app builds `/weather/v000903/...` and `/geocode/v000903/...`. The 2026-09-20 AWS/deployed-source evidence verifies CloudFront -> API Gateway -> Lambda; weather coordinates dispatch to EC2 KMA address or DSF coordinates. Gateway code is outside this checkout. Recheck current evidence before relying on that deployment mapping; the inspected service host uses a 5bca407 checkout with config/logger edits, service mode and DB version 2.0. Separate gather/Mongo internals remain unverified. Weather address Lambda is unsupported (501); unversioned weather defaults to v000901.
- The [2026-08-23 to 2026-09-22 UTC traffic window](docs/evidence/aws/api-traffic-2026-09-22.md) recorded 70.72% of product API requests on unversioned `/weather/coord/...`. The Lambda default `v000901` is a separate 2026-09-20 deployment observation, not per-request historical correlation. Android-like callers of this path remain unidentified; see [open questions](docs/architecture/evidence.md#traffic-and-log-access-follow-up).
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

## Artifact retention and commit preparation

- Follow [artifact retention](docs/development/artifact-retention.md). Keep maintained knowledge in docs, reusable verification tools in scripts/tests, and selected dated evidence in docs/evidence. Generated state and runs belong under ignored reports/, .planning/ or .archify/.
- Reconcile findings, preserve required evidence, and fix references before final verification and commit. Keep original local files when untracking; do not force-add generated reports. Preserve active verification inputs and diagram recovery metadata.
- Run `python3 scripts/check-artifact-policy.py --staged` on intended staged content. Before push, check the actual outgoing commits using the same checker; maintained links must work without local-only files. Checks and hooks do not delete, rewrite or stage content. Preserve all existing test/review gates.
- Shared-skill changes are separate from repository configuration; use the [upgrade guide](docs/development/skill-retention-upgrade.md), keep one canonical skill and verify both hosts before claiming execution.

<!-- graft:start -->
## Graft context graph

After reading the architecture index, use Graft to locate indexed code and trace
relationships. Treat parser edges as navigation aids; verify relevant source
before changing behavior. Follow the existing repository verification rules.

- `graft map`: directory and symbol overview.
- `graft ask "<question>" --source --in server`: ranked source locations.
- `graft grep "<literal>" --fixed`: all matches within indexed files.
- `graft skeleton <file>`: definitions and signatures.
- `graft callers <symbol> --depth 2`: incoming dependencies.
- `graft check`: graph freshness; `graft build`: refresh the local cache.

The focused graph covers server, shared client JavaScript/build scripts, web
source, packages, scripts and infrastructure. Native bundles, docs, config and
unsupported languages are not fully indexed: use `rg` and source inspection
there. See [Graft setup](docs/development/graft.md) for scope and rebuilding.
The canonical upstream skill is `.agents/skills/graft/SKILL.md`, linked into
both host skill directories. Repository guidance takes precedence over generic
skill advice. Keep generated `graft/` ignored.
<!-- graft:end -->
