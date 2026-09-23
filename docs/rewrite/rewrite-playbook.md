# Server and client rewrite playbook

Source baseline: `ff7acf3996ccb66c912d2ed4710cf300197d6966`, inspected on 2026-09-23. This document proposes a migration process; it does not select a framework, database, weather provider or deployment platform. Existing behavior is described separately from proposed changes in the [decision register](decisions-and-open-questions.md). The [verification matrix](verification-matrix.md) defines follow-up checks, not tests already passed.

## What must survive the rewrite

The system is more than a weather endpoint and two forecast screens. It includes TodayWeather and TodayAir, country/weather-warning views, location and unit preferences, push settings and workers, purchase variants, and native widget/watch consumers. The shared app requests v000903, while native consumers and deployed public defaults include older contracts. The [30-day traffic report](../../reports/aws/api-traffic-2026-09-22.md) observed 70.72% of product requests on unversioned weather coordinates; it did not identify every caller. Retiring old routes requires release and traffic evidence, not source-version assumptions.

| Boundary | Existing constraint to characterize | Source |
| --- | --- | --- |
| Public API and backend | Public `/weather/...` and `/geocode/...` paths depend on external Lambda/gateway behavior; Express mounts alone do not implement them | [Mobile API](../architecture/mobile-api.md), [gateway correlation](../architecture/aws-code-correlation.md) |
| Domestic composition | Current depends on short/shortest; icons precede unit conversion; descriptions and final summary follow conversion | [KMA router](../../server/routes/v000903/route.kma.v000903.js), `routerList` |
| Data identity | App coordinates are `{lat,long}`; Mongo geospatial arrays are `[longitude,latitude]`; products use different grid/station/region keys | [WeatherUtil](../../client/www/js/service.weatherutil.js), [Town controller](../../server/controllers/controllerTown.js), [DSF model](../../server/models/worldWeather/dsf.model.js) |
| Time and validity | Publication time, retrieval time, local day, yesterday and `0000`/`2400` are distinct; missing values use field-specific sentinels | [Town controller](../../server/controllers/controllerTown.js), [Town24h](../../server/controllers/controllerTown24h.js), [KMA time library](../../server/lib/kmaTimeLib.js) |
| Storage generations | `DB_DATA_VERSION` selects supported domestic read/write formats; default configuration and observed deployed configuration differ | [Config](../../server/config/config.js), [service-host evidence](../architecture/ec2-internals.md) |
| Client state and native sharing | LocalStorage, app preferences, legacy key migration and widget sharing form one migration surface | [Storage service](../../client/www/js/service.storage.js), [weather widget](../../tw.ios/widget/TodayViewController.m), [air widget](../../ta.ios/widget/TodayViewController.m) |
| Product/platform builds | Build tasks select different configuration, resources and purchase controller/plugin combinations | [Gulp tasks](../../client/gulpfile.js), [client package](../../client/package.json) |
| Side effects | Collection, scraping and push run independently of weather rendering; a successful settings response is not proof of delivery | [Server startup](../../server/app.js), [push flow](../architecture/push-notifications.md) |

Preserve observable contracts until an explicit decision changes them. This does not require reproducing source anomalies indefinitely. Record intentional corrections, affected clients and regression cases in the decision register.

## Suggested sequence and completion gates

| Stage | Proposed work | Evidence required before advancing |
| --- | --- | --- |
| 0. Freeze evidence | Pin source, screen captures, fixture inputs, raw responses, normalized client objects and operation inventory | Each artifact identifies revision, input, product, environment and evidence type; absent native/live coverage is visible |
| 1. Characterize behavior | Add deterministic tests around old parsers, composition functions and state transitions; include partial data and known anomalies | Fixtures produce explicit expected values and field presence; clock, network, storage and native dependencies are controlled |
| 2. Isolate boundaries | Introduce testable adapters for provider access, persistence, geocoding, clock, localization and native bridges | The read path runs against fixtures without production DB access, provider egress or background collection |
| 3. Rebuild weather reads | Implement ordered domestic composition and world cache/fill behavior; adapt any new internal representation to supported public contracts | Old/new outputs agree on required semantics, or each difference maps to an approved decision; KMA and world paths both pass |
| 4. Rebuild client and migrate state | Implement screens against captured contracts; migrate cities, units, settings, paid state and shared preferences | Screenshot and interaction checks pass; fresh install, upgrade, restart, resume, missing data and denied location are covered |
| 5. Rebuild collection and side effects | Move collectors, cache fills, scheduling, push and purchase functions in separately reversible increments | Duplicate execution, retry, partial failure, idempotency and recovery are verified with isolated dependencies |
| 6. Replace gradually | Compare read-only shadow outputs, then route a defined cohort to the replacement; retain a compatible fallback | Release owners set and measure mismatch, freshness, error and latency gates; rollback is rehearsed with data compatibility intact |

Stages can overlap after their shared contracts are stable. Keep API, client presentation, storage migration and provider replacement separable enough that a mismatch has a traceable cause. Do not combine a new provider's semantics with a new UI and a new public response schema in one unmeasured cutover.

Shadowing is a proposed technique, not the current deployment model. Mirror reads only when the replacement cannot trigger uncontrolled provider fills or writes. Do not duplicate notification delivery, receipt validation side effects or collector writes without a dedicated isolation strategy.

## How to construct a useful comparison baseline

For each case, retain the request, requested units/language, clock/timezone, product publication times, raw product records, legacy assembled response, normalized client model and final screen. This allows a mismatch to be traced through provider input → server merge → wire representation → client parsing → presentation.

Compare numeric values with explicit, field-specific rounding rules. Compare absence separately from `null`, zero, empty collections and invalid sentinels. Do not ignore every timestamp or textual summary: those values carry freshness, day grouping and localization semantics. If a new schema is proposed, document how a compatibility adapter preserves old clients before changing the wire representation.

The simulator images in this documentation establish rendering with synthetic fixture data. They do not establish complete Cordova behavior, provider availability, live API compatibility, notification delivery or purchase handling. Keep raw API examples and screenshot fixtures labeled separately so a convenient display fixture does not become an accidental API specification.

## Build and test isolation

[Server startup](../../server/app.js) connects Mongo during import. [Configuration](../../server/config/config.js) defaults `SERVER_MODE` to `local`, which starts both gathering and scraping. Characterization tests should load isolated functions/adapters where practical. If an application instance is necessary, use an explicit non-collecting mode, isolated database and controlled outbound dependencies; `service` mode alone does not disable database access or all mounted routes. `/gather/*` must not be used as a health probe.

The existing [Gulp tasks](../../client/gulpfile.js) reset platform state and overwrite configuration/resources and purchase controller selection. A proposed replacement build should make product/platform inputs explicit and write to isolated outputs. Preserve private release configuration outside source-controlled documentation. Reproducing a local web render is a different milestone from a signed native build or deployable release.

## Operational evidence and rollback

Before rollout, obtain current gateway/geocoder code, deployed configuration, active client versions, provider constraints and database evidence. The [architecture evidence index](../architecture/evidence.md) and [EC2 access reference](../architecture/ec2-access.md) identify known boundaries; their AWS observations are timestamped and must be rechecked when operational decisions depend on them.

Proposed observability should correlate request, product source, publication time, cache outcome, merge/fallback stage and response result without logging raw tokens or private location payloads. Collection and push need separate correlation for scheduled work and external submission. Measure provider acceptance and actual device delivery separately.

Rollback design must identify which service version can read newly written records, whether client preference migrations are reversible, and how background jobs avoid duplicate execution during transition. No numerical SLA, acceptable mismatch rate, retention period or rollout percentage has been decided by this document.
