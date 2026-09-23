# Rewrite decisions and open questions

Baseline: `ff7acf3996ccb66c912d2ed4710cf300197d6966`, inspected on 2026-09-23. No replacement framework, provider, database, public schema or rollout SLA is selected here. Suggested actions below are proposals. Existing defects should not become accidental requirements, and corrections should not be disguised as unchanged behavior.

## Evidence labels

- **Source observation:** directly traceable to checked-out code; it does not establish production frequency or user impact.
- **Isolated evidence:** a documented fixture/simulator reproduction with controlled dependencies; it does not prove production parity.
- **Deployment observation:** a separately timestamped host/AWS fact; recheck before relying on it for rollout.
- **Proposal/open decision:** future behavior or evidence still requiring implementation, verification or product/operations choice.

## Source anomalies requiring characterization

The following are source observations. Their end-to-end runtime impact was not reproduced in this documentation task. Each needs a failing characterization case before a production correction is implemented.

| ID | Observed behavior and evidence | Risk to investigate | Proposed decision and verification |
| --- | --- | --- | --- |
| A01 | `updateWeatherData()` submits using `geoInfo`, then applies the response with `WeatherInfo.updateCity(WeatherInfo.getCityIndex(), city)` inside the completion callback. [TabCtrl](../../client/www/js/controller.tabctrl.js) | A selection change while a request is outstanding may associate the response with the completion-time selection | Use stable city/request identity and define stale completion handling; reproduce switching/reordering/deletion in flight (V09) |
| A02 | `updateCity()` replaces `airInfo`, `airInfoList` and other fields only when the incoming field is truthy. Omitted air fields therefore leave prior stored values intact. [WeatherInfo](../../client/www/js/service.weatherinfo.js) | A weather refresh can retain old air information without explicit new-response provenance; an empty array is truthy and differs from omission | Define whether missing data means preserve, clear or mark stale; test both omitted and empty payloads (V10) |
| A03 | `convertWeatherData()` logs response `units`, selects a parser and copies `name`, `address`, `country`, `location`; it does not copy `units` into the normalized city result. [WeatherUtil](../../client/www/js/service.weatherutil.js) | Normalized values do not carry that response-level units object; settings changed during a request need explicit interpretation | Retain unit provenance or convert into a well-defined canonical model; test preference changes and response-unit mismatch (V05/V10) |
| A04 | In `ControllerTown24h._convertWeatherData()`, the non-default precipitation branch calls `convertUnits(default precipitation unit, toWindUnit, value)` even though `toPrecipUnit` controls entry. [Town24h](../../server/controllers/controllerTown24h.js) | Requested precipitation units and returned numeric values may disagree; exact output depends on converter handling and request settings | Reproduce non-default precipitation with independently varied wind units before correcting the target argument (V05) |
| A05 | Coordinate branch selection uses `geoInfo.location.lat` truthiness; stored-city location repair uses a similar check. [WeatherUtil](../../client/www/js/service.weatherutil.js), [WeatherInfo](../../client/www/js/service.weatherinfo.js) | Latitude zero does not take the normal coordinate path | Replace truthiness with explicit coordinate validity as an intentional behavior change (V06) |
| A06 | `_retryGetHttp()` schedules another attempt after two seconds while the prior request may still run. `_getHttp()` settles on the first callback; it does not cancel other in-flight requests. [WeatherUtil](../../client/www/js/service.weatherutil.js) | Slow calls overlap and an early error can settle the shared promise before another request succeeds | Choose bounded retry/cancellation semantics explicitly; use controlled timers and response ordering (V08) |

Anomaly IDs describe evidence, not approved fixes. A replacement can preserve a compatibility adapter while correcting its internal model, provided the behavior change and affected consumers are documented.

## Compatibility and operational decisions

All rows remain open; suggested owners are roles to assign, not named commitments.

