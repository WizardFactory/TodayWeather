# Evidence, limitations and navigation

Analysis baseline: `b9795125a1b7dc8a4f7602d4612a6be7d79413ad`. Method: static source inspection, local document/diagram validation and browser checks. No weather collectors, provider APIs, database migrations or deployment tasks were executed.

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

1. **Public gateway is absent.** The current client builds `/weather/v000903` and `/geocode/v000903` paths. Searches of server mounts, entrypoints and checked-in nginx configuration found no corresponding implementation. A public gateway is a required boundary inferred from the mismatch, not a discovered service.
2. **Production topology is unknown.** Mode names and an old Elastic Beanstalk recipe do not establish live worker counts, network isolation, credentials, CDN or environment names. Diagrams show logical code roles.
3. **Provider viability is unverified.** KMA, Dark Sky, WU and other URLs are historical source contracts. No claim about today's service support or migration target is made.
4. **The client configuration is a placeholder.** Release build tasks copy variant config from absent external files. No actual deployment base URL is inferred.
5. **Multiple generations coexist.** API versions reuse older modules; native widgets and bundled web assets use different contracts. `DB_DATA_VERSION` also affects domestic persistence and reads.
6. **Static findings are not reproduced incidents.** Overlapping retries, LIFO scheduling, non-modulo health-day hours and unconditional gather mounts are visible in code. Production incidence and severity were not measured.
7. **Existing product tests were not run.** Server dependencies are absent; the historical suite includes database/provider integration tests. This documentation task uses content, artifact, browser and instruction-evaluation checks instead.

## Investigation checklist for future operational work

Obtain the authorized public gateway contract and release configuration, identify process modes and database version, then use an isolated database and provider fixtures to verify domestic and world response compatibility. Validate yesterday/local-midnight/DST behavior, missing products, duplicate requests, latitude zero and unit settings. Review collection routes and startup side effects before running the server. This is follow-up guidance, not work performed in this analysis.
