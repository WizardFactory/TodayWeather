# Evidence, limitations and navigation

Analysis baseline: `b9795125a1b7dc8a4f7602d4612a6be7d79413ad`. Method: static repository inspection, authorized read-only AWS configuration/metrics/log queries, downloaded Lambda source analysis, authorized service-host SSH/process/socket/configuration inspection, local document/diagram validation and browser checks. No weather collectors, provider APIs, database migrations or deployment tasks were executed.

## Source index

| Question | Authoritative local source and lookup |
| --- | --- |
| Which processes start? | [app.js](../../server/app.js): `config.mode`; [bin/www](../../server/bin/www): listener and gather timeout |
| Where do values come from? | [config.js](../../server/config/config.js): `SERVER_MODE`, `DB_DATA_VERSION`, `API_SERVER`, `SERVICE_SERVER` |
| Which routes are mounted? | [app.js](../../server/app.js); [v000903/index.js](../../server/routes/v000903/index.js) |
| When is domestic weather gathered? | [controllerManager.js](../../server/controllers/controllerManager.js): `checkTimeAndRequestTask`, `startManager`, `startScrape`, `task` |
| How do schedules reach handlers? | [routeGather.js](../../server/routes/v000001/routeGather.js); Manager `_requestApi` |
| How are KMA products fetched? | [collectTownForecast.js](../../server/lib/collectTownForecast.js): `DATA_URL`, `requestData`, `getData`; Manager `_recursiveRequestData` |
| Which storage format is active? | Manager `getSaveFunc`; [controllerTown.js](../../server/controllers/controllerTown.js): `getAllDataFromDb`; [KMA models](../../server/models/kma) |
| How is a domestic response assembled? | [route.kma.v000903.js](../../server/routes/v000903/route.kma.v000903.js): `routerList`; [controllerTown24h.js](../../server/controllers/controllerTown24h.js) |
| Is world weather collected at request time? | [controllerWorldWeather.js](../../server/controllers/worldWeather/controllerWorldWeather.js): `queryTwoDaysWeatherNewForm`, `_getWaqiFromAll`; [dsf.controller.js](../../server/controllers/worldWeather/dsf.controller.js): `getDsfData` |
| How does DSF cache work? | `dsf.controller.js`: `_findDataFromDB`, `_requestDatas`, `_saveData`, `maintainDB`; [DSF model](../../server/models/worldWeather/dsf.model.js) |
| Which historical collectors remain? | [controllerCollector.js](../../server/controllers/worldWeather/controllerCollector.js): `doCollect`, `runTask`; [controllerRequester.js](../../server/controllers/worldWeather/controllerRequester.js) |
| What does the app request? | [service.weatherutil.js](../../client/www/js/service.weatherutil.js): URL builders, `getWeatherByGeoInfo`, `_retryGetHttp` |
| When does the app refresh? | [service.weatherinfo.js](../../client/www/js/service.weatherinfo.js): `canLoadCity`; [controller.tabctrl.js](../../client/www/js/controller.tabctrl.js): `loadWeatherData` |
| How are responses normalized? | WeatherUtil `convertWeatherData`, `_parseKmaWeather`, `_parseWorldWeather` |
| How do native clients differ? | [TodayWeather widget](../../tw.ios/widget/TodayViewController.m), [TodayAir widget](../../ta.ios/widget/TodayViewController.m), [storage](../../client/www/js/service.storage.js) |
| What is known about deployment? | [.travis.yml](../../.travis.yml), [nginx CORS recipe](../../server/.ebextensions/01_add_cors.config), [gulpfile](../../client/gulpfile.js) |

## Important limitations

