# AWS deployment and repository correlation

Observed on 2026-09-20 in account `141248341265`, primarily `ap-northeast-2`. Repository baseline: `b9795125a1b7dc8a4f7602d4612a6be7d79413ad`. This extends the supplied `aws-architecture-2026-09-20.md` with fresh read-only AWS CLI inspection and downloaded deployment-source analysis. Exact timestamps, input hashes, selected configuration, function ZIP/source hashes and metric windows are in [sanitized evidence](aws-readonly-evidence-2026-09-20.json). [Selected Lambda excerpts](deployed-lambda-excerpts.md) make the routing findings reviewable without publishing full bundles or credentials.

Evidence levels: **AWS** means current control-plane configuration or metrics; **deployed source** means code downloaded from the configured Lambda and hash-checked; **repository** means this checkout; **SSH** means selected service-host observations; **unverified** means no host/process or end-to-end observation. A configured route is not proof that its downstream provider currently succeeds.

[Interactive AWS infrastructure diagram](diagrams/aws-infrastructure.html) · [Editable JSON](diagrams/aws-infrastructure.json)

The infrastructure view groups the four public API Lambda functions, shows both CloudFront-to-EC2 and Lambda-to-EC2 paths, and separates the scheduled KAQ pipeline. The [service-host SSH inspection](ec2-internals.md) adds nginx/PM2 internals and observed TCP connections to the configured Mongo target. The gather-host link remains unverified. The AWS control-plane portion reuses the dated snapshot; host observations have their own timestamps and evidence.

## Report-to-code reconciliation

| Supplied report / previous gap | Fresh finding | Connection to repository |
| --- | --- | --- |
| Public gateway missing from this checkout | AWS CloudFront `E3QLRH0LJD07QR` sends `weather/*` and `geocode/*` to REST API `5hktkqusyb`, stage `production`, then four Lambda handlers | Matches [WeatherUtil](../../client/www/js/service.weatherutil.js) paths; gateway source still lives outside this repository |
| Lambda-to-EC2 route uncertain | Deployed weather code constructs KMA/DSF URLs; selected environment sets `SERVICE_SERVER=http://tw-svc-spot.wizardfactory.net` | DNS address matches service instance `i-089297702b70911ec`; paths match [v000903 router](../../server/routes/v000903/index.js) |
| DynamoDB tables inventoried only | Geocoder code uses DocumentClient and configured `production-address` / `production-geocode` tables | This cache belongs to Lambda; do not add these tables to the Express/Mongoose model inventory |
| Address weather route exists | Both versioned and unversioned address routes target `weatherbyaddr`; deployed `byAddress` returns an unsupported-event error, wrapped as HTTP 501 | The app's free-form weather-address fallback can reach this unsupported handler; Korean parsed address fallback goes directly to Express |
| KAQ Lambda source not inspected | Deployed copier reads KAQ images, OCRs publication date, uploads animation GIFs to S3 | [KAQ consumer](../../server/controllers/kaq.hourly.forecast.controller.js) reads compatible S3 GIFs and derives station hourly pollutant forecasts |
| Instance names imply gather/Mongo roles | Three named instances are running; service-host inspection now observes TCP to the Mongo-named instance private address | Service mode/checkout and Mongo-target TCP are now observed; gather mode and remote Mongo internals remain unverified |
| Historical Beanstalk deployment | Old EB origin remains in CloudFront configuration but no current behavior selects it | [.travis.yml](../../.travis.yml) is historical, not current production-route evidence |

## Mobile request: exact public-to-backend mapping

`todayweather.wizardfactory.net` resolves through Route53 to `d3jt4ruwvwmin8.cloudfront.net`. CloudFront preserves the weather/geocode path and adds API origin path `/production`. The deployed API stage export contains these eight GET routes (braces denote API Gateway parameters):

| Public paths | Lambda suffix | Deployed behavior |
| --- | --- | --- |
| `/weather/{version}/coord/{loc}`, `/weather/coord/{loc}` | `weatherbycoord` | Geocode, dispatch by country, request EC2 weather, enrich response |
| `/weather/{version}/addr/{address}`, `/weather/addr/{address}` | `weatherbyaddr` | Unsupported handler; application HTTP 501 |
| `/geocode/{version}/coord/{loc}`, `/geocode/coord/{loc}` | `geoinfobycoord` | Coordinate geocoding and DynamoDB cache |
| `/geocode/{version}/addr/{address}`, `/geocode/addr/{address}` | `geoinfobyaddr` | Address geocoding and DynamoDB cache |

Lambda names have prefix `tw-backend-functions-production-`. Public GET integrates with Lambda through AWS proxy integration POST; that POST is an invocation transport, not the mobile API method. Version is a path value consumed by the weather handler, not an independently deployed API stage. A versioned v000903 request overrides the bundled default `v000901`; no `SERVICE_VERSION` override was configured. Thus the unversioned widget route uses the older default.

