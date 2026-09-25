# API endpoint catalog

This catalog lists every Express handler registration in the checked-in server at `bd6640f2` (re-baselined 2026-09-25 from `ff7acf3996ccb66c912d2ed4710cf300197d6966`): **89 router registrations in 25 route files, plus the app-level `GET /health`**. Routers are reused under several prefixes, so the 89 registrations expand to **291 mounted method/path combinations** (292 with `/health`). `server/routes/` is identical at both commits, and the counting commands in [Limitations](#scope-and-limitations) return the same numbers at `bd6640f2`; upstream `app.js` changes removed the New Relic require (c80ee014), `global.tempString` (49afbbea) and the push-mode `apnFeedback` call (45b2eb3f); no Express middleware or mount changed, while controllers and collectors did. `client/`, `tw.ios/`, `ta.ios/` and `applewatch/` are identical to `ff7acf39`. Rows are observed source unless labelled otherwise. Consumer attributions come from reading `client/`, `tw.ios/`, `ta.ios/`, `applewatch/`, `server/` and the new static web client in `web/` (with `packages/weather-core/`), plus git history where marked. Traffic figures come from the [30-day CloudFront report](../../reports/aws/api-traffic-2026-09-22.md) (2026-08-23..09-22, a historical deployment observation). Routing and exposure notes are 2026-09-20 deployment observations. No server, database, provider or AWS call was made for this catalog. The public `/weather/*` and `/geocode/*` routes are gateway routes, not Express routes; see [AWS/code correlation](../architecture/aws-code-correlation.md).

**How to use this during a rewrite**

1. Start from the consumer and traffic columns. A contract with a reachable caller or observed traffic needs an explicit keep, adapt or retire decision ([proposed decisions](#retirement-and-compatibility-decisions-proposal)). A contract without either still needs a decision, because external Android widget plugins and old app binaries are not in this checkout.
2. For every contract you keep, characterize it with the linked middleware chain and the [chain-difference tables](#chain-differences-for-legacy-contracts). Do not assume the v000903 response shape: older chains differ in icon case, unit conversion, air fields, summaries and even whether a body is sent.
3. Treat collection, diagnostic and requester routes as operations interfaces with side effects. Move them behind an internal or authenticated boundary; do not publish them as API.
4. After any router change, re-run the counting commands in [Limitations](#scope-and-limitations) and update this file with the affected response and assembly documents.

Related references: [security and privacy inventory](security-and-privacy-inventory.md) (authentication classes, secret locations, personal data), [server response assembly](server-response-assembly.md) (v000903 chains, error sink, world assembly, nation fan-out, version variants), [client data contracts](client-data-contracts.md#request-surface) (app request surface), [push notifications](../architecture/push-notifications.md), [push text and purchase validation](server-push-and-purchase.md), [static web client](../architecture/web-client.md), [weather collection schedule](../architecture/weather-collection.md#schedule-as-implemented), [version routing diagram](diagrams/server-version-routing.html).

## Legend

**Consumer labels.** Each label names the evidence behind a caller.

| Label | Meaning |
| --- | --- |
| **App** | Shared web client in `client/www`, with a reachable call site at baseline |
| **Web PWA** | Static browser client in `web/` (merged upstream in `bd6640f2`), not the Cordova app. Credential-free cross-origin `GET`s from [`direct-api.ts`](../../web/src/direct-api.ts#L72-L206) to the public API origin. Deployment is unobserved, so no traffic is attributed to it. See [web client](../architecture/web-client.md) and [native consumers §5](native-consumers-and-plugins.md#5-non-native-consumer-web-pwa-web) |
| **Widget** | iOS TodayWeather/TodayAir widget source (`tw.ios/widget`, `ta.ios/widget`), with a reachable call site |
| **Worker** | Server alarm/alert push workers (`SERVER_MODE=push`), which call `SERVICE_SERVER`. Whether a push worker currently runs is unverified ([push notifications](../architecture/push-notifications.md)) |
| **Internal** | Server self-calls: Manager `/gather` self-HTTP, nation fan-out through `API_SERVER`, legacy world `req_add` through `config.url.requester` |
| **Gateway** | Deployed weather Lambda, which calls `/{version}/kma/addr` or `/{version}/dsf/coord` on the service origin (2026-09-20 deployment observation; source outside the checkout) |
| **Dead** | Call site present in current source but commented out or unreachable |
| **Historical** | Caller evidenced only in git history |
| **Unshipped snapshot** | Reachable call site inside a bundled platform web tree (`tw.ios/www`, `ta.ios/www`, `applewatch/www`) that differs from `client/www`. No inspected build step proves the tree ships ([service overview](../architecture/service-overview.md)) |
| **External (unverified)** | Plausible caller whose source is absent, for example the Android widget Cordova plugins installed from external repositories ([tw.package.json](../../client/tw.package.json), [ta.package.json](../../client/ta.package.json)) |
| **None found** | No caller in `client/`, `tw.ios/`, `ta.ios/`, `applewatch/`, `server/` or `web/` |

**Traffic labels.** The CloudFront report counts viewer requests, including cache hits.

| Label | Meaning |
| --- | --- |
| A number | Requests for that normalized method and path in the 30-day window |
| `0 (in scope)` | The path is inside the report's `/vNNNNNN/...` scope but is not one of its 19 method/path groups |
| `not measured` | Outside the report's scope: unversioned paths other than `/weather` and `/geocode`, such as `/`, `/town`, `/gather`, `/ww`, `/req`, `/health`. Some may be among the 44,297 unclassified viewer requests |

Calls from the Gateway Lambda or from workers to the service origin do not pass through CloudFront. A `0` therefore does not rule out those callers.

## Shared request pipeline and exposure

Every route below runs behind the same app-level middleware ([app.js](../../server/app.js#L76-L109)). Library behavior is labelled as library-semantics analysis; it was not executed.

| Order | Middleware | Effect on every route |
| --- | --- | --- |
| 1 | `cors()` ([L76](../../server/app.js#L76)) | Library defaults: `Access-Control-Allow-Origin: *`, and `OPTIONS` preflight answered with 204. The report's 7 `OPTIONS /v000902/push` requests (6 × 204) are consistent with this. The **Web PWA**'s cross-origin nation and warning reads depend on this wildcard; its `GET`s send only `Accept` and `Accept-Language`, which are CORS-safelisted headers, so no preflight is needed (Fetch-standard semantics; [request code](../../web/src/direct-api.ts#L88-L105)) |
| 2 | `express-session` ([L79-L82](../../server/app.js#L79-L82)) | Hard-coded literal session secret at `app.js#L79`. No `store` option, so the library's in-memory store is used. `saveUninitialized: true` with a 60-second cookie, so cookie-less requests receive `Set-Cookie` (library semantics). No route reads session data; `req.sessionID` is only logged |
| 3 | favicon, `bodyParser.json`, `bodyParser.urlencoded`, `cookieParser` ([L89-L93](../../server/app.js#L89-L93)) | JSON and form bodies parsed for POST, PUT and DELETE |
| 4 | `express.static('public')` ([L94](../../server/app.js#L94)) | `/img/*`, `/lib/*` and `/stylesheets/*` are served before any router |
| 5 | `i18n.init` ([L96](../../server/app.js#L96)) | Locale from the `twcookie` cookie or `Accept-Language`. It selects localized strings in responses; see [language negotiation](client-data-contracts.md#language-negotiation) |
| 6 | Routers ([mount map](#mount-map), [L98-L106](../../server/app.js#L98-L106)), then `GET /health` | `/health` sends the text `OK` ([L107-L109](../../server/app.js#L107-L109)) |
| 7 | 404 middleware and two three-parameter "error handlers" ([L146-L175](../../server/app.js#L146-L175)) | Every `next(err)`, every synchronous middleware throw and every unmatched path ends in Express's final handler: HTML, `err.status` or 500. See the [error sink](server-response-assembly.md#error-sink-for-propagated-failures) |

**Resolved upstream: New Relic.** At `ff7acf39` a step 0, `require('newrelic')` at `app.js#L7`, loaded the APM agent before Express. Commit `c80ee014` (2026-09-24) removed that line, `server/newrelic.js`, the `newrelic` dependency and the `NEW_RELIC_LICENSE_KEY` configuration entry. At `bd6640f2` `'use strict'` is followed directly by the `express` require ([app.js#L5-L7](../../server/app.js#L5-L7)). The 2026-09-20 deployed checkout `5bca407` predates this change ([EC2 internals](../architecture/ec2-internals.md)).

**Cache headers.** Among the route handlers, only `GET /v000903/kma/special` sets `Cache-Control` (`max-age=300`); `express.static` applies its own library defaults to the static files. Reproduce with `grep -rn "Cache-Control\|setHeader" server/routes server/controllers server/lib server/app.js`, which returns one match. Every other route relies on Express defaults: a weak `ETag` for `res.send`/`res.json` bodies (library default). The cache column in the tables below is therefore omitted unless a row differs.

**Public exposure (2026-09-20 deployment observation).**

- CloudFront's default behavior sends every path that does not match `weather/*`, `geocode/*`, `photos/*`, `/*/push` or `/*/push-list` to the service origin ([AWS correlation](../architecture/aws-code-correlation.md#geocoder-and-layered-caching), [AWS evidence JSON](../architecture/aws-readonly-evidence-2026-09-20.json)).
- nginx on the service host proxies `location /` to Express ([EC2 internals](../architecture/ec2-internals.md)). `SERVER_MODE` does not remove mounts.
- Every row below was therefore reachable from the public host at that time, including `/gather`, `/req` and `/test`. This is an inference from configuration; no such request was sent.

The default behavior's settings have three consequences:

| Setting | Consequence |
| --- | --- |
| Min/default/max TTL of 300/300/600 seconds | The edge can cache `GET` responses, including collection triggers. Not tested |
| Query strings forwarded | Unit and air query keys reach Express |
| Cookies not forwarded; only `Origin` and `Accept-Language` forwarded | Custom request headers such as `bearertoken` and `Device-Id` are absent from the forwarded list. This matters for the [v000803 POST gate](#authentication-and-gating) and for device-ID logging. Inference from the whitelist, not tested |

## Mount map

Reproduce the prefix expansion with a walker over `app.use`/`router.use(..., require(...))` in `server/app.js` and the route index files. The script is described in [Limitations](#scope-and-limitations).

| Router file | Handler registrations | Mounted prefixes | Mounted combinations |
| --- | ---: | --- | ---: |
| [v000001/index.js](../../server/routes/v000001/index.js) | 1 | `/`, `/v000001` | 2 |
| [v000001/routeGather.js](../../server/routes/v000001/routeGather.js) | 25 | `/gather`, `/v000001/gather`, `/v000705/gather`, `/v000803/gather`, `/v000901/gather`, `/v000902/gather`, `/v000903/gather` | 175 |
| [v000001/routeTownForecast.js](../../server/routes/v000001/routeTownForecast.js) | 8 | `/town`, `/v000001/town` | 16 |
| [v000705/index.js](../../server/routes/v000705/index.js) | 1 | `/v000705` | 1 |
| [v000705/routeTownForecast.js](../../server/routes/v000705/routeTownForecast.js) | 8 | `/v000705/town` | 8 |
| [v000705/dailySummary.js](../../server/routes/v000705/dailySummary.js) | 2 | `/v000705/daily`, `/v000803/daily`, `/v000901/daily`, `/v000902/daily`, `/v000903/daily` | 10 |
| [v000705/receiptValidation.js](../../server/routes/v000705/receiptValidation.js) | 1 | `/v000705/check-purchase`, `/v000803/…`, `/v000901/…`, `/v000902/…`, `/v000903/check-purchase` | 5 |
| [v000705/routePushNotification.js](../../server/routes/v000705/routePushNotification.js) | 3 | `/v000705/push`, `/v000803/push`, `/v000901/push`, `/v000902/push`, `/v000903/push` | 15 |
| [v000803/index.js](../../server/routes/v000803/index.js) | 2 | `/v000803` | 2 |
| [v000803/routeTownForecast.js](../../server/routes/v000803/routeTownForecast.js) | 4 | `/v000803/town` | 4 |
| [v000803/route.nation.js](../../server/routes/v000803/route.nation.js) | 1 | `/v000803/nation`, `/v000901/nation`, `/v000902/nation`, `/v000903/nation` | 4 |
| [v000803/route.test.js](../../server/routes/v000803/route.test.js) | 4 | `/v000803/test`, `/v000901/test`, `/v000902/test`, `/v000903/test` | 16 |
| [v000803/route.geo.js](../../server/routes/v000803/route.geo.js) | 1 | `/v000803/geo`, `/v000901/geo`, `/v000902/geo` | 3 |
| [v000901/index.js](../../server/routes/v000901/index.js) | 1 | `/v000901` | 1 |
| [v000901/route.kma.addr.js](../../server/routes/v000901/route.kma.addr.js) | 4 | `/v000901/kma/addr` | 4 |
| [v000901/route.dsf.coord.js](../../server/routes/v000901/route.dsf.coord.js) | 1 | `/v000901/dsf/coord` | 1 |
| [v000902/index.js](../../server/routes/v000902/index.js) | 1 | `/v000902` | 1 |
| [v000902/route.kma.v000902.js](../../server/routes/v000902/route.kma.v000902.js) | 5 | `/v000902/kma` | 5 |
| [v000902/route.dsf.coord.v000902.js](../../server/routes/v000902/route.dsf.coord.v000902.js) | 1 | `/v000902/dsf/coord`, `/v000903/dsf/coord` | 2 |
| [v000902/route.push.update.list.js](../../server/routes/v000902/route.push.update.list.js) | 1 | `/v000902/push-list`, `/v000903/push-list` | 2 |
| [v000903/index.js](../../server/routes/v000903/index.js) | 1 | `/v000903` | 1 |
| [v000903/route.kma.v000903.js](../../server/routes/v000903/route.kma.v000903.js) | 6 | `/v000903/kma` | 6 |
| [v000903/route.geo.v000903.js](../../server/routes/v000903/route.geo.v000903.js) | 1 | `/v000903/geo` | 1 |
| [worldweather/routeWeather.js](../../server/routes/worldweather/routeWeather.js) | 4 | `/ww` | 4 |
| [worldweather/routeRequester.js](../../server/routes/worldweather/routeRequester.js) | 2 | `/req` | 2 |
| **Total** | **89** | | **291** |

The router-level `timestamp` loggers in most files only log and call `next()`. The v000705, v000803, v000901, v000902 and v000903 index loggers also log the `device-id` and `user-agent` headers, and the `/req` logger logs `device-id`. `v000901` mounts no `/kma/coord` and no `/kma/special`; `v000901` comments out `/town`, and so do `v000902` and `v000903` ([v000901 index](../../server/routes/v000901/index.js#L25-L34)).

## Authentication and gating

| Model | Where | Behavior |
| --- | --- | --- |
| None | Every route except the two rows below | No authentication, rate limiting or caller identity check in Express. `Device-Id` is logged only |
| v000803 POST JWT gate | Router middleware [v000803/index.js#L24-L108](../../server/routes/v000803/index.js#L24-L108). It runs for every `POST` under `/v000803`: `POST /v000803/`, `POST /v000803/push` and `POST /v000803/check-purchase`, and also POSTs to unmatched paths there. `GET`, `PUT` and `DELETE` pass through | See the steps below |
| `/req` key presence | [controllerRequester.js#L133-L151](../../server/controllers/worldWeather/controllerRequester.js#L133-L151) | `checkKey` only sets `req.validReq`; `runCommand` never reads it (`grep -rn validReq server/controllers server/routes` finds only the three assignments). Commands therefore run with any `key` or with none |

The v000803 POST gate works as follows. Its security properties (hard-coded credentials, the password inside the token, token logging and stack-bearing failure pages) are assessed in the [security and privacy inventory](security-and-privacy-inventory.md#1-endpoint-authentication-classes).

1. **Login branch (no `bearertoken` header).** The gate compares body `id` and `password` with hard-coded literals at `#L51-L52`.
   - On a match it signs a token and sends it as plain text. The line `res.status = 200` at `#L64` overwrites the method with a number instead of calling it. The request never reaches the addressed handler.
   - On a mismatch or a missing `id` it calls `res.render('error')` with status 500. This is a direct render, so `views/error.jade` is used, unlike the app-level handlers.
2. **Signing key.** RS256 is used with `./config/jwt-private.pem` if that file existed when the module's asynchronous `fs.exists` check ran. Otherwise the gate falls back to HMAC with a hard-coded literal secret at `#L58`. No `.pem` file is in the checkout.
3. **Token branch (with `bearertoken`).** The gate calls `jwt.decode`, not `jwt.verify`. In jsonwebtoken 5.x `decode` does not check the signature (library-semantics analysis).
   - The request proceeds when the in-memory map entry `idBearerToken[decode.id]` equals `decode.app`. Only a successful login in the same worker process fills that map, so a legitimately issued token fails after a restart, or on another PM2 worker, until that worker sees a login.
   - **Forged tokens pass without any login.** Both operands come from unverified claims, and the map is a JavaScript array ([#L22](../../server/routes/v000803/index.js#L22)). A token without `id` and `app` compares `undefined === undefined`. A token whose `id` names a built-in array property, such as `length`, with the matching `app` value also passes. This is JavaScript and library-semantics analysis, not executed against the route; see [security inventory §1.1](security-and-privacy-inventory.md#11-v000803-post-gate).
   - An undecodable token makes `decode` null, and the resulting `TypeError` ends in the [error sink](server-response-assembly.md#error-sink-for-propagated-failures) (HTML 500).
4. **Callers.** None found: no `bearertoken` string exists in `client/www/js`, `tw.ios` or `ta.ios`. Through CloudFront the header is probably not forwarded (see [exposure](#shared-request-pipeline-and-exposure)). All three gated POSTs show `0 (in scope)` traffic.

## Handler catalog

Rows are numbered 1–89 and grouped by router file. Paths are relative to the mounted prefixes in the [mount map](#mount-map). Unless a row says otherwise:

- auth is `none`, except that every POST under `/v000803` first passes the [JWT gate](#authentication-and-gating);
- cache headers are Express defaults;
- a failure passed to `next(err)` or thrown synchronously ends in the [error sink](server-response-assembly.md#error-sink-for-propagated-failures).

### Index pages (7 registrations)

| # | Route | Source | Response | Side effects | Consumers | 30-day traffic |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `GET /` at `/` and `/v000001` | [v000001/index.js#L5-L7](../../server/routes/v000001/index.js#L5-L7) | HTML render of `views/index.jade` with the local `title: 'TodayWeather'`. The template hard-codes its `<title>` and never reads that local ([index.jade](../../server/views/index.jade)), so every index render in rows 1–7 produces the same page | None | None found | `/`: not measured. `/v000001/`: 0 (in scope) |
| 2 | `GET /v000705/` | [v000705/index.js#L22-L24](../../server/routes/v000705/index.js#L22-L24) | Same page | None | None found | 0 (in scope) |
| 3 | `GET /v000803/` | [v000803/index.js#L111-L113](../../server/routes/v000803/index.js#L111-L113) | Same page | None | None found | 0 (in scope) |
| 4 | `POST /v000803/` | [v000803/index.js#L123-L125](../../server/routes/v000803/index.js#L123-L125) | Same page, rendered with the unused local `title: 'TodayWeather : post'`. Only a request that passes the gate's token branch reaches it; the login branch answers first | None | None found | 0 (in scope) |
| 5 | `POST /v000901/` | [v000901/index.js#L39-L41](../../server/routes/v000901/index.js#L39-L41) | Same `: post` page, ungated. The source comment reads "make html error page" | None | None found | 0 (in scope) |
| 6 | `POST /v000902/` | [v000902/index.js#L39-L41](../../server/routes/v000902/index.js#L39-L41) | Same as row 5 | None | None found | 0 (in scope) |
| 7 | `POST /v000903/` | [v000903/index.js#L39-L41](../../server/routes/v000903/index.js#L39-L41) | Same as row 5 | None | None found | 0 (in scope) |

### Collection routes: `routeGather.js` (25 registrations, 175 mounted combinations)

All 25 are `GET` handlers under `/gather`, `/v000001/gather`, `/v000705/gather`, `/v000803/gather`, `/v000901/gather`, `/v000902/gather` and `/v000903/gather`. They take no query parameters and do not check the caller. Service keys come from `config.keyString.dongnae_forecast_keys` (random pick per request) or `config.keyString.normal`; the AWS keys used by row 30 come from `config.keyString.aws_access_key`/`aws_secret_key` ([config names](configuration-inventory.md)).

Existing coverage, not repeated here:

- **Schedule, product meaning and ingestion failure behavior:** [weather collection](../architecture/weather-collection.md#schedule-as-implemented).
- **Provider endpoints the collectors call at `bd6640f2`** (KMA API version paths reconciled upstream in `5e653285` and `b4d063fd`): [gather source reconciliation](../architecture/gather-source-reconciliation.md).
- **Mode dependence:** the handlers use the global `manager` and `townRss` created at [app.js#L124-L125](../../server/app.js#L124-L125). Some members are initialized only by `startManager()` in `gather`/`local` mode ([weather collection](../architecture/weather-collection.md)).
- **No route for ASOS history recovery (added upstream in `2116c6bf`).** The scheduled job runs in-process as the Manager task `AsosHistory` when `ASOS_HISTORY_ENABLED=true` ([controllerManager.js#L2120-L2132](../../server/controllers/controllerManager.js#L2120-L2132)). The operator command `server/bin/backfill-history.js` does not load `app.js` or expose a route ([backfill-history.js#L1-L15](../../server/bin/backfill-history.js#L1-L15)). Request-time reads add `historyStatus` to domestic bodies only when `ASOS_HISTORY_READ_ENABLED=true`. Details: [historical ASOS recovery](../architecture/weather-collection.md#historical-asos-recovery-2564) and [historical observation composition](../architecture/mobile-api.md#historical-observation-composition-2564).

Two facts apply to every row in this table:

- **Internal caller.** Manager `_requestApi` sends unversioned `http://<ipAddress>:<port>/gather/<name>` with a 24-hour timeout ([controllerManager.js#L2078-L2095](../../server/controllers/controllerManager.js#L2078-L2095)). "Manager" below means a live `_requestApi` call at the cited line.
- **Traffic.** `/gather/*` is not measured (outside the report's scope). Every `/vNNNNNN/gather/*` combination is `0 (in scope)`.

Most rows answer HTTP 200 with an empty body after the task, and only log errors. A 200 therefore does not prove ingestion.

| # | Path | Source | Work | Response | Consumers |
| ---: | --- | --- | --- | --- | --- |
| 8 | `/current/:mx/:my` | [#L24-L39](../../server/routes/v000001/routeGather.js#L24-L39) | Manager `getKmaData('current')` fetches one KMA grid and saves it through `getSaveFunc` ([controllerManager.js#L1893-L1947](../../server/controllers/controllerManager.js#L1893-L1947)) | JSON `{mCoord, pubDate, ret}`; 500 with `err.message` on failure. The 400 branch is unreachable because Express requires both parameters | **Dead:** only `checkDBValidation` requests it ([controllerTown.js#L357-L403](../../server/controllers/controllerTown.js#L357-L403)), and no route references that method (`grep -rn checkDBValidation server/routes server/controllers` finds only the definition) |
| 9 | `/current` | [#L41-L49](../../server/routes/v000001/routeGather.js#L41-L49) | `getTownCurrentData(9, key)` for all grids | Empty 200 after completion | Manager ([#L2226](../../server/controllers/controllerManager.js#L2226)) |
| 10 | `/past` | [#L51-L60](../../server/routes/v000001/routeGather.js#L51-L60) | `PastConditionGather.start(1, key)` | Empty 200 **immediately**, before the work finishes | Manager ([#L2136](../../server/controllers/controllerManager.js#L2136)) |
| 11 | `/shortrss` | [#L62-L67](../../server/routes/v000001/routeGather.js#L62-L67) | `townRss.mainTask` | Empty 200 after completion | Manager ([#L2163](../../server/controllers/controllerManager.js#L2163)) |
| 12 | `/midrss` | [#L69-L76](../../server/routes/v000001/routeGather.js#L69-L76) | `midRssKmaRequester.mainProcessM`. At `bd6640f2` it does no work: `midForecastPolicy.rssEnabled` is `false` ([midForecastPolicy.js#L14](../../server/lib/midForecastPolicy.js#L14)), so `mainProcessM` returns the error `Legacy mid RSS unavailable: retired feed` ([midRssKmaRequester.js#L359-L360](../../server/lib/midRssKmaRequester.js#L359-L360)), which the route only logs | Empty 200 | None found. Changed upstream: the Manager `MidRss` task that called it at `ff7acf39` was removed in `49afbbea` (2026-09-24), and mid RSS was retired in `95fe711e` ([mid RSS retirement](../architecture/weather-collection.md#daily-forecast-validity-issue-2560)) |
| 13 | `/midtemp` | [#L78-L85](../../server/routes/v000001/routeGather.js#L78-L85) | `getMidTempByForecastZone(9, normal_key)` | Empty 200 | Manager ([#L2146](../../server/controllers/controllerManager.js#L2146)) |
| 14 | `/midland` | [#L87-L94](../../server/routes/v000001/routeGather.js#L87-L94) | `getMidLand` | Empty 200 | Manager ([#L2150](../../server/controllers/controllerManager.js#L2150)) |
| 15 | `/midforecast` | [#L96-L103](../../server/routes/v000001/routeGather.js#L96-L103) | `getMidForecast` | Empty 200 | Manager ([#L2154](../../server/controllers/controllerManager.js#L2154)) |
| 16 | `/midsea` | [#L105-L112](../../server/routes/v000001/routeGather.js#L105-L112) | `getMidSea` | Empty 200 | Manager ([#L2158](../../server/controllers/controllerManager.js#L2158)) |
| 17 | `/keco` | [#L114-L121](../../server/routes/v000001/routeGather.js#L114-L121) | AirKorea station observations (`cbKecoProcess`) | Empty 200 | Manager ([#L2183](../../server/controllers/controllerManager.js#L2183)) |
| 18 | `/kecoSido` | [#L123-L130](../../server/routes/v000001/routeGather.js#L123-L130) | AirKorea regional observations | Empty 200 | Manager ([#L2194](../../server/controllers/controllerManager.js#L2194)) |
| 19 | `/kecoForecast` | [#L132-L140](../../server/routes/v000001/routeGather.js#L132-L140) | AirKorea dust forecast | Empty 200 | Manager ([#L2141](../../server/controllers/controllerManager.js#L2141)) |
| 20 | `/short/:mx/:my` | [#L142-L158](../../server/routes/v000001/routeGather.js#L142-L158) | As row 8, product `short` | As row 8 | **Dead:** as row 8 |
| 21 | `/short` | [#L160-L168](../../server/routes/v000001/routeGather.js#L160-L168) | `getTownShortData(9, key)` | Empty 200 | Manager ([#L2215](../../server/controllers/controllerManager.js#L2215)) |
| 22 | `/shortest/:mx/:my` | [#L170-L185](../../server/routes/v000001/routeGather.js#L170-L185) | As row 8, product `shortest` | As row 8 | **Dead:** as row 8 |
| 23 | `/shortest` | [#L187-L195](../../server/routes/v000001/routeGather.js#L187-L195) | `getTownShortestData(9, key)` | Empty 200 | Manager ([#L2236](../../server/controllers/controllerManager.js#L2236)) |
| 24 | `/lifeindex` | [#L197-L204](../../server/routes/v000001/routeGather.js#L197-L204) | KMA life-index collection | Empty 200 | Manager ([#L2205](../../server/controllers/controllerManager.js#L2205)) |
| 25 | `/healthday` | [#L206-L221](../../server/routes/v000001/routeGather.js#L206-L221) | Seven health-index request URLs through `ctrlHealthDay.getData` | Empty 200 | Manager ([#L2174](../../server/controllers/controllerManager.js#L2174)) |
| 26 | `/kmaStnHourly` | [#L226-L242](../../server/routes/v000001/routeGather.js#L226-L242) | Scraper `getStnHourlyWeather`. The source comment above it reads "don't use" | Empty 200 | None found. The scrape loop calls the scraper in-process, not over HTTP |
| 27 | `/kmaStnPastHourly` | [#L244-L260](../../server/routes/v000001/routeGather.js#L244-L260) | Scraper `getStnPastHourlyWeather(8)` | Empty 200 | **Dead:** the Manager call is commented out ([#L2348](../../server/controllers/controllerManager.js#L2348)) |
| 28 | `/kmaStnMinute` | [#L262-L278](../../server/routes/v000001/routeGather.js#L262-L278) | Scraper `getStnMinuteWeather` | Empty 200 | None found (in-process scrape loop only) |
| 29 | `/updateStnRnsHitRate` | [#L280-L291](../../server/routes/v000001/routeGather.js#L280-L291) | Scraper `updateRnsHitRates` | Empty 200 | Manager ([#L2245](../../server/controllers/controllerManager.js#L2245)) |
| 30 | `/invalidateCloudFront/:items` | [#L293-L314](../../server/routes/v000001/routeGather.js#L293-L314) | **CloudFront invalidation** through `manager.deleteCacheOnCloudFront`, with `config.aws` region, API version and distribution id. Only `:items = ALL` adds a path (`/town/*`); any other value sends an empty list | Empty 200 | **Dead:** the Manager call is commented out ([#L2253](../../server/controllers/controllerManager.js#L2253)) |
| 31 | `/gatherKasiRiseSet` | [#L316-L324](../../server/routes/v000001/routeGather.js#L316-L324) | KASI sunrise/sunset API through `gatherAreaRiseSetFromApi`, then DB update | JSON result, or 500 with the error | Manager ([#L2260](../../server/controllers/controllerManager.js#L2260)) |
| 32 | `/updateInvalidt1h` | [#L326-L334](../../server/routes/v000001/routeGather.js#L326-L334) | `updateInvalidT1hData(9, key)` | Empty 200 | **Dead:** the Manager call is commented out ([#L2271](../../server/controllers/controllerManager.js#L2271)) |

### Legacy domestic town routers (20 registrations)

These chains are described once, in [chain differences](#chain-differences-for-legacy-contracts). Every `GET /` usage row returns `{usage: [six strings]}`. `getSummary` runs first there, but no code assigns `req.summary` (`grep -rn "req\.summary *=" server/controllers server/routes` returns 0 matches), so the `summary` key never appears.

**`v000001/routeTownForecast.js`** uses `ControllerTown`, mounted at `/town` and `/v000001/town`.

| # | Route | Source | Chain and response | Consumers | 30-day traffic |
| ---: | --- | --- | --- | --- | --- |
| 33 | `GET /` | [#L16-L38](../../server/routes/v000001/routeTownForecast.js#L16-L38) | Usage JSON | None found | `/town`: not measured. `/v000001/town`: 0 (in scope) |
| 34 | `GET /:region` | [#L40-L43](../../server/routes/v000001/routeTownForecast.js#L40-L43) | 13 items with no `getAllDataFromDb` or parameter validation. Sent by [`ControllerTown.sendResult`](../../server/controllers/controllerTown.js#L3335-L3432), which builds `{regionName, cityName, townName, short…, current, midData}` and fills sentinel defaults into `current` and `midData` at send time. At `bd6640f2` it passes `short` through the history projection `hourlyResponse` and copies `historyStatus` when set ([L3349](../../server/controllers/controllerTown.js#L3349), [L3361](../../server/controllers/controllerTown.js#L3361)). No v000001 chain includes `mergeCurrentByStnHourly`, the only stage that loads history ([L1296-L1303](../../server/controllers/controllerTown.js#L1296-L1303)), so `historyStatus` never appears here (source analysis). `mergeMidWithShort` now also adds `midData.dailyStatus` and drops incomplete daily rows ([additions](client-data-contracts.md#domestic-response-additions-at-bd6640f2)) | None found | As row 33 |
| 35 | `GET /:region/:city` | [#L45-L48](../../server/routes/v000001/routeTownForecast.js#L45-L48) | Same list as row 34 | None found | As row 33 |
| 36 | `GET /:region/:city/:town` | [#L50-L55](../../server/routes/v000001/routeTownForecast.js#L50-L55) | 17 items, including `getAllDataFromDb`, station hourly merge, life index and `getKeco`. No sky-icon stage | **Unshipped snapshot:** the Apple Watch bundled web project calls `/town/<first>/<second>/<third>` at a hard-coded URL. No Gulp task builds it ([native consumers](native-consumers-and-plugins.md#1-consumer-inventory)) | As row 33 |
| 37 | `GET /:region/:city/:town/mid` | [#L57-L58](../../server/routes/v000001/routeTownForecast.js#L57-L58) | Mid-range stages only. `ControllerTown.sendResult` reads `req.current.t1h` and `req.midData.pubDate` without guards. Only `getCurrent`, `getKeco` and the station merges create `req.current`, and only `getMid`, `getPastMid` and `mergeMidWithShort` create `req.midData` (at `ff7acf39` `getMidRss` did too; since `95fe711e` it is a pass-through, [L2026-L2029](../../server/controllers/controllerTown.js#L2026-L2029)). This chain has no `current` stage, so **every request throws into the error sink** (HTML 500; source analysis at `bd6640f2`, not executed) | None found | As row 33 |
| 38 | `GET /:region/:city/:town/short` | [#L60](../../server/routes/v000001/routeTownForecast.js#L60) | Short stages only. No `current` or mid stage, so it always throws as in row 37 | None found | As row 33 |
| 39 | `GET /:region/:city/:town/shortest` | [#L62](../../server/routes/v000001/routeTownForecast.js#L62) | Shortest only. Always throws as in row 37 | None found | As row 33 |
| 40 | `GET /:region/:city/:town/current` | [#L64](../../server/routes/v000001/routeTownForecast.js#L64) | `getCurrent`, `getKeco`, `dataToFixed`, `sendResult`. No mid stage, so it always throws on `req.midData` as in row 37 | None found | As row 33 |

**`v000705/routeTownForecast.js`** uses `ControllerTown24h` ([#L8-L10](../../server/routes/v000705/routeTownForecast.js#L8-L10)), mounted at `/v000705/town`.

Every weather route here ends `…, dataToFixed, sendResult` **without `makeResult`**. `ControllerTown24h.sendResult` is `res.json(req.result)` ([controllerTown24h.js#L1702-L1705](../../server/controllers/controllerTown24h.js#L1702-L1705)). Only `makeResult` creates `req.result` (`grep -n "req.result" server/controllers/controllerTown24h.js server/controllers/controllerTown.js` shows no other assignment). The weather routes therefore answer HTTP 200 with an empty body. This has been true since commit `3b88dc2b` (2017-11-12, historical source), which split `sendResult` from `makeResult`, and that commit is an ancestor of the deployed `5bca407` checkout. The empty-body outcome is a library-semantics analysis of Express 4.13 `res.json(undefined)`; it was not executed. The deployed host's config and logger edits were not compared.

| # | Route | Source | Chain and response | Consumers | 30-day traffic |
| ---: | --- | --- | --- | --- | --- |
| 41 | `GET /` | [#L19-L41](../../server/routes/v000705/routeTownForecast.js#L19-L41) | Usage JSON | None found | `/v000705/town/{location}` 12 in total (11 × 200, 1 × 502; all 12 Android-like). The report normalizes the location segments, so this total covers rows 41–48 |
| 42 | `GET /:region` | [#L43-L50](../../server/routes/v000705/routeTownForecast.js#L43-L50) | 27 items, then empty 200 | None found in current source. Old Android builds or the [external Android widget](native-consumers-and-plugins.md#1-consumer-inventory) are candidates (unverified) | See row 41 |
| 43 | `GET /:region/:city` | [#L52-L59](../../server/routes/v000705/routeTownForecast.js#L52-L59) | Same as row 42 | As row 42 | See row 41 |
| 44 | `GET /:region/:city/:town` | [#L65-L72](../../server/routes/v000705/routeTownForecast.js#L65-L72) | Same as row 42 | As row 42 | See row 41 |
| 45 | `GET /:region/:city/:town/mid` | [#L77-L80](../../server/routes/v000705/routeTownForecast.js#L77-L80) | 13 items, then empty 200 | None found | See row 41 |
| 46 | `GET /:region/:city/:town/short` | [#L82-L85](../../server/routes/v000705/routeTownForecast.js#L82-L85) | 13 items, then empty 200 | None found | See row 41 |
| 47 | `GET /:region/:city/:town/shortest` | [#L87-L88](../../server/routes/v000705/routeTownForecast.js#L87-L88) | 7 items, then empty 200 | None found | See row 41 |
| 48 | `GET /:region/:city/:town/current` | [#L90-L92](../../server/routes/v000705/routeTownForecast.js#L90-L92) | 13 items, then empty 200 | None found | See row 41 |

**`v000803/routeTownForecast.js`** uses `ControllerTown24h`, mounted at `/v000803/town`. The four `/mid`, `/short`, `/shortest` and `/current` registrations at [#L64-L79](../../server/routes/v000803/routeTownForecast.js#L64-L79) are commented out and are not counted.

| # | Route | Source | Chain and response | Consumers | 30-day traffic |
| ---: | --- | --- | --- | --- | --- |
| 49 | `GET /` | [#L19-L41](../../server/routes/v000803/routeTownForecast.js#L19-L41) | Usage JSON | None found | `/v000803/town/{location}` 205 in total (146 × 200, 15 × 304, 44 × 502; 29 Apple-like, 176 Android-like). This total covers rows 49–52 |
| 50 | `GET /:region` | [#L55](../../server/routes/v000803/routeTownForecast.js#L55) | 31-item `routerList` ([#L47-L53](../../server/routes/v000803/routeTownForecast.js#L47-L53)) ending `makeResult`, `sendResult`: the `makeResult` envelope with CamelCase icons, no unit conversion, no `airInfo`/`airInfoList`, no `location` and no `specialInfo` ([differences](#legacy-town-chains-versus-v000903-kma)) | **Internal:** `/v000803/nation` fans out to `/v000803/town/...` because versions below `v000901` use `/town` ([route.nation.js#L32-L43](../../server/routes/v000803/route.nation.js#L32-L43)). **Unshipped snapshot:** bundled `tw.ios/www` `getTownWeatherInfo` ([service.weatherutil.js#L291-L300](../../tw.ios/www/js/service.weatherutil.js#L291-L300)); whether that tree ships is unverified. **Historical:** in-repo Android widget `kmaApiUrl = "/v000803/town"` (`git show 033409ff^:android/src/net/wizardfactory/todayweather/widget/WidgetUpdateService.java`, L56). **External (unverified):** Android widget plugins | See row 49. `/v000803/nation` had 0 requests, so the fan-out does not explain this traffic |
| 51 | `GET /:region/:city` | [#L57](../../server/routes/v000803/routeTownForecast.js#L57) | Same as row 50 | As row 50 | See row 49 |
| 52 | `GET /:region/:city/:town` | [#L59](../../server/routes/v000803/routeTownForecast.js#L59) | Same as row 50 | As row 50 | See row 49 |

### Daily summary: `v000705/dailySummary.js` (2 registrations)

Mounted at `/daily` under v000705, v000803, v000901, v000902 and v000903.

| # | Route | Source | Params | Chain and response | Consumers | 30-day traffic |
| ---: | --- | --- | --- | --- | --- | --- |
| 53 | `GET /town/*` | [#L27-L34](../../server/routes/v000705/dailySummary.js#L27-L34) | `divideParams` splits the wildcard into `region/city/town` ([#L18-L24](../../server/routes/v000705/dailySummary.js#L18-L24)). No query, parameter or unit validation | 27 items (`divideParams` plus 26 `ControllerTown24h` methods), ending `getSummary`, `dataToFixed`, `makeDailySummary`, `sendDailySummaryResult`. Response `{regionName, cityName, townName, dailySummary}` ([controllerTown24h.js#L1265-L1286](../../server/controllers/controllerTown24h.js#L1265-L1286)) | None found in current source. **Historical:** a 2016 local-notification alarm stored `Util.url + '/daily/town'` as notification data; it was added in `4c07c6cc` (2016-04-30) and removed in `1e3cd4cb` (2016-05-05) (`git log --all -G "daily/town" -- client/www/js` lists these two and the branch commit `01de6419`) | 0 (in scope), all five prefixes |
| 54 | `GET /geo/:lat/:lon` | [#L36-L38](../../server/routes/v000705/dailySummary.js#L36-L38) | `lat`, `lon` (unused) | **Empty handler that never responds.** The connection stays open until a client or proxy timeout; nginx and CloudFront timeouts were not checked | None found | 0 (in scope) |

### KMA routers v000901, v000902 and v000903 (15 registrations)

**Request contract (all weather rows below).** Path parameters are Korean administrative names (`:region/:city/:town`) or `:loc = <lat>,<lon>`. `checkQueryValidation` defaults the query ([controllerTown24h.js#L31-L71](../../server/controllers/controllerTown24h.js#L31-L71)):

| Query key | Default |
| --- | --- |
| `temperatureUnit` | `C` |
| `windSpeedUnit` | `m/s` |
| `pressureUnit` | `hPa` |
| `distanceUnit` | `km` |
| `precipitationUnit` | `mm` |
| `airUnit` | `airkorea` |
| `airForecastSource` | `airkorea` |

A key that is absent or has the literal value `(null)` gets its default ([unit defaults](../../server/lib/unitConverter.js#L274-L285)). `checkQueryValidation` also sets `req.version` from the mount.

**Existing coverage, not repeated here:**

- **Stages, location resolution and envelope:** [server response assembly](server-response-assembly.md) §1–§4 ([location resolution](server-response-assembly.md#location-resolution-ordered), [envelope and failures](server-response-assembly.md#4-domestic-response-envelope-and-failures)). A location resolved outside Korea gets a 302 to the gateway.
- **v000901/v000902 differences from v000903 and their callers:** [mounted version variants and callers](server-response-assembly.md#7-mounted-version-variants-and-callers).

All `GET /` rows return the same usage JSON as the town routers.

| # | Route | Source | Chain and response | Consumers | 30-day traffic |
| ---: | --- | --- | --- | --- | --- |
| 55 | `GET /v000901/kma/addr/` | [route.kma.addr.js#L21-L43](../../server/routes/v000901/route.kma.addr.js#L21-L43) | Usage JSON | None found | 0 (in scope) |
| 56 | `GET /v000901/kma/addr/:region` | [#L62](../../server/routes/v000901/route.kma.addr.js#L62) | 36-item v000901 list: singular `airInfo`, CamelCase icons, no `specialInfo` ([§7](server-response-assembly.md#middleware-differences)) | **Widget:** `processKRAddress` for a KR city without coordinates ([TodayViewController.m#L2296-L2318](../../tw.ios/widget/TodayViewController.m#L2296-L2318)). **Gateway:** default version for unversioned `/weather/coord` (deployment observation). **Internal:** `/v000901/nation` fan-out | `/v000901/kma/addr/{location}` 1,853 in total (1,461 × 200, 214 × 304, 172 × 502, 6 × 000; 454 Apple-like, 1,399 Android-like), covering rows 56–58. Gateway calls to the origin are not in this count |
| 57 | `GET /v000901/kma/addr/:region/:city` | [#L64](../../server/routes/v000901/route.kma.addr.js#L64) | As row 56 | As row 56 | See row 56 |
| 58 | `GET /v000901/kma/addr/:region/:city/:town` | [#L66](../../server/routes/v000901/route.kma.addr.js#L66) | As row 56 | As row 56 | See row 56 |
| 59 | `GET /v000902/kma/` | [route.kma.v000902.js#L21-L43](../../server/routes/v000902/route.kma.v000902.js#L21-L43) | Usage JSON | None found | 0 (in scope) |
| 60 | `GET /v000902/kma/addr/:region` | [#L62](../../server/routes/v000902/route.kma.v000902.js#L62) | 36-item v000902 list: singular `airInfo`, lower-case icons, no `specialInfo` | **Worker:** alarm for address-only records ([controllerPush.js#L667-L711](../../server/controllers/controllerPush.js#L667-L711)) and the alert worker ([alert.push.controller.js#L56-L102](../../server/controllers/alert.push.controller.js#L56-L102)). **Gateway:** for `/weather/v000902/coord` (deployment observation). **Unshipped snapshot:** bundled `ta.ios/www` ([service.weatherutil.js#L130](../../ta.ios/www/js/service.weatherutil.js#L130)). **Internal:** `/v000902/nation` fan-out | 0 (in scope). Worker and gateway calls do not pass CloudFront |
| 61 | `GET /v000902/kma/addr/:region/:city` | [#L64](../../server/routes/v000902/route.kma.v000902.js#L64) | As row 60 | As row 60 | 0 (in scope) |
| 62 | `GET /v000902/kma/addr/:region/:city/:town` | [#L66](../../server/routes/v000902/route.kma.v000902.js#L66) | As row 60 | As row 60 | 0 (in scope) |
| 63 | `GET /v000902/kma/coord/:loc` | [#L68-L70](../../server/routes/v000902/route.kma.v000902.js#L68-L70) | `coord2addr` prepended (37 items). It calls `${API_SERVER}/geocode/coord/<loc>` | **Worker:** alarm and alert coordinate requests (same sources as row 60) | 0 (in scope) |
| 64 | `GET /v000903/kma/` | [route.kma.v000903.js#L21-L43](../../server/routes/v000903/route.kma.v000903.js#L21-L43) | Usage JSON | None found | 0 (in scope) |
| 65 | `GET /v000903/kma/addr/:region` | [#L62](../../server/routes/v000903/route.kma.v000903.js#L62) | 37-item reference list ([appendix](server-response-assembly.md#kma-v000903)) | **App:** stored address without coordinates ([service.weatherutil.js#L129-L140](../../client/www/js/service.weatherutil.js#L129-L140)). **Gateway:** `/weather/v000903/coord` with a KR result (deployment observation). **Web PWA:** indirectly, through the same gateway path with canonical units ([direct-api.ts#L173-L183](../../web/src/direct-api.ts#L173-L183)). **Internal:** `/v000903/nation` fan-out | `/v000903/kma/addr/{location}` 1,320 in total (all 200), covering rows 65–67. It equals 88 origin-reaching nation requests × 15 ([§6](server-response-assembly.md#6-nationwide-screens-regional-air-plus-http-fan-out)) |
| 66 | `GET /v000903/kma/addr/:region/:city` | [#L64](../../server/routes/v000903/route.kma.v000903.js#L64) | As row 65 | As row 65 | See row 65 |
| 67 | `GET /v000903/kma/addr/:region/:city/:town` | [#L66](../../server/routes/v000903/route.kma.v000903.js#L66) | As row 65 | As row 65 | See row 65 |
| 68 | `GET /v000903/kma/coord/:loc` | [#L68-L70](../../server/routes/v000903/route.kma.v000903.js#L68-L70) | `coord2addr` + 37 items | None found. The app and the Web PWA send coordinates through the gateway, and the workers use v000902 | 0 (in scope) |
| 69 | `GET /v000903/kma/special` | [#L72-L83](../../server/routes/v000903/route.kma.v000903.js#L72-L83) | Current warning list as JSON with **`Cache-Control: max-age=300`**; 501 text on error ([§8](server-response-assembly.md#8-weather-warnings)) | **App:** S12 warnings screen ([controller.kma.special.js#L17](../../client/www/js/controller.kma.special.js#L17)). **Web PWA:** warnings view, no query ([direct-api.ts#L194-L204](../../web/src/direct-api.ts#L194-L204)) | 36 (27 × 200, 2 × 304, 7 × 502) |

### DSF coordinate routers (2 registrations)

The shared request contract works as follows:

1. `ctrlUnits.checkQueryValidation` defaults the six unit keys, without `airForecastSource`.
2. `convertParamAndQuery` sets `category=current`, `days=2`, `gcode=:loc` and `aqi=airUnit`.

Request-time provider calls, cache writes and the world envelope are described in [world weather](server-response-assembly.md#5-world-weather-request-time-cache-fill-then-merge).

| # | Route | Source | Chain | Side effects | Consumers | 30-day traffic |
| ---: | --- | --- | --- | --- | --- | --- |
| 70 | `GET /v000901/dsf/coord/:loc` | [route.dsf.coord.js#L33-L37](../../server/routes/v000901/route.dsf.coord.js#L33-L37) | 13 items, with no `skyIconLowCase` (CamelCase icons) | DSF and WAQI provider calls on a cache miss, plus DB writes | **Gateway:** default version for unversioned non-KR `/weather/coord` (deployment observation). **Internal (inference):** the out-of-Korea 302 from the KMA chains, followed by an unknown client | 0 (in scope) |
| 71 | `GET /:loc` at `/v000902/dsf/coord` and `/v000903/dsf/coord` | [route.dsf.coord.v000902.js#L81-L85](../../server/routes/v000902/route.dsf.coord.v000902.js#L81-L85) | 14-item reference list ([appendix](server-response-assembly.md#dsf-v000902-handler-mounted-by-v000903)) | As row 70 | **Gateway:** `/weather/v000903/coord` and `/weather/v000902/coord` with non-KR results. **Web PWA:** indirectly, through `/weather/v000903/coord` for non-KR catalog or searched places. **Worker:** alarm DSF request ([controllerPush.js#L896-L900](../../server/controllers/controllerPush.js#L896-L900)) and alert `/v000902/<source>/coord`. Row 73 redirects here | 0 (in scope) at both prefixes |

### Geo routers (2 registrations)

| # | Route | Source | Params and query | Chain and response | Side effects | Consumers | 30-day traffic |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 72 | `GET /:lat/:lon` at `/v000803/geo`, `/v000901/geo`, `/v000902/geo` | [route.geo.js#L77-L118](../../server/routes/v000803/route.geo.js#L77-L118) | Query `country`, `address`, `name`, `lang` (else the first `Accept-Language` subtag), `kma_region`/`kma_city`/`kma_town` ([geo.controller.js#L504-L529](../../server/controllers/geo.controller.js#L504-L529)) | `location2address` resolves the country and address, then runs one of two lists. **KR:** 29 `ControllerTown24h` items ([#L26-L32](../../server/routes/v000803/route.geo.js#L26-L32)) with CamelCase `insertSkyIcon`, `getSummary`, no unit conversion and no `airInfo`. **Other countries:** an 8-item legacy world list using `queryTwoDaysWeather`, not the NewForm variant ([#L34-L36](../../server/routes/v000803/route.geo.js#L34-L36)). The JSON `req.result` carries `location: {lat, lon}` as the raw path strings, not the numeric `{lat, long}` of v000901+ `makeResult`, plus `country`, `address` and `name`. `ko` + KR without a KMA address → error sink | Kakao and Google geocoding provider calls, each skipped only when the query already supplies the value it would fill (`country`, the `kma_*` address, `address`, `name`) ([geo.controller.js#L539-L642](../../server/controllers/geo.controller.js#L539-L642)). Config names `keyString.kakao_keys` (Kakao, [#L20](../../server/controllers/geo.controller.js#L20), [#L198-L206](../../server/controllers/geo.controller.js#L198-L206)) and `keyString.google_key`; `keyString.daum_keys` is parsed at load but the Daum call is commented out. See [external providers](external-providers.md) | None found | 0 (in scope) |
| 73 | `GET /v000903/geo/:loc` | [route.geo.v000903.js#L47-L79](../../server/routes/v000903/route.geo.v000903.js#L47-L79) | `:loc = <lat>,<lon>`. The query is **not** carried into the redirect | `GET ${API_SERVER}/geocode/coord/<loc>` (3 attempts × 3 s), then 302 to the relative `../dsf/coord/<loc>` (non-KR) or `../kma/addr/<name1>[/<name2>[/<name3>]]` (KR). Geocoder failure or a KR result without `kmaAddress` → error sink | One gateway geocoder request per call | None found | 0 (in scope) |

### Nation: `v000803/route.nation.js` (1 registration)

| # | Route | Source | Chain and response | Side effects | Consumers | 30-day traffic |
| ---: | --- | --- | --- | --- | --- | --- |
| 74 | `GET /:nation` at `/v000803/nation`, `/v000901/nation`, `/v000902/nation`, `/v000903/nation` | [#L150-L166](../../server/routes/v000803/route.nation.js#L150-L166) | `checkQueryValidation`, `getSidoArpltn`, `getWeather`. Response `{nation:'KR', weather?, air?}`, or 501 text when both are missing. Details: [nationwide screens](server-response-assembly.md#6-nationwide-screens-regional-air-plus-http-fan-out) | 15 HTTP child requests per call to `API_SERVER`. The target is `/<version>/kma/addr/...` for v000901 and later, and `/v000803/town/...` for v000803 ([#L32-L43](../../server/routes/v000803/route.nation.js#L32-L43)) | **App:** `/v000903/nation/KR` ([service.weatherutil.js#L906](../../client/www/js/service.weatherutil.js#L906)). **Web PWA:** `/v000903/nation/KR` with canonical units, the selected `airUnit` and `airForecastSource=kaq` ([direct-api.ts#L185-L193](../../web/src/direct-api.ts#L185-L193)). **Unshipped snapshot:** `ta.ios/www` `/v000902/nation` ([#L892](../../ta.ios/www/js/service.weatherutil.js#L892)) | `/v000903/nation/KR` 139 (102 × 200, 25 × 304, 12 × 502). `/v000901/nation/KR` 1 (502). v000902 and v000803: 0 (in scope) |

### Push, push-list and purchase (5 registrations)

The app contracts, the token-refresh 403 branch and CloudFront routing are covered in [push notifications](../architecture/push-notifications.md#app-settings-and-api-contracts). Message composition and receipt validation are in [push text and purchase validation](server-push-and-purchase.md). CloudFront's `/*/push` and `/*/push-list` behaviors send these paths straight to the service origin, and the report does count them. Under `/v000803`, rows 75 and 79 are behind the POST gate.

**Changed upstream, same routes.** Rows 75–78 construct `ControllerPush` per request ([routePushNotification.js#L95](../../server/routes/v000705/routePushNotification.js#L95), [route.push.update.list.js#L46](../../server/routes/v000902/route.push.update.list.js#L46)). At `ff7acf39` loading that module built an APNs provider, and the constructor initialized both Firebase apps from files, retrying on every construction while a file was missing (the error was only logged). Since `c80ee014` and `45b2eb3f` (2026-09-24), the module builds no APNs provider and the constructor reads no Firebase file; module load still creates the legacy `node-gcm` sender object from `config.push.gcmAccessKey` ([controllerPush.js#L7-L35](../../server/controllers/controllerPush.js#L7-L35)). Firebase is initialized lazily on the first FCM send from the two product Firebase service-account files under `server/config` ([pushProviders.js#L6-L17](../../server/lib/pushProviders.js#L6-L17)). Direct APNs delivery and its `APN_*` configuration are removed. The request/response contracts of rows 75–78 are unchanged. Delivery changes are in [push notifications](../architecture/push-notifications.md#provider-submission-and-app-handling).

| # | Route | Source | Behavior | Side effects | Consumers | 30-day traffic |
| ---: | --- | --- | --- | --- | --- | --- |
| 75 | `POST /` at `/v000705/push`, `/v000803/push`, `/v000901/push`, `/v000902/push`, `/v000903/push` | [routePushNotification.js#L23-L105](../../server/routes/v000705/routePushNotification.js#L23-L105) | Legacy single-record registration. The language comes from the first `Accept-Language` tag (default `en`). 403 text on a body parse error, 500 text on a DB error, JSON result otherwise | Writes an alarm record (`ControllerPush.updatePushInfo`) | **App:** none; the current app uses row 78. **Unshipped snapshot:** `tw.ios/www` posts to `/v000705/push` ([service.push.js#L26](../../tw.ios/www/js/service.push.js#L26), [#L88](../../tw.ios/www/js/service.push.js#L88)) | `POST /v000705/push` 12 (all 500, all Android-like). Other prefixes: 0 (in scope) |
| 76 | `PUT /` at the same five prefixes | [#L109-L152](../../server/routes/v000705/routePushNotification.js#L109-L152) | Replaces an FCM token or legacy registration-ID pair. `invalid body` → 403 | Updates the alarm and alert collections | **App:** `/v000902/push` ([service.push.js#L296-L298](../../client/www/js/service.push.js#L296-L298), [#L326-L328](../../client/www/js/service.push.js#L326-L328)). **Unshipped snapshot:** `tw.ios/www` `/v000705/push` ([#L142](../../tw.ios/www/js/service.push.js#L142)) | `PUT /v000902/push` 18,872 (16,337 × 403, 1,834 × 502, 694 × 200, 7 × 000). Others: 0 (in scope) |
| 77 | `DELETE /` at the same five prefixes | [#L158-L212](../../server/routes/v000705/routePushNotification.js#L158-L212) | Removes settings by token, with truthiness-based narrowing ([caveat](../architecture/push-notifications.md#app-settings-and-api-contracts)). 403 or 501 text on errors | Deletes alarm and/or alert records | **App:** `/v000902/push` ([service.push.js#L271-L273](../../client/www/js/service.push.js#L271-L273)). **Unshipped snapshot:** `tw.ios/www` ([#L117](../../tw.ios/www/js/service.push.js#L117)) | `DELETE /v000902/push` 2 (200). Others: 0 (in scope) |
| 78 | `POST /` at `/v000902/push-list`, `/v000903/push-list` | [route.push.update.list.js#L75-L141](../../server/routes/v000902/route.push.update.list.js#L75-L141) | Batch upload of alarm and alert settings. 403, the error's `statusCode`, or 501 on failure | Writes alarm (`updatePushInfo`) and alert (`updateAlertPush`) records | **App:** `/v000902/push-list` ([service.push.js#L243-L245](../../client/www/js/service.push.js#L243-L245)) | `POST /v000902/push-list` 2,525 (2,313 × 200, 209 × 502, 1 × 408, 2 × 000). v000903: 0 (in scope) |
| 79 | `POST /` at `/v000705/check-purchase` … `/v000903/check-purchase` | [receiptValidation.js#L81](../../server/routes/v000705/receiptValidation.js#L81) | Receipt validation; the app must read `ok`, not the HTTP status ([envelope](server-push-and-purchase.md#55-response-envelope-and-http-status)) | Apple and Google store validation through the `in-app-purchase` library | **App:** `/v000705/check-purchase` ([controller.purchase.alexdisler.js#L46](../../client/www/js/controller.purchase.alexdisler.js#L46), [controller.purchase.j3k0.js#L113](../../client/www/js/controller.purchase.j3k0.js#L113)) | 0 (in scope) at all five prefixes |

### Test routes: `v000803/route.test.js` (4 registrations)

The four test routes are mounted at `/test` under v000803, v000901, v000902 and v000903 (16 combinations), with no authentication.

| # | Route | Source | Behavior | Side effects | Consumers | 30-day traffic |
| ---: | --- | --- | --- | --- | --- | --- |
| 80 | `GET /stnWeatherHourly/*` | [#L24](../../server/routes/v000803/route.test.js#L24) | `divideParams` → town lookup → nearest-station hourly observations as JSON; 500 text on error ([route.test.controller.js#L12-L91](../../server/controllers/route.test.controller.js#L12-L91)) | DB reads only | None found | 0 (in scope) |
| 81 | `GET /stnWeatherMinute/*` | [#L25](../../server/routes/v000803/route.test.js#L25) | Same for minute observations ([#L93-L161](../../server/controllers/route.test.controller.js#L93-L161)) | DB reads only | None found | 0 (in scope) |
| 82 | `GET /special` | [#L29-L38](../../server/routes/v000803/route.test.js#L29-L38) | `gatherSpecialWeatherSituation`; the result, or 501 text | **KMA special-weather scrape and DB update** ([kmaScraper.js#L1735-L1790](../../server/lib/kmaScraper.js#L1735-L1790)) | None found | 0 (in scope) |
| 83 | `GET /gatherKasiRiseSet` | [#L42-L50](../../server/routes/v000803/route.test.js#L42-L50) | Same work as row 31; 500 with `err.message` | **KASI provider calls and DB update** | None found | 0 (in scope) |

### Legacy world routers: `/ww` and `/req` (6 registrations)

Both are unversioned, so none of these rows is measured by the traffic report.

| # | Route | Source | Params and query | Chain and response | Side effects | Consumers |
| ---: | --- | --- | --- | --- | --- | --- |
| 84 | `GET /ww/` | [routeWeather.js#L14-L16](../../server/routes/worldweather/routeWeather.js#L14-L16) | None | Index HTML page | None | None found |
| 85 | `GET /ww/:version` | [#L18](../../server/routes/worldweather/routeWeather.js#L18) | `version` must be `010000`; optional `command` | `checkApiVersion`, `checkCommand`, `showUsage`, `sendResult`. A wrong version → HTTP 200 with a JSON error string. With `010000`, `sendResult` reads `req.result.thisTime.length` on a usage-only result, so it throws into the error sink ([controllerWorldWeather.js#L89-L111](../../server/controllers/worldWeather/controllerWorldWeather.js#L89-L111); source analysis). `command=renew_geocode_list` calls `loadGeocodeList(req, fn)`, whose signature is `(callback)` ([#L1037-L1060](../../server/controllers/worldWeather/controllerWorldWeather.js#L1037-L1060), [#L2998](../../server/controllers/worldWeather/controllerWorldWeather.js#L2998)), so `next()` is never called | Geocode-list DB read (`renew_geocode_list`) | None found |
| 86 | `GET /ww/:version/:category` | [#L19-L21](../../server/routes/worldweather/routeWeather.js#L19-L21) | `category` ∈ `current`, `forecast` ([#L21](../../server/controllers/worldWeather/controllerWorldWeather.js#L21)); `gcode=<lat>,<lon>` or `city`; `country` | Legacy `queryWeather` reads MET, OWM, WU and DSF documents from the DB, then runs the WU/DSF merges and `sendResult`. The response shape was not characterized | An unknown geocode triggers self-HTTP to `config.url.requester` + `req/all/req_add/?key=<hard-coded literal at controllerWorldWeather.js#L3341>` (row 89): a geocode DB write plus WU/DSF provider fetches ([#L231](../../server/controllers/worldWeather/controllerWorldWeather.js#L231), [#L3336-L3360](../../server/controllers/worldWeather/controllerWorldWeather.js#L3336-L3360)) | None found |
| 87 | `GET /ww/:version/:category/:days` | [#L23-L27](../../server/routes/worldweather/routeWeather.js#L23-L27) (commented "temporary") | As row 86. `:days` is never read (`grep -rn "params.days" server/controllers server/routes` finds only the two DSF adapters that set it). **No unit query validation** | 9 items ending in the world `sendResult`. Compared with row 71: no unit conversion, CamelCase icons and no `airInfo`/summary ([differences](#ww-versus-the-v000902-dsf-chain)). Invalid version, or neither `gcode` nor `city` → 400 text. Invalid category → `queryTwoDaysWeatherNewForm` skips the fill, and `dataSort` then reads `req.result.thisTime` with no `req.result`, so the request throws into the error sink ([controllerWorldWeather.js#L705-L707](../../server/controllers/worldWeather/controllerWorldWeather.js#L705-L707), [#L2129-L2133](../../server/controllers/worldWeather/controllerWorldWeather.js#L2129-L2133); source analysis) | The same request-time DSF/WAQI fill as rows 70–71 | **Dead:** iOS widget `WORLD_API_URL` ([unreachable](native-consumers-and-plugins.md#11-unreachable-and-historical-paths-inside-the-ios-widget-source)). **Unshipped snapshot:** `tw.ios/www` `getGeoWeatherInfo` ([service.weatherutil.js#L267-L289](../../tw.ios/www/js/service.weatherutil.js#L267-L289)); whether that tree ships is unverified. **Historical:** in-repo Android widget `worldWeatherApiUrl` (`033409ff^`, `WidgetUpdateService.java` L57). **External (unverified):** Android widget plugins |
| 88 | `GET /req/` | [routeRequester.js#L22-L24](../../server/routes/worldweather/routeRequester.js#L22-L24) | None | Index HTML page | None | None found |
| 89 | `GET /req/:category/:command` | [#L26](../../server/routes/worldweather/routeRequester.js#L26) | `category` ∈ `all`, `met`, `owm`, `wu`, `dsf`; `command` ∈ `get_all`, `get`, `req_add`, `req_two_days`, `add_key` ([controllerRequester.js#L14-L15](../../server/controllers/worldWeather/controllerRequester.js#L14-L15)); `key` (any value, or none; see [auth](#authentication-and-gating)); `gcode`, `country`, `city`, `timezone`; `key_type`, `ckey`, `key_id` for `add_key` | Invalid pair → `{status:'Fail'}`. The commands: `get_all` → `{status:'OK'}` with no work, because its collector branch needs category `WU` and validation accepts only lower-case `wu`. `get` → never calls `next()`, so the request is never answered. `req_add` → `addNewLocation`. `req_two_days` → `reqDataForTwoDays`. `add_key` → `Fail` unless `global.collector` exists. Only the legacy collector's `doCollect()` sets it, and startup does not invoke that ([weather collection](../architecture/weather-collection.md)) ([controllerRequester.js#L31-L125](../../server/controllers/worldWeather/controllerRequester.js#L31-L125)) | `req_add`: geocode DB write, then WU and DSF provider requests ([#L366-L542](../../server/controllers/worldWeather/controllerRequester.js#L366-L542)). `req_two_days`: WU, DSF and AQI provider requests ([#L544-L653](../../server/controllers/worldWeather/controllerRequester.js#L544-L653)) | **Internal:** row 86 self-HTTP for unknown geocodes |

## Chain differences for legacy contracts

These tables compare registration lists (source observation). The consequences column is source analysis and was not executed. The v000901 and v000902 KMA/DSF variants are compared with v000903 in [mounted version variants and callers](server-response-assembly.md#7-mounted-version-variants-and-callers); they are not repeated here.

### `/ww` versus the v000902 DSF chain

Row 87 (`/ww/:version/:category/:days`, 9 items, [routeWeather.js#L24-L27](../../server/routes/worldweather/routeWeather.js#L24-L27)) compared with row 71 (v000902 DSF, 14 items, [route.dsf.coord.v000902.js#L81-L85](../../server/routes/v000902/route.dsf.coord.v000902.js#L81-L85)):

| v000902 DSF item | In `/ww/.../:days` | Consequence for a `/ww` caller |
| --- | --- | --- |
| 1 `ctrlUnits.checkQueryValidation` | Absent | Unit keys are not defaulted. `airUnit` stays absent unless sent |
| 2 `convertParamAndQuery` | Absent. `checkApiVersion` is first instead | The caller supplies `010000`, the category (`current` or `forecast`) and `gcode=<lat>,<lon>`. The `aqi` alias that item 2 sets has no reader (`grep -rn 'query\.aqi\b' server/controllers server/routes server/lib` finds only the two assignments) |
| 3–7 `queryTwoDaysWeatherNewForm`, `convertDsfLocalTime`, `mergeDsfDailyData`, `mergeDsfCurrentDataNewForm`, `mergeDsfHourlyData` | Same | Same request-time DSF/WAQI cache fill and merge |
| 8 `mergeAqi` | Same | Without `airUnit`, the AQI grade uses the `aqicn` index branch ([controllerWorldWeather.js#L2020-L2087](../../server/controllers/worldWeather/controllerWorldWeather.js#L2020-L2087)) |
| 9 `dataSort` | Same | — |
| 10 `skyIconLowCase` | Absent | **CamelCase** `skyIcon` in `thisTime`, `hourly` and `daily` |
| 11 `ctrlUnits.convertUnits` | Absent | **No unit conversion**, and none of the fields that `convertUnits` and its row converters add ([controller.ww.units.js#L37-L87](../../server/controllers/worldWeather/controller.ww.units.js#L37-L87), [#L170-L336](../../server/controllers/worldWeather/controller.ww.units.js#L170-L336)): `thisTime[].time`, `.weather` and `.arpltn`; `todayIndex`; `daily[].fromToday`, `.dayOfWeek`, `skyAm`/`skyPm` ([#L232](../../server/controllers/worldWeather/controller.ww.units.js#L232)); `hourly[].fromToday` and `.currentIndex`; `shortest[].time` and `.weather`; and the KMA-style row fields such as `t1h`/`t3h`, `tmx`/`tmn`, `pop`, `pty`, `reh`, `wsd`, `hPa`, `stnDateTime` and `dateObj`. Row `date` also keeps its original form instead of being rewritten to `YYYYMMDD` |
| 12 `worldWeather.makeAirInfo` | Absent | **No `airInfo`.** It would find no `arpltn` anyway, because item 11 creates it |
| 13 `ctrlUnits.makeSummary` | Absent | **No `summary`, `summaryWeather` or `summaryAir`** |
| 14 `worldWeather.sendResult` | Same | `units` echoes `req.query[<unit>]` or the default. A `/ww` caller that sends `temperatureUnit=F` gets `units.temperatureUnit: 'F'` next to unconverted default-unit values |

The historical Android widget parsed `thisTime`, `daily`, `timezone` and `units`, with legacy row fields such as `temp_c` ([native consumers](native-consumers-and-plugins.md#1-consumer-inventory)). Source indicates that today's merged `/ww` rows still carry them: the world converters, which `/ww` skips, read `temp_c`, `tempMax_c` and `tempMin_c` from those rows ([controller.ww.units.js#L182](../../server/controllers/worldWeather/controller.ww.units.js#L182), [#L222-L223](../../server/controllers/worldWeather/controller.ww.units.js#L222-L223)). This was not executed.

### Legacy town chains versus v000903 KMA

This table compares the full-town routes (rows 36, 44 and 52) with the v000903 address list (row 67; [37-item appendix](server-response-assembly.md#kma-v000903)).

| Aspect | v000001 `/town`, `/v000001/town` | v000705 `/v000705/town` | v000803 `/v000803/town` | v000903 `/v000903/kma/addr` |
| --- | --- | --- | --- | --- |
| Controller | `ControllerTown` | `ControllerTown24h` | `ControllerTown24h` | `ControllerTown24h` |
| Items on the full-town route | 17 (13 on `/:region`, `/:region/:city`) | 27 | 31 | 37 (38 on `/coord/:loc`) |
| `checkQueryValidation` | No | No | No | Yes |
| Effect of that stage | Unit keys and `airForecastSource` are not defaulted, and `req.version` is not set | Same | Same | Defaults applied; `req.version` set |
| `checkParamValidation` | No | Yes | Yes | Yes |
| Station corrections (`updateCurrentListForValidation`, `mergeCurrentByStnHourly`, `getKmaStnMinuteWeather`) | No. The full-town route uses `getKmaStnHourlyWeather` instead | Yes | Yes | Yes |
| `mergeCurrentSkyByShortest`, `updateMidTempMaxMin`, `getHealthDay`, `getRiseSetInfo` | No | No | Yes | Yes |
| `convertMidKorStrToSkyInfo`, `getKecoDustForecast`, `insertIndex`, `insertStrForData` | No | Yes | Yes | Yes (`insertStrForData` runs after unit conversion) |
| **Icon case** | No sky-icon stage | CamelCase (`insertSkyIcon`) | CamelCase (`insertSkyIcon`) | lower-case (`insertSkyIconLowCase`) |
| **Unit conversion** | None | None | None | `convertUnits` to the requested units |
| **Air fields** | `current.arpltn` from `getKeco` | `current.arpltn`; `midData.dailyData[].dustForecast` | Same as v000705 | The same, plus `airInfoList` (`makeAirInfoList`, `AirForecastList`) |
| **Yesterday and summary** | None | `getSummary`: `current.yesterday` and `current.summary`, in the stored units ([controllerTown.js#L2298-L2351](../../server/controllers/controllerTown.js#L2298-L2351)) | Same as v000705 | `setYesterday` and `getSummaryAfterUnitConverter`: adds `summaryWeather` and `summaryAir`, and the text uses the requested units |
| Warnings (`getSpecialInfo` → `current.specialInfo`) | No | No | No | Yes |
| Rounding (`dataToFixed`) | Yes | Yes | No | No |
| **Envelope** | `ControllerTown.sendResult`: names, product arrays, pub dates, `current` and `midData`, with sentinel defaults | **None. HTTP 200 with an empty body** (no `makeResult`) | `makeResult`: `source: 'KMA'` and `units` (echoed query or default; values unconverted). **No `location`**, because `makeResult` needs `req.version ≥ 'v000901'` ([controllerTown24h.js#L1687-L1689](../../server/controllers/controllerTown24h.js#L1687-L1689)) | `makeResult` with `airInfoList` and numeric `location {lat, long}` |
| Sub-product routes | `/mid`, `/short`, `/shortest`, `/current` registered, but each always throws (rows 37–40) | Registered; empty 200 | Commented out | None |
| Daily rows at `bd6640f2` (`mergeMidWithShort`) | Incomplete rows dropped; `midData.dailyStatus` added | Computed; no body | Same as v000001 | Same as v000001 |
| `historyStatus` at `bd6640f2` (only with `ASOS_HISTORY_READ_ENABLED=true`) | Never: no `mergeCurrentByStnHourly` stage | Computed; no body | Emitted by `makeResult` | Emitted by `makeResult` |

The two `bd6640f2` rows are source analysis of [`mergeMidWithShort`](../../server/controllers/controllerTown.js#L2905-L2923), [`mergeCurrentByStnHourly`](../../server/controllers/controllerTown.js#L1296-L1303) and [`makeResult`](../../server/controllers/controllerTown24h.js#L1614). Field meanings and client handling are in [client data contracts](client-data-contracts.md#domestic-response-additions-at-bd6640f2).

**What a compatibility adapter must reproduce.**

- **`/v000803/town`** is the only legacy town contract with a body and observed traffic. The historical Android widget read `current`, `short`, `midData` and `units` from it; its `shortest` parse was commented out ([native consumers](native-consumers-and-plugins.md#1-consumer-inventory)). Serving it from a v000903-style pipeline requires CamelCase icons, stored-unit values, no `airInfoList`, no `specialInfo` and no `location`. The v000903 `summaryWeather`/`summaryAir` fields would be additive.
- **`/v000705/town`** already returns no body. A caller that tolerates that tolerates any successful status, so keeping or retiring it changes only the status code.

## Retirement and compatibility decisions (proposal)

This section is a **proposal**, not a decision. Each row needs an owner decision, recorded in [decisions and open questions](decisions-and-open-questions.md). "Evidence" repeats only what the rows above establish.

| Contract (rows) | Evidence | Options | Proposed default |
| --- | --- | --- | --- |
| `/ww/*` (84–87) | No reachable caller in current source. The iOS widget constant is dead; the `tw.ios/www` snapshot and the historical Android widget used row 87; external Android plugins are unverified. Traffic not measured | Keep row 87 behind an adapter that reproduces the [`/ww` differences](#ww-versus-the-v000902-dsf-chain); or retire all four | Measure first: query CloudFront logs for `/ww/` over 30 days. If there are zero requests, retire. Otherwise keep only row 87 as an adapter and retire rows 84–86 |
| `/v000803/town/*` (49–52) | 205 requests in 30 days, 86% Android-like. Internal `/v000803/nation` fan-out. Historical Android widget; `tw.ios/www` snapshot | Adapter with the v000803 envelope; or retire with a client-visible error | Keep as an adapter until the external Android widget source is obtained and its request paths are confirmed |
| `/v000705/town/*` (41–48) | 12 requests, all Android-like (11 × 200, 1 × 502). Source analysis says the weather routes answer 200 with an empty body | Retire (no client can depend on a body); or keep returning an empty 200 | Retire. Optionally return `410` after confirming no crash-on-status in old Android builds (unverified) |
| `/town/*`, `/v000001/town/*` and `/`, `/v000001/` (1, 33–40) | Only the unshipped Apple Watch web snapshot calls the unversioned full-town path. Rows 37–40 always fail. Traffic not measured | Retire; or keep row 36 only | Retire, after an unversioned-path log check |
| `/req/*` (88–89) | Only internal caller is row 86. Unauthenticated provider and DB side effects; `get` never answers; publicly reachable in the 2026-09-20 configuration | Remove from the public surface; reimplement `req_add` as an in-process call if row 86 stays | Retire the public route. Close it at the edge or origin immediately, independent of the rewrite |
| `/daily/*` (53–54) | No caller found in current source; the only `client/www/js` call site existed for five days in 2016 (historical). Row 54 never responds | Retire; or keep row 53 | Retire |
| `/test/*` (80–83) | Diagnostics with scrape, provider and DB side effects; no caller | Retire; or move to an operations tool | Retire from the public API |
| `/gather/*` under all prefixes (8–32) | Manager self-HTTP needs only unversioned `/gather/<name>` on loopback. The six versioned prefixes have no caller. Row 30 can invalidate CloudFront | Keep as internal jobs only; drop the versioned mounts | Replace self-HTTP with in-process job calls and bind any remaining trigger to an internal interface. Nine rows (8, 12, 20, 22, 26–28, 30, 32) have no live caller; row 12 joined them at `bd6640f2`, and its retired feed makes it a no-op |
| `/geo` under v000803, v000901 and v000902 (72); `/v000903/geo` (73) | No caller; provider calls (row 72) and an external geocoder call (row 73) | Retire; or fold into the gateway geocoder | Retire |
| v000803 POST JWT gate (4, and 75 and 79 under `/v000803`) | Unverified signatures (`decode`, not `verify`), hard-coded literals, per-process token map, header probably not forwarded by CloudFront; no caller; 0 traffic | Retire with the v000803 POST routes; or replace with real authentication | Retire. Do not port its behavior |
| Legacy single-record `POST /push` (75) | The current app uses row 78; the `tw.ios/www` snapshot uses `/v000705/push`; 12 × 500 on `/v000705/push` in 30 days | Keep a compatible handler; or retire | Keep until the 500 cause is known. Its 12 Android-like requests show a live, failing caller |
| `POST /` index pages (4–7) | No caller; the v000901–v000903 source comment says "make html error page" | Retire | Retire |

The mounted v000901/v000902 KMA/DSF contracts (rows 55–63, 70) are not proposed for retirement here. The widgets, gateway default and push workers depend on them; see [§7](server-response-assembly.md#7-mounted-version-variants-and-callers). The same applies to the v000903 contracts that both the App and the Web PWA use: rows 65–67 and 71 through the gateway, 69 and 74.

## Scope and limitations

**Reproduce the counts.** All three were re-run at `bd6640f2` on 2026-09-25 (Node v24.21.0) with the same results. The walker only reads files and calls `require.resolve`; it does not load any route module.

- **Registrations:** `grep -rnE "router\.(get|post|put|delete|all)\(" server/routes | grep -v "//router" | wc -l` returns **89**. Without the filter the count is 93; the four extra lines are the commented `v000803/routeTownForecast.js` sub-routes.
- **Route files with registrations:** `grep -rlE "^\s*router\.(get|post|put|delete)\(" server/routes | wc -l` returns **25**.
- **Mounted combinations:** run from `server/`. The walker follows every uncommented `app.use`/`router.use('<prefix>', require('<file>'))` line from `app.js`, and multiplies each file's registrations by the prefixes that reach it. It printed `files 25 registrations 89 mounted 291`.

  ```sh
  node -e 'const fs=require("fs"),path=require("path");
  const regs=f=>fs.readFileSync(f,"utf8").split("\n").filter(l=>/^\s*router\.(get|post|put|delete)\(/.test(l)).length;
  const re=/^\s*(?:app|router)\.use\(\s*["\x27]\s*([^"\x27]+)["\x27]\s*,\s*require\(\s*["\x27]\s*([^"\x27]+)["\x27]\)/;
  const uses=f=>fs.readFileSync(f,"utf8").split("\n").map(l=>l.match(re)).filter(Boolean).map(m=>[m[1],require.resolve(path.resolve(path.dirname(f),m[2]))]);
  const files={};function walk(f,p){const n=regs(f);files[f]=files[f]||{n,ps:[]};if(n)files[f].ps.push(p);for(const[q,t]of uses(f))walk(t,(p==="/"?"":p)+q);}
  for(const[p,t]of uses("app.js"))walk(t,p);
  let r=0,m=0,c=0;for(const v of Object.values(files))if(v.n){c++;r+=v.n;m+=v.n*v.ps.length;}
  console.log("files",c,"registrations",r,"mounted",m)'
  ```

- **Cache headers:** see [shared request pipeline](#shared-request-pipeline-and-exposure).

**Limitations.**

- **Source analysis only.** No route was executed. The following are source or library-semantics analysis, not observed responses:
  - the empty v000705 body;
  - the always-failing rows 37–40 and 85, and row 87 with an invalid category;
  - the never-answering rows 54 and 89 (`get`);
  - the Express, `cors`, `express-session` and `jsonwebtoken` behavior.
- **Deployed code not compared.** The deployed service checkout `5bca407` contains the relevant commits, but it has host config and logger edits that were not compared. It is an ancestor of `ff7acf39`, so it predates every upstream change between `ff7acf39` and `bd6640f2`. Its source still contains `require('newrelic')` and the Manager `midrss` task (`git show 5bca407:server/app.js`, `…:server/controllers/controllerManager.js`), and the 2026-09-20 host inventory lists New Relic `4.13.0` installed. Whether its host edits alter either was not checked. The separate gather instance was not inspected ([EC2 internals](../architecture/ec2-internals.md)).
- **Traffic granularity.** The traffic report normalizes location segments, so per-depth counts (for example `/:region` versus `/:region/:city/:town`) are not available. It covers only CloudFront viewer requests: gateway-to-origin, worker-to-`SERVICE_SERVER` and loopback calls are invisible. Unversioned paths other than `/weather` and `/geocode` were not classified.
- **Callers outside this checkout.** Old app binaries and the external Android widget plugins are not in this checkout. "None found" means none in `client/`, `tw.ios/`, `ta.ios/`, `applewatch/`, `server/` and `web/`, not that no caller exists. The Web PWA is source only; no deployment or traffic was observed for it.
- **Bundled trees.** `tw.ios/www`, `ta.ios/www` and `applewatch/www` are labelled "unshipped snapshot" because no inspected build step proves they ship. This follows the [service overview](../architecture/service-overview.md) guidance.
- **Uncharacterized responses.** The response shapes of rows 86 and 87 (legacy world merges) were not characterized beyond the chain differences. Build frozen examples before relying on them.