1. **Gateway source is outside this checkout.** AWS routing and downloaded Lambda business logic now connect the public paths to DynamoDB geocoding and the service EC2 hostname. See [AWS/code correlation](aws-code-correlation.md), [timestamped evidence](aws-readonly-evidence-2026-09-20.json) and [business excerpts](deployed-lambda-excerpts.md).
2. **Service host is now inspected; other hosts remain limited.** [EC2 internals](ec2-internals.md) and [host evidence](ec2-readonly-evidence-2026-09-20.json) record nginx, PM2 cluster workers, resolved service/DB v2.0 settings, deployed checkout and observed TCP to the configured Mongo target. No Mongo query or separate gather/Mongo host inspection occurred. Source and runtime claims remain separately identified.
3. **Provider viability is unverified.** KMA, Dark Sky, WU and other URLs are historical source contracts. No claim about today's service support or migration target is made.
4. **The client configuration is a placeholder.** Release build tasks copy variant config from absent external files. No actual deployment base URL is inferred.
5. **Multiple generations coexist.** API versions reuse older modules; native widgets and bundled web assets use different contracts. `DB_DATA_VERSION` also affects domestic persistence and reads.
6. **Static findings are not reproduced incidents.** Overlapping retries, LIFO scheduling, non-modulo health-day hours and unconditional gather mounts are visible in code. Production incidence and severity were not measured.
7. **Existing product tests were not run.** Server dependencies are absent; the historical suite includes database/provider integration tests. This documentation task uses content, artifact, browser and instruction-evaluation checks instead.

## Traffic and log access follow-up

The [30-day traffic report](../../reports/aws/api-traffic-2026-09-22.md) and [aggregate evidence](../../reports/aws/api-traffic-2026-09-22-evidence.json) cover 2026-08-23 19:53:45 UTC through 2026-09-22 19:53:45 UTC. They supplement the September 20 architecture snapshot rather than replacing its observation date.

- **Unidentified Android-like callers:** 38,069 of 155,998 unversioned `/weather/coord/{location}` requests had Android-like user agents. The explicit unversioned builders found in this checkout are the [TodayWeather iOS widget](../../tw.ios/widget/TodayViewController.m) and [TodayAir iOS widget](../../ta.ios/widget/TodayViewController.m); the shared app builds versioned paths. One unverified candidate is the external Android home-screen widget plugins (`cordova-plugin-todayweather-android-widget` and `cordova-plugin-todayair-android-widget`) listed in the TodayWeather and TodayAir Cordova package files. Their source is not in this checkout and their request paths are unknown, so they are a lead to check, not an attribution ([native consumers](../rewrite/native-consumers-and-plugins.md#1-consumer-inventory)). An older released client, missing source or different build configuration could explain the discrepancy. User-agent classification alone establishes neither app identity nor which explanation is correct. Obtain release/build evidence before assigning these requests to an Android implementation.
- **Unversioned traffic matters:** this path accounts for 70.72% of product API requests in that window. The inspected Lambda default was `v000901` on September 20; historical requests were not individually correlated to backend versions.
- **S3 privacy assurance remains partial:** read-only checks on **2026-09-23 08:04 UTC** found no bucket or account Public Access Block configuration, no bucket policy, and no public-group grants in the bucket ACL. Anonymous listing was denied (403). One log object from each of August 23, September 22 and September 23 had no public-group ACL grants and denied anonymous HEAD (403). No public exposure was observed in these checks, but three objects do not establish the privacy of every object or alternate access path. See [sanitized access evidence](../../reports/sdlc/pr2552-review-assessment/s3-public-access.json). Full assurance and any hardening remain follow-up work; no AWS setting was changed. Preserve CloudFront log delivery when assessing changes to ACL or ownership settings.

See [push behavior and follow-up constraints](push-notifications.md#token-refresh-and-the-403-branch) before investigating token failures. The [review assessment](../../reports/sdlc/pr2552-review-assessment/investigation.md) separates confirmed source behavior from unproven production causes.

## Investigation checklist for future operational work

Use the verified gateway mapping and obtain release configuration, process modes and database version, then use an isolated database and provider fixtures to verify domestic and world response compatibility. Validate yesterday/local-midnight/DST behavior, missing products, duplicate requests, latitude zero and unit settings. Review collection routes and startup side effects before running the server. This is follow-up guidance, not work performed in this analysis.