The weather coordinate handler resolves geoinfo first, then constructs exactly one backend URL:

- `country === 'KR'`: `http://tw-svc-spot.wizardfactory.net/{version}/kma/addr/{encoded name1}/{encoded name2}/{encoded name3}`, omitting absent components.
- Otherwise: `http://tw-svc-spot.wizardfactory.net/{version}/dsf/coord/{lat},{lon}`.

It appends incoming query parameters, derives language from `Accept-Language`, and attempts the backend request up to three times with a 3-second timeout per attempt. It imports geocoder `name`, `country`, `address`, and `location` into the returned weather JSON. It does not use the repository's `/geo` redirect endpoint for this path. Subsequent SSH inspection confirms nginx port 80 -> loopback 3000 -> ten PM2 workers, and identifies deployed checkout 5bca407 with config/logger edits. Selected router files match the local baseline; see [EC2 internals](ec2-internals.md) for the remaining differences.

The default CloudFront behavior and `/*/push`, `/*/push-list` select the service origin directly over HTTP port 80. Consequently `/v000903/kma/...`, nation, purchase and push paths do not require the weather Lambda route. `photos/*` selects `today-weather-photos` S3. CloudFront-to-API uses HTTPS; Lambda-to-service and CloudFront-to-service are configured HTTP.

## Geocoder and layered caching

Geocoder cache lookup precedes external provider requests. Coordinate keys round to three decimals; coordinate cache records expire by a code-level `updatedAt` age test of 30 days (not evidence of DynamoDB TTL configuration). KR cached coordinates require a KMA address. The deployed coordinate provider logic starts with Kakao within its Korea bounding area, otherwise Google, and can enrich/fall back through Google and Dark Sky reverse geocoding. Address lookup tries Google then Kakao. Bundled Daum adapters do not establish active use in these branches. The address cache hit path returns its stored result without the coordinate path's `_isExpired` check; no equivalent 30-day address-record expiry was established. Cache updates after provider resolution are asynchronous. Provider availability was not tested.

| Layer | Observed/configured policy | Interpretation |
| --- | --- | --- |
| App WeatherInfo | 10-minute in-memory gate | Independent of HTTP caches; reload can bypass |
| CloudFront weather/geocode | Min/default/max TTL = `0 / 86400 / 31536000` seconds | Default is not a measured response age; origin headers matter |
| Weather Lambda success | `Cache-Control: max-age=300` | Overrides the otherwise misleading one-day default for ordinary successful responses |
| Geocode Lambda success | `Cache-Control: max-age=2592000` | 30-day HTTP cache policy |
| Lambda DynamoDB coordinate cache | 30-day `updatedAt` check | Address cache hits do not apply this expiry check |
| API Gateway production | Stage cache disabled | No observed stage-cache layer |
| CloudFront default | `300 / 300 / 600` seconds | Applies to legacy paths using default behavior; distinct from Lambda weather |
| Express DSF/AQI | 15-minute weather current check / 60-minute air check, plus completeness rules | Can fetch providers inside a request |

Weather/geocode behaviors forward all query parameters and `Origin` / `Accept-Language`, without cookies. Lambda timeout is 20 seconds; current API resource integration configuration has a 29-second timeout (the deployed stage export omits this field). App overlapping attempts at roughly 0/2/4 seconds can amplify one refresh independently of Lambda's sequential backend retries. No whole-chain latency upper bound is inferred from adding these timeouts.

Errors with no explicit status are wrapped as HTTP 501 with a successful Lambda callback. Therefore zero Lambda `Errors` does not establish zero HTTP failures. The weather-address 501 is established from deployed code, not a live endpoint probe.

### CORS on error responses (#2584)

The Lambda wrapper adds `Access-Control-Allow-Origin: *` only to successful responses; its 501/404 responses and API Gateway-generated errors carry no CORS header. All four public API Lambda functions run `nodejs6.10`, whose function updates AWS has blocked since 2019-08-12, so the wrapper cannot change without a runtime migration. On **2026-09-25 23:22 UTC** the `weather/*` and `geocode/*` CloudFront behaviors received the AWS managed response headers policy `Managed-SimpleCORS` (`60669652-455b-4ae9-85a4-c4c02393f86c`: `Access-Control-Allow-Origin: *`, no credentials, `OriginOverride=false`). No other distribution setting changed.

| Request through CloudFront | CORS header |
| --- | --- |
| With `Origin`, origin response without a CORS header (Lambda 501, API Gateway 403) | `*`, added by CloudFront |
| With `Origin`, successful Lambda response | The origin's own `*`; CloudFront adds nothing |
| Without `Origin` | Unchanged; CloudFront adds nothing |