| ID | Current evidence | Decision needed / proposed direction | Suggested owner |
| --- | --- | --- | --- |
| D01 | KMA middleware documents order dependencies; multiple publication times and missing products coexist. [Router](../../server/routes/v000903/route.kma.v000903.js), [Town reads](../../server/controllers/controllerTown.js) | Preserve meaning and precedence; decide freshness/partial-data semantics before simplifying merges | Backend + product |
| D02 | Only exact `source === 'KMA'` selects the KMA parser; other values take the world parser. [WeatherUtil](../../client/www/js/service.weatherutil.js) | Define supported discriminators, validation and compatibility treatment for malformed/unknown bodies | API + client |
| D03 | Default shared Express error handlers render Jade/HTML; other routes send their own bodies/statuses. [App](../../server/app.js) | Introduce a versioned or adapted JSON error contract if desired; characterize current consumers first | API |
| D04 | Ten-minute city memory gate, overlapping HTTP timers, provider caches and CDN caching are different layers. [WeatherInfo](../../client/www/js/service.weatherinfo.js), [mobile API](../architecture/mobile-api.md) | Define freshness and stale display per layer; no single inherited TTL represents all of them | Product + API + client |
| D05 | Initial FCM callback can submit an absent old token; `_updateFcmToken()` changes memory state without awaiting HTTP success. Server requires a truthy token pair. [Push client](../../client/www/js/service.push.js), [route](../../server/routes/v000705/routePushNotification.js) | Separate first registration from replacement; define persistence, retry and failure reconciliation | Client + push |
| D06 | Push deletion narrows by city/id only when truthy. Alarm and alert implementations can omit a zero-valued identifier from the query. [Alarm](../../server/controllers/controllerPush.js), [alert](../../server/controllers/alert.push.controller.js) | Define zero identifiers explicitly and test deletion scope with isolated records | Push |
| D07 | Batch push handlers log per-item persistence errors and call back without those errors. [Batch route](../../server/routes/v000902/route.push.update.list.js) | Define per-item success/failure and client reconciliation; HTTP 200 must not be the only acceptance evidence | API + push |
| D08 | `SERVER_MODE=local` is default, starts gathering/scraping, and mode does not restrict route mounts. App import connects Mongo. [Config](../../server/config/config.js), [app](../../server/app.js) | Decide explicit process entrypoints and route ownership; make test/runtime startup side effects deliberate | Backend + operations |
| D09 | Old/new domestic storage coexist; clients persist local and native shared state. [Town](../../server/controllers/controllerTown.js), [storage](../../client/www/js/service.storage.js) | Define migration, rollback compatibility and retention before replacing persistence | Backend + client + operations |
| D10 | Gulp resets platforms and overwrites product configuration, resources and purchase controller selection. [Gulp](../../client/gulpfile.js) | Make replacement builds reproducible with explicit variant inputs and isolated outputs | Mobile build |

The [push investigation](../architecture/push-notifications.md) includes separate historical isolated checks and deployment observations. Those are not newly reproduced by this task and do not prove the cause of every logged production failure.

## Missing evidence before release decisions

| Question | Known evidence / boundary | Evidence to obtain |
| --- | --- | --- |
| Which shipped callers must remain compatible? | Shared app uses versioned paths; widgets include older/unversioned paths; Android-like callers of the unversioned path remain unidentified. [Traffic report](../../reports/aws/api-traffic-2026-09-22.md), [limitations](../architecture/evidence.md) | Released binary/configuration inventory, client/version attribution and route deprecation criteria |
| Where is the public gateway/geocoder implementation? | Deployed Lambda source was inspected separately; it is outside this checkout. [AWS correlation](../architecture/aws-code-correlation.md) | Maintainable source, configuration, routing/cache policy and an owned deployment path |
| What is the actual release configuration? | Checked-in [client config](../../client/www/client.config.js) is a placeholder; Gulp refers to external variant files | Per-product API host, application identifiers, entitlement/plugin settings and secret prerequisites without exposing secret values |
| Which providers and products can the replacement use? | Checked-in provider URLs and schemas are historical; no current provider call was made for this reference | Current supported products, credentials, licensing, limits, coverage, error semantics and migration mapping |
| What runs collection, persistence and push today? | Service EC2 was inspected; separate gather/Mongo/push host internals and delivery are not fully established. [EC2 internals](../architecture/ec2-internals.md) | Active workers/modes, DB formats/indexes/volume, retention, backups, recovery and scheduler topology |
| Which platform experiences are mandatory? | TodayWeather/TodayAir share web source, with native widget/watch and build differences | Supported OS/device list, widgets/watch scope, accessibility/localization goals and purchase/ad obligations |
| What counts as a successful cutover? | No numerical acceptance thresholds are established by source | Owners and targets for semantic differences, freshness, latency, availability, data retention, rollout and rollback |
| What privacy/security behavior is required? | Location, device tokens, receipts and release configuration cross multiple boundaries | Retention/access/logging policy, secret management, authentication/rate limits and exposure review scoped to actual deployment |

These questions are prerequisites for selected implementation/release decisions, not reasons to stop offline characterization and UI work. Reuse the [verification matrix](verification-matrix.md) to make progress with controlled inputs while external evidence is gathered.

## Recording a resolved decision

For each resolved item, add: owner/date, evidence/reproduction, chosen behavior, alternatives and reason, affected API/client/storage versions, migration/rollback plan, and verification IDs/results. Keep the source observation intact and mark it superseded only when the implementation baseline changes. Do not mark an item resolved merely because a new framework or provider was selected.
