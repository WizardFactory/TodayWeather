# Legacy, inactive and research-only integrations

[Manual index](README.md) · [Inventory](inventory.json)

These entries prevent a URL search from being mistaken for evidence of current default acquisition. Some older routes and native bundles still have actual invokers; others stop before network, are test/utility-only, or are proposals. Status is source-bound to `82f7a4838dda046be966ee9c25c9cb66561d099d`, reviewed 2026-10-24. No old service's present availability was tested.

## Still-wired older weather routes

| ID / operation | Request / response subset | Status and implementation evidence |
| --- | --- | --- |
| WAQI-OBS-UNDOCUMENTED **GET** `https://api.waqi.info/api/feed/@{stationIndex}/obs.en.json` | No token; JSON `rxs` envelope for station history. Legacy catalog bounds two seconds, up to three attempts. | Older `/ww` two-day flow refreshes station values older than 60min; [caller/requester](../../../server/controllers/worldWeather/controllerAqi.js#L291). **Undocumented**; no normative public spec retrieved. Modern shared-chain path differs. |
| GLOBAL-WAQI, older implementation of same geo endpoint | `token`, `status/data` feed; old 3s HTTP/forced `TLSv1_method`, up to five transport retries; `status=nug` branch lacks remaining-count guard | [Old requester](../../../server/lib/AQI/aqiRequester.js#L63), [controller](../../../server/controllers/worldWeather/controllerAqi.js#L389). A variant of [current operation](weather-air-life.md#current-global-air-providers), not another operation ID. |
| OLD-WU-CURRENT **GET** `http://api.weatherunlocked.com/api/current/{lat},{lon}` | `app_id,app_key` from `WU_SECRET_ID,WU_SECRET_KEY`; current-weather JSON | Legacy `/req` add-location path; [requester](../../../server/lib/WU/wuRequester.js#L18), five seconds/no retry |
| OLD-WU-FORECAST **GET** `http://api.weatherunlocked.com/api/forecast/{lat},{lon}` | Same credentials; forecast JSON | Same older route; [requester](../../../server/lib/WU/wuRequester.js#L41), five seconds/no retry |

Weather Unlocked fields/availability are source-only in this review; its official present specification was not retrieved. These paths are not the current Visual Crossing default.

## Historical native services

Tracked `applewatch/www`, `tw.ios/` and `ta.ios/` copies differ from shared `client/www`. These are confirmed old-bundle invokers, not a claim about the currently distributed binary. TodayAir is retired. Vendor SDK methods without an app invoker are not counted.

| ID / request | Actual native caller / contract | Limits / status |
| --- | --- | --- |
| GEO-GOOGLE-FORWARD / REVERSE variants | [applewatch geocoder](../../../applewatch/www/js/services.js#L992) sends Google JSON `address` or `latlng`, **no appended key**. Only its reverse builder adds `sensor=true,language=ko`. Search/current-location controllers invoke them. Widget [forward helper](../../../tw.ios/widget/TodayViewController.m#L1340) uses Google JSON without the key/sensor/language additions. | Same provider operations as [geography](geography-media.md), historical auth/error policy, no app HTTP timeout established. Reverse helper presence in widgets alone does not establish its invoker. |
| NATIVE-IONIC-KEY **GET** `https://apps.ionic.io/api/v1/app/{app_id}/keys/write` | `$ionicAnalytics.register()` [app invoker](../../../applewatch/www/js/app.js#L19); [SDK](../../../applewatch/www/lib/ionic-platform-web-client/src/analytics/analytics.js#L113). Basic auth from SDK `app_id/api_key`, returns analytics write key. | Historical Ionic Analytics; present official service docs not retrieved. |
| NATIVE-IONIC-EVENT **POST** `https://analytics.ionic.io/api/v1/events/{app_id}` | [SDK dispatch](../../../applewatch/www/lib/ionic-platform-web-client/src/analytics/analytics.js#L126) uses write key and queued Load/Tap/State Change events | Queue retained until successful send and network availability. SDK 2xx/3xx success handling; no app-specific HTTP timeout. |
| NATIVE-IONIC-IDENTIFY **POST** `https://apps.ionic.io/api/v1/app/{app_id}/users/identify` | [Controller](../../../applewatch/www/js/controllers.js#L377) creates anonymous ID/current user and calls save; [SDK](../../../applewatch/www/lib/ionic-platform-web-client/src/core/user.js#L385) selects POST for fresh user | JSON API-formatted user body. No explicit auth header in this save request; do not invent one. |
| NATIVE-IONIC-SAVE **PUT** `https://apps.ionic.io/api/v1/app/{app_id}/users/{id}` | Same save invoker, existing-user branch | Same historical SDK; load/delete/addToken helpers are not established app calls. |
| NATIVE-IONIC-DEPLOY **POST** `https://apps.ionic.io/api/v1/apps/{app_id}/updates/check/` | [Controller](../../../applewatch/www/js/controllers.js#L372), [native plugin](../../../applewatch/TodayWeather/Plugins/ionic-plugin-deploy/IonicDeploy.m#L351): `device_app_version,device_deploy_uuid,device_platform,channel_tag` | `update` result; download/update only when update exists and user accepts. Local `deploy.info()` is not an extra HTTP metadata operation. |
| NATIVE-IONIC-DOWNLOAD **GET** returned update URL | [Native download](../../../applewatch/TodayWeather/Plugins/ionic-plugin-deploy/IonicDeploy.m#L195) receives provider URL, downloads/extracts/redirects local version | Host dynamic, no separate fixed provider host established. Native getMetadata helper has no established app caller. |

First-party native origins/paths are not external provider APIs. applewatch [weather builder](../../../applewatch/www/js/services.js#L1073) uses historical CloudFront `/town/...`; widgets build `/weather/coord/...`, `/v000901/kma/addr/...`, `/ww/010000/current/2?gcode=...`. API Gateway `TEST_SERVER /dev` constants are **commented**. The TodayWeather widget's network wrapper retries no-data failures up to three times with 0.5s blocking waits; TodayAir's wrapper differs. No platform parity or deployment claim follows. See [mobile flow](../../architecture/mobile-api.md).

## KMA inactive and research-only

| ID / interface | Status / reason | Evidence |
| --- | --- | --- |
| KMA-X01 `/wid/queryDFSRSS.jsp?zone=` | Adapter/constant only; actual RSS acquisition uses `queryDFS.jsp?gridx&gridy` | [RSS constants](../../../server/controllers/kma/kma.town.short.rss.controller.js#L39), [actual builder](../../../server/controllers/kma/kma.town.short.rss.controller.js#L579) |
| KMA-X02 `/weather/forecast/mid-term-rss3.jsp` | Retired/gated off: `rssEnabled=false`, both due check and processing refuse network acquisition even if route exists | [Policy](../../../server/lib/midForecastPolicy.js#L14), [requester guard](../../../server/lib/midRssKmaRequester.js#L312) |
| KMA-X03 `/cgi-bin/aws/nph-aws_txt_day` | Builder exists; daily parser returns unsupported; no ordinary daily acquisition | [Builder](../../../server/lib/kmaScraper.js#L199), [unsupported parser](../../../server/lib/kmaScraper.js#L166) |
| KMA-X04 `/weather/warning/status.jsp` | Retired scrape, replaced by six warning OpenAPI operations | [Collector](../../../server/lib/kmaWarningCollector.js#L1), [old scrape](../../../server/lib/kmaScraper.js#L1653) |
| KMA-X05 legacy life/health operations | Retired generic dispatcher; `getUrl()` unconditionally throws. Current UV V5 and pollen V3 have separate live dispatch. Do not revive old heat/cold/rot/food/health operations from constants/comments. | [Guard](../../../server/lib/lifeIndexKmaRequester.js#L283), [active dispatch](../../../server/lib/lifeIndexKmaRequester.js#L1063) |
| KMA-P01 APIHub `nph-dfs_odam_grd,nph-dfs_vsrt_grd,nph-dfs_shrt_grd` | Research-only full-grid products; no current runtime caller | [Official spec](https://apihub.kma.go.kr/apiList.do?seqApi=10), [prior review](../../evidence/research/kma-provider-review-2026-10-24.md) |
| KMA-P02 APIHub `kma_sfctm3.php,kma_sfcdd3.php,nph-aws2_min,awsh.php,sfc_aws_day.php` | Research-only measured batch/range candidates; different from website `nph-aws_txt_min` | [ASOS](https://apihub.kma.go.kr/apiList.do?seqApi=2), [AWS](https://apihub.kma.go.kr/apiList.do?seqApi=2&seqApiSub=239) |
| KMA-P03 APIHub `stn_inf.php` | Research-only time-versioned station metadata; existing station sources do not call it | [Official spec](https://apihub.kma.go.kr/apiList.do?seqApi=2&seqApiSub=317) |
| KMA-P04 VSRT/ODAM historical file archives | Research-only seven-day cold-recovery candidates; archive page existence does not qualify automation, equivalent values or latency | [VSRT](https://data.kma.go.kr/data/rmt/rmtList.do?code=410&pgmNo=571), [ODAM](https://data.kma.go.kr/data/rmt/rmtList.do?code=400&pgmNo=570) |

APIHub uses `authKey` and its own access path. Existing data.go.kr `serviceKey` setup is not proof of APIHub/archive approval. [Mid APIHub products](https://apihub.kma.go.kr/apiList.do?seqApi=10&seqApiSub=287) are also a reviewed alternative, not current runtime transport. Historical source equivalence, licensing/access, revision behavior and empty-S3 p95/p99 remain unqualified in the [design proposal](../../architecture/server2-kma-data-design.md).

## Other adapter-only and test-only integrations

| ID / interface | Inputs / local bounds | Status and evidence |
| --- | --- | --- |
| AIR-NEARBY AirKorea nearby stations | `tmX,tmY,ver=1.1` | Helper-only; [details](weather-air-life.md#airkorea--keco) |
| ASTRO-KASI-COORD `getLCRiseSetInfo` | `longitude,latitude,locdate,dnYn=Y` | Unreachable provider fallback; [details](weather-air-life.md#kasi-riseset-astronomy) |
| OLD-OWM-FCST **GET** `http://api.openweathermap.org/data/2.5/forecast` | `lat,lon,APPID,mode=xml`; 5s/no retry | Module not instantiated, response getter stub; [source](../../../server/lib/OWM/owmRequester.js#L20). Current OWM air remains separate and wired. |
| OLD-MET **GET** `http://api.yr.no/weatherapi/locationforecast/1.9/` | `lat,lon`, XML, no key, 5s | Not instantiated; old version not qualified; [source](../../../server/lib/MET/metRequester.js#L29) |
| OLD-AW-GEO **GET** `http://dataservice.accuweather.com/locations/v1/cities/geoposition/search` | `apikey,q=lat,lon`, `AW_SECRET_KEY`; 5s | Test-only module, no production key caller established; [source](../../../server/lib/AW/awRequester.js#L18) |
| OLD-AW-DAILY **GET** same host `/forecasts/v1/daily/{n}day/{locationKey}` | `apikey,details=true`; 5s | Same test-only requester |
| OLD-AW-HOURLY **GET** same host `/forecasts/v1/hourly/{n}hour/{locationKey}` | Same | Same |
| OLD-AW-CURRENT **GET** same host `/currentconditions/v1/{locationKey}` | `apikey,details=true`; 5s | Same |
| OLD-FORECA **GET** `http://apitest.foreca.net/` | `lon,lat,key,format=json`, `FC_SECRET_KEY`; 5s, up to five reset/timeout retries | Test host/module; source swaps input coordinate assignment, not a recommended contract; [source](../../../server/lib/FC/fcRequester.js#L19) |
| AWS-S3-COPY / AWS-S3-UPLOAD | AWS SDK helper definitions | No current caller established; [details](platform.md#aws-storage-and-operational-apis) |

No current official normative docs were retrieved for these old weather versions/test hosts; endpoint and bounds are source observations. Merely finding a current vendor documentation page would not prove those obsolete versions work.

## Removed services and compatibility code

- **OLD-DSF**: [Dark Sky requester](../../../server/lib/DSF/dsfRequester.js#L14) immediately returns a retirement error. No successful outbound acquisition; `/dsf` now uses Visual Crossing. `DSF_SECRET_KEY` remnants are obsolete configuration.
- **OLD-DAUM**: `apis.daum.net/local/geo/{coord2addr,addr2coord,transcoord}` remains in old helpers/comments/offline utilities. Current reverse/address paths use Kakao; old transform implementation is commented ([replacement](../../../server/controllers/geo.controller.js#L575), [transform](../../../server/lib/kecoRequester.js#L892)). Not an active modern fallback.
- **OLD-PURCHASE**: current shared billing removed in #2641 and server validation/routes/settings/SDK removed in #2642. Older bundled purchase controllers remain historical. Do not list Apple `verifyReceipt` or Google Play purchase/subscription validation as currently wired server APIs. See [lifecycle](../../architecture/service-overview.md#product-lifecycle) and [historical contract](../../rewrite/server-push-and-purchase.md).
- **OLD-APNS**: direct server APNs removed; FCM iOS uses downstream Firebase/APNs. No SNS sender found. The retained GCM branch is separately classified above.
- **OLD-NEWRELIC**: agent load/config/dependency removed from current source, with regression [checks](../../../server/test/offline/runtime-node16.test.js#L70). [Current vendor docs](https://docs.newrelic.com/docs/apm/agents/nodejs-agent/installation-configuration/install-nodejs-agent/) describe an agent, not our installation. Older [EC2 evidence](../../architecture/ec2-internals.md) is timestamped and must not be substituted for current checkout wiring.
- **OLD-UA-FABRIC / older ad and Branch adapters**: inert shared `Util.ga`/Fabric compatibility and absent plugins are not active telemetry. Older native files can differ. Current GA4/Crashlytics/emi AdMob and conditional Branch are described in [platform](platform.md).

The absence of a current caller is a bounded source-review finding. Revisit a classification if a supported build selects a different native tree or a provider wrapper gains a real invoker; do not silently reactivate it from an endpoint constant alone.
