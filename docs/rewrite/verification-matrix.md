# Rewrite verification matrix

Baseline: `ff7acf3996ccb66c912d2ed4710cf300197d6966`, 2026-09-23. These are proposed acceptance cases for a rewrite. Source inspection and the saved simulator screenshots are existing evidence; the behavioral tests below have not been executed as part of this documentation task. Use the [playbook](rewrite-playbook.md) for staging and the [decision register](decisions-and-open-questions.md) for intentional changes.

## Test layers and evidence

| Layer | Controlled inputs | Required evidence |
| --- | --- | --- |
| Contract/transform | Fixed request, raw product fixtures, clock/timezone, units/language | Exact legacy and replacement outputs; differences explained by field and stage |
| State/interaction | Stubbed HTTP, storage, native bridge and timers | Ordered events, selected city identity, persisted values, visible result and failure handling |
| Rendering | Known normalized data and documented viewport/native host | Screenshot plus route, product, fixture, revision, device/OS, safe-area mode and capture time |
| Isolated integration | Disposable database, fake providers, explicit server mode | HTTP status/body/headers, writes, request count, cache/fallback outcomes and structured logs |
| Release/runtime | Approved release configuration and scoped operational checks | Actual native/plugin and deployment results; never inferred from fixtures or source inspection |

## Minimum behavior matrix

| ID | Area and cases | Expected comparison or decision | Source starting points |
| --- | --- | --- | --- |
| V01 | Domestic complete data; absent short/shortest/current/medium product; delayed station observation; conflicting precipitation inputs | Preserve ordered source precedence, field presence, extrema, icons and final summaries; define any changed fallback | [KMA pipeline](../../server/routes/v000903/route.kma.v000903.js), [Town24h](../../server/controllers/controllerTown24h.js) |
| V02 | Equivalent domestic data in DB 1.0 and 2.0; unmapped region/grid; missing station relationship | Compare query/normalization results; prove supported storage migration or explicitly retire a format | [Town reads](../../server/controllers/controllerTown.js), [config](../../server/config/config.js) |
| V03 | World cache hit/miss/stale record; historical-day gap; DSF failure; missing or failed AQI | Verify provider-call count, cache writes, error/partial response behavior, sort order and freshness independently | [World router](../../server/routes/v000902/route.dsf.coord.v000902.js), [DSF controller](../../server/controllers/worldWeather/dsf.controller.js), [world controller](../../server/controllers/worldWeather/controllerWorldWeather.js) |
| V04 | `0000`/`2400`, local midnight, month/year change, leap day, offset/DST examples, sunrise/sunset boundary | Correct local date, yesterday comparison, day/night icon and record selection; define treatment of historical offset limitations | [KMA time](../../server/lib/kmaTimeLib.js), [Town24h](../../server/controllers/controllerTown24h.js), [world controller](../../server/controllers/worldWeather/controllerWorldWeather.js) |
| V05 | All supported temperature/wind/pressure/distance/precipitation and air standards; zero, omitted, `null`, sentinel and string values | Values, labels and response `units` agree; avoid double conversion; reproduce and resolve precipitation-target anomaly A04 | [Unit converter](../../server/lib/unitConverter.js), [Town24h conversion](../../server/controllers/controllerTown24h.js), [world units](../../server/controllers/worldWeather/controller.ww.units.js) |
| V06 | Latitude/longitude zero, valid negative coordinates, swapped axes, invalid ranges; stored address-only city | Route selection, validation and coordinate order are explicit; characterize current truthiness behavior before correction | [WeatherUtil](../../client/www/js/service.weatherutil.js), [WeatherInfo](../../client/www/js/service.weatherinfo.js) |
| V07 | KMA/world response; unknown `source`; missing body/arrays; auxiliary warning/nation data; HTML error body | Fail predictably or preserve documented fallback; do not parse arbitrary non-KMA data as valid weather by accident | [WeatherUtil](../../client/www/js/service.weatherutil.js), [server errors](../../server/app.js) |
| V08 | Immediate HTTP error; slow success; requests completing out of order; timeout; manual refresh; memory state just inside/outside ten minutes | Count requests and promise settlement; distinguish legacy overlap from proposed retry/cancellation policy; retain deliberate failure UX | [Retry wrapper](../../client/www/js/service.weatherutil.js), [refresh gate](../../client/www/js/service.weatherinfo.js), [TabCtrl](../../client/www/js/controller.tabctrl.js) |
| V09 | Start a request for city A, select B before completion, delete/reorder a city in flight, change units while loading | Response is associated with a stable intended city/request; reproduce completion-time-index anomaly A01 and approve changed semantics | [TabCtrl updateWeatherData](../../client/www/js/controller.tabctrl.js), [WeatherInfo updateCity](../../client/www/js/service.weatherinfo.js) |
| V10 | Existing air data followed by an otherwise successful response without air fields; empty versus missing lists; response units differ from active preference | Decide stale retention/clearing and per-response unit provenance; document anomalies A02/A03 rather than silently carrying them forward | [WeatherInfo updateCity](../../client/www/js/service.weatherinfo.js), [WeatherUtil convertWeatherData](../../client/www/js/service.weatherutil.js) |
| V11 | Fresh install; current stored data; legacy keys; malformed JSON; empty localStorage with native preferences; restart after migration | Preserve cities, selected city, units, settings and paid state; migration is deterministic; shared widget preferences remain usable | [Storage](../../client/www/js/service.storage.js), [WeatherInfo](../../client/www/js/service.weatherinfo.js), [widgets](../../tw.ios/widget/TodayViewController.m) |
| V12 | Main/hourly/daily/air/nation/warnings/menu/settings/location/notification screens; compact and large phones; Korean/English; long/empty labels | No missing assets, clipped controls, safe-area overlap or unintended document overflow; intentional chart scrolling works | [Templates](../../client/www/templates), [styles](../../client/scss), [TabCtrl](../../client/www/js/controller.tabctrl.js) |
| V13 | Permission denied, device location disabled, missing plugin, app resume, widget launch, purchase restore | Explicit fallback and state transitions; full native build checks supplement fixture screenshots | [App lifecycle](../../client/www/js/app.js), [TabCtrl](../../client/www/js/controller.tabctrl.js), [purchase variants](../../client/gulpfile.js) |
| V14 | First token, token rotation success/failure, missing old token, duplicate callback, settings save and restart | Distinguish registration from replacement; persistence/retry semantics survive failure; no raw token evidence in reports | [Push service](../../client/www/js/service.push.js), [push route](../../server/routes/v000705/routePushNotification.js) |
| V15 | Batch persistence partly fails; remove cityIndex/id zero; overnight alert window; weekday/offset; external send fails | Evaluate item persistence, HTTP result, scheduling, provider submission and displayed notification separately | [Batch route](../../server/routes/v000902/route.push.update.list.js), [alarm worker](../../server/controllers/controllerPush.js), [alert worker](../../server/controllers/alert.push.controller.js) |
| V16 | Each process mode; duplicate worker start; provider/database failure; interrupted collector; stale dataset; recovery and rollback | No unintended collectors or duplicated side effects; trace cause/action/result and freshness; rehearse compatibility after rollback | [Startup](../../server/app.js), [manager](../../server/controllers/controllerManager.js), [configuration](../../server/config/config.js) |