Status codes and error bodies are unchanged. Direct `execute-api` requests bypass the policy. API Gateway `DEFAULT_4XX`/`DEFAULT_5XX` gateway responses are still uncustomized. Rollback: remove `ResponseHeadersPolicyId` from both behaviors.

## KAQ image production and consumption

[Interactive KAQ pipeline](diagrams/kaq-image-pipeline.html) · [Repository collection schedules](weather-collection.md)

1. Enabled production EventBridge rule `tw-backend-functions-prod-CopyKaqfsImagesToS3Event-YS7FJ8JSUPM4` targets `tw-backend-functions-production-copyKaqfsImagesToS3` at `cron(5 8,9,10,11,20,21,22,23 ? * * *)` (UTC). The similarly scheduled dev rule has no targets.
2. Deployed Lambda visits `http://www.webairwatch.com/kaq` for `modelimg` and `modelimg_CASE4`; pollutants are PM10, PM2_5, O3, NO2, SO2, area 09KM.
3. Google Cloud Vision reads the `*.09KM.000.gif` image. `_getDate` uses the first OCR text description to derive the first 19 characters as a publication folder.
4. It downloads the animation and uploads `{publication}/{modelimg or modelimg_CASE4}.{pollutant}.09KM.animation.gif`. No bucket/region override was set; bundled defaults select `tw-kaqfs-images`, `ap-northeast-2`.
5. Repository `KaqHourlyForecastController` lists S3 prefixes, selects the latest folder excluding `dateBackup`, builds matching image paths, decodes GIF frames and maps station coordinates/pixel colors to hourly pollutant forecasts. `_updateModelImgList` -> `_updateModelImg` -> `_updateHourlyForecast` -> `_updateDustInfo` -> `_updateForecastList` leads to hourly-forecast upserts keyed by station, pollutant, map case and forecast time; map-case records are stored separately. Its all-images completeness check is commented out in the waterfall. Its configured bucket/region come from `KAQ_KOREA_IMAGE_MAP_BUCKET_NAME` / `KAQ_KOREA_IMAGE_MAP_REGION`; the service-host values now match those names, but the separate gather instance's values remain unknown.
6. Manager schedules this consumer at UTC minute 7 with hours `8,9,10,11,20,21,22,13`. This differs from producer hour `23`. The two-minute offset is a schedule relationship, not a completion handshake; the source typo and running deployment parity remain to be assessed before a fix.

The original report's Lambda and the repository KAQ consumer are separate stages. The producer has active AWS schedule evidence. The consumer has repository evidence, but neither its live process mode nor its same-bucket connection was confirmed. Do not draw a verified EventBridge-to-Express invocation or assume S3 success guarantees ingestion.

## Operational observations and remaining gaps

The later [30-day traffic report](../../reports/aws/api-traffic-2026-09-22.md) covers **2026-08-23 19:53:45 UTC to 2026-09-22 19:53:45 UTC**. It records 220,583 product API viewer requests, including 155,998 unversioned weather requests (70.72%). Of the latter, 38,069 had Android-like user agents; their released client source is not identified by this checkout. These traffic observations and the September 20 Lambda default above are separate evidence: no per-request backend-version correlation was performed. See [open questions and bounded S3 access checks](evidence.md#traffic-and-log-access-follow-up).

In the exact 24-hour window recorded in the evidence JSON, weatherbycoord had **5,169 invocations, 0 Lambda errors, 0 throttles**; the KAQ copier had **24 invocations, 24 errors, 0 throttles**. A bounded CloudWatch log query returned 40 matching events with pagination remaining: all contained `TypeError` / `Cannot read property 'description' of undefined`, with `_getDate` stack frames in 32 events. These are repeated log events, not 40 distinct invocations. This localizes the observed failure to absent OCR result data. It does not identify why OCR data was absent. Full log payloads and client data were not copied into the repository.

The configured runtimes are `nodejs6.10` for the four public handlers and `nodejs8.10` for the copier. This is current configuration evidence, not an assertion about invocation compatibility or a performed upgrade.

Service-host process manager/listener, checkout, resolved mode/DB version and configured database destination are now covered by [SSH evidence](ec2-readonly-evidence-2026-09-20.json). Still unverified: shipped app release base URL; separate gather/Mongo host internals; actual collector/provider success; current S3 object freshness; end-to-end request results; reason for the empty OCR result. The supplied inventory's other account resources and security-group observations were not expanded into an unrelated audit. No credentials, signed download URLs, full environment maps, raw Lambda bundles or private keys are included. AWS API operations were read-only. The subsequent explicitly authorized SSH phase used read-only host inspection; no functions, collection URLs, deployments, process restarts, SSM commands or configuration changes were executed.