## Use historical tests carefully

[server/package.json](../../server/package.json) exposes Mocha and e2e commands. The suite mixes pure functions, controller fixtures, database work and provider/remote calls. Audit each selected file before running it; a directory name containing `unit` or `local` is not proof of isolation.

| Existing file | Useful starting point | Limitation observed in source |
| --- | --- | --- |
| [test.controller.town24h.js](../../server/test/test.controller.town24h.js) | Historical weather/air fixtures and icon/conversion cases | Global manager/logger setup and historical assumptions need review before reuse |
| [test.controller.ww.units.js](../../server/test/test.controller.ww.units.js) | Current/hourly/daily world field examples and unit assertions | Narrow examples do not cover all units, missing values or cross-day cases |
| [testKmaTimeLib.js](../../server/test/testKmaTimeLib.js) | Boundary concepts such as `2400` versus next-day `0000` | Several calls use `assert(actual, expected, ...)`; truthy actual values do not establish equality |
| [testCoordinate2xy.js](../../server/test/testCoordinate2xy.js) | Historical intended coordinate test shape | No active `it` case remains; test body is commented out |
| [e2e/testGetAllTown.js](../../server/test/e2e/testGetAllTown.js) | Region traversal and expected top-level fields | Uses a historical remote hostname; field-presence checks do not establish numeric/semantic parity |

Do not report an existing test as passed based on inspection. Fix or replace weak assertions before treating them as a migration gate. Prefer behavior assertions over tests that simply repeat implementation structure.

## Acceptance record template

For each executed case, record: case ID; revision; fixture/hash; clock and timezone; product/platform; requested units/language; old/new status and output; observed difference; linked decision if intentional; screenshots/logs; result; remaining limitation. For runtime checks, add deployed revision and observation time.

A rewrite milestone passes only when its relevant cases have executed and unexplained differences have owners or are resolved. Source anomalies in the decision register remain unverified runtime scenarios until reproduced. Product and operations owners still need to define performance, freshness, accessibility and rollout thresholds; this document supplies no invented numerical targets.
