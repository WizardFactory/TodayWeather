# Server push text and purchase validation

This document records how the two push workers turn a weather response into notification text, and how `POST /check-purchase` turns a store receipt into an entitlement expiry. It is **observed source** at `bd6640f2` (re-baselined 2026-09-25 from `ff7acf3996ccb66c912d2ed4710cf300197d6966`; client source identical to `ff7acf39`). The upstream push changes are summarized in [§1.1](#11-provider-changes-since-ff7acf39). No worker, database, push provider, store API or HTTP endpoint was called. The worked examples in [§4](#4-worked-examples) and the purchase timeline in [§5.4](#54-ios-expiry-algorithm) are **synthetic execution**: the named functions were extracted verbatim from the source files and run in isolation with stubs (method in §4). The first run used the `ff7acf39` files on 2026-09-24; a re-run on the `bd6640f2` files on 2026-09-25 matched all 27 checks. Everything else is source reading; "anomaly" marks questionable source behavior that needs a rewrite decision, not a confirmed production bug.

[Push architecture](../architecture/push-notifications.md) ([provider submission](../architecture/push-notifications.md#provider-submission-and-app-handling)) · [Version variants and the singular `airInfo`](server-response-assembly.md#response-consequences) · [Client push/purchase contracts](client-data-contracts.md#purchase-variants) · [Traffic report](../../reports/aws/api-traffic-2026-09-22.md)

**Runtime status.** Only `SERVER_MODE=push` starts both workers ([app.js](../../server/app.js#L131-L139); default mode `local`, [config](../../server/config/config.js#L9)). The 2026-09-20 service-host inspection observed `service` mode. The upstream push document records a 2026-09-24 read-only follow-up that found separate alarm and alert push checkouts on the gather host but no running push process in the inspected inventory (deployment observation; [push notifications](../architecture/push-notifications.md#persistence-and-scheduling)). **Whether any push worker runs elsewhere is unverified.** In the 2026-08-23..09-22 CloudFront window `POST /v000902/push-list` received 2,525 requests; those are settings uploads, not sent notifications. No `check-purchase` request under any version appeared in the same window (§5.1).

## 1. Inputs shared by both push workers

| Input | Rule | Source |
| --- | --- | --- |
| Weather endpoint | `SERVICE_SERVER` (`config.serviceServer.url`) + `/v000902/...`. Both workers call **v000902**, not the app's v000903. | [alarm KMA](../../server/controllers/controllerPush.js#L667-L692), [alarm DSF](../../server/controllers/controllerPush.js#L896-L900), [alert](../../server/controllers/alert.push.controller.js#L56-L90) |
| Air payload dependency | Both workers read the singular `airInfo` (`airInfo.pollutants`, `airInfo.last`). KMA v000902 always emits it; v000903 emits `airInfoList` instead; DSF v000902 emits `{source:'aqicn', last}` only when the current row has `arpltn`, never `pollutants`. Retiring v000902 without porting the workers removes their air input. | [§7 response consequences](server-response-assembly.md#response-consequences), [DSF `makeAirInfo`](../../server/controllers/worldWeather/controllerWorldWeather.js#L2109-L2132) |
| Language | Stored `lang` comes from the `push-list` upload's first `Accept-Language` tag (the legacy `POST /push` handler uses the same rule): a tag containing `ko`, `en`, `ja` or `de` is cut to two letters, other tags are stored as sent, a missing header becomes `en`. Workers default to `ko` only when a record has no `lang`. Each message configures `i18n` with locales `en, ko, ja, zh-CN, de, zh-TW` from `server/locales`; the source comment says other locales fall back to `en` (library semantics, not executed). The same `lang` is sent as the weather request's `Accept-Language`, so server-localized strings inside the response (`arpltn` `*Str`, pollutant `str`, `summaryAir`) arrive in that language. KMA `wfAm`/`wfPm` and `dustForecast` `*Str` are stored Korean text in every language (source reading). | [upload language](../../server/routes/v000902/route.push.update.list.js#L79-L100), [alarm](../../server/controllers/controllerPush.js#L618-L630), [alarm default](../../server/controllers/controllerPush.js#L1037-L1039), [alert](../../server/controllers/alert.push.controller.js#L56-L59) |
| Units | `UnitConverter.initUnits` fills missing `temperatureUnit=C`, `windSpeedUnit=m/s`, `pressureUnit=hPa`, `distanceUnit=km`, `precipitationUnit=mm`, `airUnit=airkorea`, `airForecastSource=airkorea`. Every key of the stored `units` object is appended as `?key=value&...` in object order, without URL encoding. | [initUnits](../../server/lib/unitConverter.js#L356-L366), [alarm query](../../server/controllers/controllerPush.js#L694-L700) |
| Package | `todayWeather` (default when absent) or `todayAir`. It selects the text builder and the Firebase app (`todayAir` → TodayAir app, anything else → TodayWeather app). | [requestDailySummary](../../server/controllers/controllerPush.js#L1034-L1042), [sendFcmNotification](../../server/controllers/controllerPush.js#L226-L252), [pushProviders.firebase](../../server/lib/pushProviders.js#L7-L8) |
| Delivery shape | Provider order: `fcmToken` present → FCM, whatever `type` is; else `type == 'ios'` → error (§1.1); else `type == 'android'` → legacy GCM with `registrationId`; else `Unknown type`. FCM: `notification {title, body: text}`, `data {cityIndex: String(cityIndex)}`. Legacy GCM: `data {title, body: text, cityIndex, notId, 'content-available':'1'}`. | [alarm order](../../server/controllers/controllerPush.js#L1092-L1119), [FCM](../../server/controllers/controllerPush.js#L226-L236), [GCM](../../server/controllers/controllerPush.js#L196-L211) |
| Settings retention | Alarm: after a send batch, records with `updatedAt` older than 60 days are deleted, and records without `updatedAt` are stamped by upserting the whole in-memory record. The delete query adds `cityIndex` (and `id`) only when they are truthy, so an expired `cityIndex` 0 record removes every alarm record of its token (**anomaly**, [`removePushInfo`](../../server/controllers/controllerPush.js#L130-L166)). Alert: the 60-day cleanup queries the field `updateAt`, which the model does not define, so it matches nothing (**anomaly**). | [alarm `_removeOldList`](../../server/controllers/controllerPush.js#L1129-L1173), [alert `_removeOldList`](../../server/controllers/alert.push.controller.js#L917-L927), [model](../../server/models/alert.push.model.js#L38) |

Provider credentials at `bd6640f2`: `GCM_ACCESS_KEY`, which builds the GCM sender at import ([controllerPush.js#L26-L28](../../server/controllers/controllerPush.js#L26-L28); `config.push` has only this key, [config](../../server/config/config.js#L78-L80)), and two product Firebase service-account files under `server/config`, loaded on first use (§1.1). No `APN_*` name is read ([configuration §1.5](configuration-inventory.md#15-store-and-push-credentials)).

### 1.1 Provider changes since ff7acf39

Commits `c80ee014` (Node 16 preparation, lazy providers) and `45b2eb3f` (direct APNs removal). The builders, request selection, scheduling and retention functions in `controllerPush.js` are text-identical to `ff7acf39`; only their line numbers moved.

| Change | Behavior at `bd6640f2` | Source |
| --- | --- | --- |
| Direct APNs removed | `sendIOSNotification`, `apnFeedback`, the `apn` dependency and every `APN_*` setting are gone. An iOS record **with** `fcmToken` goes to FCM (the upstream document states that Firebase relays to APNs). An iOS record **without** `fcmToken` fails with `FCM token is required for iOS notifications` only after the weather request and text build. Nothing is sent, the error is logged per record, and the record is neither disabled nor deleted. When an alert decision is not `none`, the alert worker has already written its state and `pushTime` at that point (§3.3), so the record enters the 6-hour quiet period without a notification (source reading, not executed). | [alarm](../../server/controllers/controllerPush.js#L1110-L1112), [alert](../../server/controllers/alert.push.controller.js#L670-L672), [startup](../../server/app.js#L131-L139) |
| Lazy Firebase apps | `pushProviders.firebase(package)` returns the cached app, else an already registered app with the same name, else it requires the product's service-account file and calls `initializeApp` under the name `todayWeather` or `todayAir`. `sendFcmNotification` wraps that call in `try`: a missing or invalid file fails only that record, and nothing is cached, so the next send tries again (Node `require` semantics, not executed). `ControllerPush` construction reads no credentials, so push routes (every mode) and per-notification alert sends no longer touch the files. | [pushProviders.js](../../server/lib/pushProviders.js#L7-L16), [sendFcmNotification](../../server/controllers/controllerPush.js#L238-L251), [constructor](../../server/controllers/controllerPush.js#L32-L35) |
| FCM promise handling | `.then(onSent, onError)` replaces `.then().catch()`. An exception thrown by the success callback no longer re-enters `callback(err)` as a second callback. It becomes an unhandled rejection, which terminates the process under Node 15+ defaults (Promise and Node semantics, not executed). | [L245-L250](../../server/controllers/controllerPush.js#L245-L250) |
| Runtime | `server/.nvmrc` and `engines` declare Node 16.20.2; `firebase-admin` is pinned to 5.13.1. See [configuration §1.8](configuration-inventory.md#18-non-environment-inputs-files-release-overrides-and-literals). | [package.json](../../server/package.json#L14) |

**Resolved upstream** (anomalies recorded at `ff7acf39`; each code path no longer exists at `bd6640f2`):

- `apnKeyPath`, `apnKeyId` and `apnTeamId` all read `APN_KEY_ID`. `c80ee014` split them into separate names; `45b2eb3f` removed all `APN_*` settings ([config](../../server/config/config.js#L78-L80)).
- APNs `production` was hard-coded `false`, and the APNs branch called back `'sent'` before its send promise settled. `c80ee014` derived `production` from `NODE_ENV` and waited for the send result; `45b2eb3f` removed the branch.
- The `ControllerPush` constructor loaded both service-account files and only logged a failure. `sendFcmNotification` then read `.name` of an undefined app and threw inside the weather-request callback. It now returns the error to its callback (`c80ee014`).

Stored iOS `registrationId`-only records remain in both collections. Whenever they are due, the workers still select them and request weather before failing. The retirement or migration decision is listed in [§6](#6-rewrite-decisions-to-make-explicitly).

### 1.2 Overseas source since #2585

World responses now carry `source:'VC'` (Visual Crossing) instead of `'DSF'`; the route stays `/v000902/dsf/coord`. Current apps register overseas cities with `source` `VC`, while records from released app versions keep `DSF`. The alarm selects the overseas request for either value ([requestDailySummary](../../server/controllers/controllerPush.js#L1049-L1052)). The alert worker maps `vc` to the `dsf` URL segment ([`_makeRequestUrl`](../../server/controllers/alert.push.controller.js#L71-L74)) and reads `thisTime[1]` for both ([`_getCurrentWeather`](../../server/controllers/alert.push.controller.js#L123-L143)). Released app versions derive the city source from `pubDate.DSF`, which the server no longer sends, so their new overseas registrations carry no `source` (source reading): the alarm takes the geocode path (§2.1 row 4), and the alert worker reaches the `toLowerCase` anomaly in §3.1. The DSF text builders and labels below apply unchanged to `VC` responses.

## 2. Scheduled alarm (`ControllerPush`)

Every 60 s the worker selects records whose `pushTime` equals the current UTC seconds-of-day (minute resolution), filters by local weekday, and processes six at a time ([schedule and filters](../architecture/push-notifications.md#persistence-and-scheduling)). For each record, `sendNotification` requests weather, builds `{title, text}` and submits it. Any error is logged per record; the worker retries nothing, although the legacy GCM branch passes a retry count of 5 to `node-gcm` ([GCM](../../server/controllers/controllerPush.js#L216), [sendPush](../../server/controllers/controllerPush.js#L1262-L1326)).

### 2.1 Request selection (first match wins)

| # | Condition on the stored record | Action |
| --- | --- | --- |
| 1 | `cityIndex === 0` and `geo` present | Geocode first (below), then KMA or overseas (DSF route) by the geocoded country. The source comment says this path should go once `source` is always set. |
| 2 | `source == 'VC'` or `'DSF'` (#2585) | DSF-route request |
| 3 | `source == 'KMA'` | KMA request |
| 4 | `geo` present (unknown `source`, logged as an error) | Same as 1 |
| 5 | `town.first` non-empty (older clients) | KMA request |
| 6 | otherwise | Error `INVALID PUSHINFO`; no notification |

Geocode step ([`_requestGeoInfo`, `_geoInfo2pushInfo`, `_requestDailySummaryByGeo`](../../server/controllers/controllerPush.js#L952-L1026)): `GET ${API_SERVER}/geocode/coord/<lat>,<lon>` (unversioned, no `Accept-Language`, no timeout option, one attempt; HTTP ≥ 400 is an error). If `country === 'KR'`, `kmaAddress.name1..3` replace `town` (only when `name1` has more than one character) and `location {lat,long}` replaces `geo`; if neither is present the record fails with `INVALID GEOINFO`. The copy is made in memory; it is persisted only when the record lacks `updatedAt`, because the post-batch stamp upserts the mutated record (source reading; the write was not executed) ([`_removeOldList`](../../server/controllers/controllerPush.js#L1153-L1162), [`updatePushInfo`](../../server/controllers/controllerPush.js#L81-L128)). Any other country goes to the DSF request.

| Request | URL | Notes |
| --- | --- | --- |
| KMA | `${SERVICE_SERVER}/v000902/kma/coord/<lat>,<lon>` when `geo` exists, else `/v000902/kma/addr/<first>[/<second>[/<third>]]` (each segment `encodeURIComponent`), else error `Fail to find geo or town info` | [`_requestKmaDailySummary`](../../server/controllers/controllerPush.js#L667-L745) |
| DSF route (`VC` or `DSF`) | `${SERVICE_SERVER}/v000902/dsf/coord/<lat>,<lon>` | Reads `geo[1]` without a check; such a record without `geo` throws synchronously outside the callback path (**anomaly**, not reproduced). [`_requestDsfDailySummary`](../../server/controllers/controllerPush.js#L896-L950) |

Both requests add the unit query ([§1](#1-inputs-shared-by-both-push-workers)), send `Accept-Language: <lang>`, parse JSON, set no timeout option and do not retry. A transport error or HTTP ≥ 400 fails the record. A body without `units` gets `{C, m/s, hPa, km, mm, airkorea}`. Builder exceptions are caught and fail the record.

### 2.2 Message by source and package

| Source | Location prefix | `todayWeather` | `todayAir` |
| --- | --- | --- | --- |
| KMA ([`_makeKmaPushMessage`](../../server/controllers/controllerPush.js#L618-L658)) | `name + ' '`; else `townName`, `cityName` or `regionName` + `' '`; else empty | title = prefix + current line (§2.4); text = day line (§2.3) | title = prefix only; text = §2.6 |
| DSF ([`_makeDsfPushMessage`](../../server/controllers/controllerPush.js#L860-L887)) | `name + ' '`; else empty | Same structure, DSF builder | Same air builder |

Any other `package` value produces no message object; `convertToNotification` then dereferences `undefined` inside the request callback (**anomaly**, not reproduced). The upload route defaults a missing package to `todayWeather` ([upload](../../server/routes/v000902/route.push.update.list.js#L33-L36)).

**18:00 switch (all builders).** The hour is `new Date(current.dateObj).getHours()`; KMA and the air builder fall back to `current.time`. `dateObj` is a zone-less `YYYY.MM.DD HH:MM` string in the location's local time (KMA: [`convertUnits`](../../server/controllers/controllerTown24h.js#L1736-L1742)). A local Node 24 check parsed it as wall-clock time with the same hour under `TZ=UTC`, `Asia/Seoul` and `America/Los_Angeles`. At `bd6640f2` the server declares Node 16.20.2 ([.nvmrc](../../server/.nvmrc)); the parse was not re-checked on Node 16, and the deployed Node version was not checked. Hour `< 18` → today (`LOC_TODAY`), otherwise tomorrow (`LOC_TOMORROW`). A missing or unparsable hour compares false and selects tomorrow.

### 2.3 TodayWeather day line (`text`)

Items are pushed in this order and joined with `Array.toString()`, i.e. commas **without spaces**; the line is `<LOC_TODAY|LOC_TOMORROW>: <items>`.

| Item | KMA ([`_makeKmaPushWeatherMessage`](../../server/controllers/controllerPush.js#L460-L609)) | DSF ([`_makeDsfPushWeatherMessage`](../../server/controllers/controllerPush.js#L765-L858)) |
| --- | --- | --- |
| Target day | `midData.dailyData` entry with `fromToday` 0 (before 18:00) or 1; previous day = `fromToday` −1 or the today entry. A missing target throws and fails the record. At `bd6640f2` the v000902 chain omits daily rows whose `wfAm`/`wfPm` do not map to a sky value, or whose `taMin`/`taMax` are not both finite numbers between −50 and 60 with `taMin ≤ taMax` ([`convertMidKorStrToSkyInfo`](../../server/controllers/controllerTown.js#L1952-L1954); [daily forecast validity](../architecture/mobile-api.md#daily-forecast-validity-issue-2560)). An omitted target therefore fails the record, and an omitted previous day removes the delta (source reading, not executed). | `daily[0 .. length−2]` entry whose day-of-month (`getDate()` of its `dateObj`) equals the current or next day; previous day = the preceding array entry. The last array entry is never considered. |
| 1. Sky | If `skyAm` and `skyPm`: `wfAm` + emoji(`skyAm`) + `→` + `wfPm` + emoji(`skyPm`), after removing the first `흐리고 `, `구름적고 ` and `구름많고 ` from each `wf` text. Else emoji(`skyIcon`) if truthy. `skyAm/skyPm` are the lower-case icon names that v000902 `convertUnits` copies from `skyAmIcon/skyPmIcon` ([source](../../server/controllers/controllerTown24h.js#L1772-L1775)). A missing `wfAm/wfPm` while `skyAm/skyPm` exist throws. | If `skyAm` and `skyPm`: emoji(`skyAm`) + `→` + emoji(`skyPm`), no `wf` text; else emoji(`skyIcon`) if truthy. DSF copies the daily `skyIcon` into both, so the pair repeats one emoji ([ww.units](../../server/controllers/worldWeather/controller.ww.units.js#L230-L232)). |
| 2. Temperatures | When the target has own `tmn` and `tmx`: §2.5 | Same |
| 3. Precipitation probability | `LOC_PROBABILITY_OF_PRECIPITATION + ' ' + pop + '%'` only when target `pty > 0`, `pop` truthy, `current.pty <= 0` and the target is not today. It never appears in the before-18:00 alarm, and an absent `current.pty` fails the `<= 0` test. | Same text only when target `pty > 0`, `pop` truthy and **not** `current.pty <= 0`. The builder's `today` is always the target entry, so POP appears only while it is currently precipitating (`current.pty` from `precType`, [ww.units](../../server/controllers/worldWeather/controller.ww.units.js#L179)). **Anomaly:** the code comment states the opposite intent. |
| 4. Air | If the target has `dustForecast` (v000902 renames `PM10Grade`→`pm10Grade` etc. and adds 1 to each grade, [source](../../server/controllers/controllerTown24h.js#L1784-L1804)): `LOC_PM25 + ' ' + pm25Str` when `pm25Grade > pm10Grade`, else `LOC_PM10 + ' ' + pm10Str` (ties and missing grades choose PM10, and a missing `pm10Str` prints `undefined`); then `LOC_O3 + ' ' + o3Str` if present. Otherwise the first of `aqi`, `pm25`, `pm10`, `o3` in `airInfo.pollutants` with a `daily` row for the same `fromToday`: label `LOC_AIR_STATUS` (aqi) / `LOC_PM25` / `LOC_PM10` / `LOC_O3` + `' ' + str`. In v000902 KMA, daily pollutant rows come from `dustForecast` days ([`makeAirInfo`](../../server/controllers/controllerTown24h.js#L1093-L1104)) and, when `airForecastSource=kaq` (the current app uploads `kaq`, [client](../../client/www/js/service.push.js#L165)), from KAQ hourly forecasts ([`_insertForecastPollutants`](../../server/controllers/controllerTown24h.js#L831-L907)). The fallback can therefore match a KAQ-derived row on a target day without `dustForecast` (source-level inference, not executed). | None |

### 2.4 TodayWeather current line (`title`)

`LOC_CURRENT + ': ' +` items joined by commas without spaces:

| Item | KMA | DSF |
| --- | --- | --- |
| Current row | `current` | `thisTime[1]` |
| Sky | emoji(`current.skyIcon`) if truthy | Same |
| Temperature | `t1h + '˚'` if `t1h` is truthy, so **0˚ is omitted** (**anomaly**) | `t1h + '˚'` if the property exists (0˚ shown) |
| Air | `_getAqiStr(current.arpltn)` when `arpltn` exists and a string results | Same |
| Precipitation | When `pty > 0` and `rn1 != undefined`: `_convertKmaPtyToStr(pty) + ' ' + rn1 + units.precipitationUnit` | When `pty > 0` and `rn1` exists: `_pty2str(pty) + ' ' + rn1 + units.precipitationUnit` |

The unit suffix comes from the stored record's `units`, the same units that were sent in the request. `_getAqiStr` ([source](../../server/controllers/controllerPush.js#L266-L299)) sorts `['pm25','pm10','o3','khai']` by `<name>Grade` descending and uses only the first entry, if its `<name>Str` exists: `LOC_PM25`/`LOC_PM10`/`LOC_O3`/`LOC_AQI` (khai) + `' ' + Str`. There is no fallback to the next pollutant. **Anomaly:** the comparator tests `a` twice and never `b` for a missing grade, so missing grades make the order engine-dependent. On Node 24, `{pm10Grade:3, pm10Str}` alone produced no air item, and `{khaiGrade:3, pm25Grade:2}` produced the PM2.5 string (isolated run, §4 method). This was not re-checked on the declared Node 16.

### 2.5 Temperature item

[`_makeStrTmnTmx`](../../server/controllers/controllerPush.js#L301-L337): `LOC_LOWEST + parseInt(tmn) + '˚' [+ '(' ± diff + ')'] + ' ' + LOC_HIGHEST + parseInt(tmx) + '˚' [+ '(' ± diff + ')']`. There is no space between label and value (`최저18˚`, `Lowest18˚`). `diff = Math.round(target − previous)`, shown only when the previous day exists with a truthy value (a previous value of 0 suppresses it) and `diff !== 0` (so −0 is hidden); positive values get `+`. The displayed value truncates (`parseInt(24.6)` → 24) while the delta rounds; today 24.6 against yesterday 25 shows `최고24˚` with no delta (**anomaly**).

### 2.6 TodayAir text

[`_makePushAirMessage`](../../server/controllers/controllerPush.js#L345-L458), used by both sources. The title is only the location prefix, including its trailing space.

1. Current row: `weatherInfo.current`, else `thisTime[1]`. No `airInfo` → throw `airInfo is invalid` (KMA v000902 always has one; DSF lacks it when the current row has no `arpltn`).
2. `currentSummary = LOC_CURRENT + ': ' + current.summaryAir` when `summaryAir` is truthy.
3. No `airInfo.pollutants` (always the case for DSF v000902) → text = `currentSummary`.
4. For each pollutant except `aqi` with a `daily` row for the target `fromToday` (0/1 by the 18:00 switch): keep the row and compute `index = AqiConverter.value2index(airUnit, name, val)`. `maxGrade` is the highest `grade`; the maximum-index pollutant is the first strictly highest `index`. `maxGrade === 0` → text = `currentSummary`.
5. Day summary: `maxGrade <= 1` → `LOC_AIR_QUALITY_IS_GOOD`. `maxGrade == 2` → PM2.5 then PM10 rows with grade ≥ 2 as `<LOC_PM25|LOC_PM10> + ' ' + LOC_AVERAGE + val + ' ' + str`, joined with `', '`; none → `LOC_AIR_QUALITY_IS_MODERATE`. `maxGrade >= 3` → the same with grade ≥ 3; none → the maximum-index pollutant in the same format with its `LOC_` name. Prefix `LOC_TODAY: ` or `LOC_TOMORROW: `.
6. text = `currentSummary + '\n' + daySummary` **only if** `currentSummary` exists; otherwise text is `undefined` and the day summary is discarded (**anomaly**). How FCM or GCM treats an undefined body was not verified.

### 2.7 Emoji and precipitation labels

| Input | Output | Source |
| --- | --- | --- |
| Icon name (lower-cased), first match | contains `lightning` → ⛈ U+26C8; `rainsnow` → ☔☃; `rain` → ☔ U+2614; `snow` → ☃ U+2603; `cloud` with `sun`/`moon` → ⛅ U+26C5; `cloud` → ☁ U+2601; `sun`/`moon` → 🌞 U+1F31E; otherwise empty string and an error log. A non-string icon throws. | [`_getWeatherEmoji`](../../server/controllers/controllerTown24h.js#L2055-L2084) |
| Arrow | `→` U+2192 | [`_getEmoji`](../../server/controllers/controllerTown24h.js#L2037-L2053) |
| KMA `pty` | 1 → `LOC_PRECIPITATION`; 2 → `LOC_PRECIPITATION`; 3 → `LOC_SNOWFALL`; other → empty, so the item starts with a space | [`_convertKmaPtyToStr`](../../server/controllers/controllerTown.js#L3617-L3632) |
| DSF `pty` | 1 → `LOC_PRECIPITATION`; 2 → `LOC_SNOWFALL`; 3 → `LOC_PRECIPITATION`; 4 → `LOC_HAIL`; other → empty | [`_pty2str`](../../server/controllers/controllerPush.js#L747-L763) |

Korean labels: `LOC_TODAY` 오늘, `LOC_TOMORROW` 내일, `LOC_CURRENT` 현재, `LOC_LOWEST` 최저, `LOC_HIGHEST` 최고, `LOC_PROBABILITY_OF_PRECIPITATION` 강수확률, `LOC_PM25` 초미세먼지, `LOC_PM10` 미세먼지, `LOC_O3` 오존, `LOC_AQI` 통합대기, `LOC_AIR_STATUS` 대기상태, `LOC_PRECIPITATION` 강수량, `LOC_SNOWFALL` 적설량, `LOC_HAIL` 우박, `LOC_AVERAGE` 평균 ([ko.json](../../server/locales/ko.json), [en.json](../../server/locales/en.json)).

### 2.8 What prevents an alarm

No matching record for the minute; a weekday filter of `false` or a missing `timezoneOffset` when `dayOfWeek` is set; request selection error (§2.1); geocode, transport or HTTP ≥ 400 error; a missing target day, `wf` text or `airInfo`, or a non-string icon (builder throws, caught); an iOS record without `fcmToken`, or a Firebase app that cannot be initialized, for example because its service-account file is missing (both since `c80ee014`/`45b2eb3f`, §1.1); an unregistered FCM token, which also sets `enable:false` through `update({fcmToken})` without `multi`, i.e. on one record with that token under Mongoose 5 defaults (library semantics, not executed; [`disableByFcm`](../../server/controllers/controllerPush.js#L42-L48)). Each case is logged and the batch continues. There is no retry or later catch-up for a missed minute.

## 3. Conditional alert (`AlertPushController`)

### 3.1 Schedule, selection and request

- **Polls.** A 60 s interval runs the job only at UTC minutes **7, 17, 35 and 50** with `time = UTC seconds-of-day`; the parse step's `minute = (time/60) % 60`, so "minute < 30" means :07/:17 and "minute > 30" means :35/:50 ([start](../../server/controllers/alert.push.controller.js#L929-L941), [`_getMinsOfCurrent`](../../server/controllers/alert.push.controller.js#L27-L29)).
- **Records.** `enable: true` and inside the window: `startTime ≤ time ≤ endTime`, or for `reverseTime` records `startTime ≤ time` **or** `endTime ≥ time`. A `$where` prefilter skips the record when **either** `precipAlerts.pushTime` or `airAlerts.pushTime` is within the last 6 hours. Six records are processed at a time ([`_getAlertPushByTime`](../../server/controllers/alert.push.controller.js#L774-L818), [`_streamAlertPush`](../../server/controllers/alert.push.controller.js#L748-L765)). Unlike the alarm worker, the alert controller never reads `dayOfWeek` or `timezoneOffset`, although the model stores them ([model](../../server/models/alert.push.model.js#L40-L41)).
- **Housekeeping per poll.** Before selection, `_removeDuplicates` groups records by `registrationId`, `cityIndex` and `id`; for each group with more than one record and a defined `registrationId`, it deletes the records whose `updatedAt` equals the earlier of the first two collected values. FCM-only records (no `registrationId`) are never de-duplicated. The 60-day cleanup (§1) is also started at each poll minute ([`_removeDuplicates`](../../server/controllers/alert.push.controller.js#L820-L869), [`sendAlertPushList`](../../server/controllers/alert.push.controller.js#L871-L915), [start](../../server/controllers/alert.push.controller.js#L929-L941)).
- **Request** ([`_makeRequestUrl`, `_getWeatherData`](../../server/controllers/alert.push.controller.js#L56-L121)): `lang` defaults to `ko`; units as in [§1](#1-inputs-shared-by-both-push-workers). With `geo`: `${SERVICE_SERVER}/v000902/<source lower-cased, vc → dsf>/coord/<lat>,<lon>`; otherwise `/v000902/kma/addr/<first>[/<second>[/<third>]]` whatever the source; with neither, an error is only logged and the request goes to the bare `SERVICE_SERVER` URL plus the unit query. `Accept-Language: <lang>`, 10 s timeout, JSON, HTTP ≥ 400 is an error. `async.retry(2)` makes at most **2 attempts** (one retry) with no delay.
- **Anomalies.** `pushInfo.source.toLowerCase()` runs before its own empty-source check, so a record without `source` throws synchronously outside the waterfall's error path; the check is dead. The final error logger reads `alertPush.geo[1]`, which throws for a town-only record. Neither was reproduced.

### 3.2 Parse (`_parseWeatherAirData`)

[Source](../../server/controllers/alert.push.controller.js#L123-L376). The response must have `source` `KMA` (current row = `current`) or `VC`/legacy `DSF` (current row = `thisTime[1]`, and `rns` is forced to `true` when `pty > 0`); anything else throws.

| Field | Rule |
| --- | --- |
| `name` | Response `name`, else non-empty `townName`, else non-empty `cityName` |
| `weather` | `pty = current.pty \|\| 0`, `rns = current.rns \|\| false`, `desc = current.weather`, `stnName` (`rnsStnName` preferred), `dateObj` |
| `weather.forecast` | Only when raw `current.pty === 0` (an absent `pty` skips it) **and** minute < 30. (1) KMA `shortest`: find the slot at current hour + 1 (`YYYY.MM.DD HH:00`, compared as parsed time). If found, forecast = `{pty:0, pubDate}`, overwritten with that slot's fields only when the slot **and the next slot** both have `pty > 0`. A found slot therefore always sets a forecast and blocks step 2. (2) If no slot was found (DSF has no `shortest`): the KMA `short` or DSF `hourly` row whose `dateObj` string equals current hour + 4 (`forecastTime` + 3 h). The source comment describes `short` as 3-hourly, so only an exact slot hour matches. At :35/:50 no weather forecast is considered. |
| `air` | Needs `airInfo.last` (the singular v000902 `airInfo`); otherwise `air = {}`. Candidates are `pm10, pm25, o3, no2, co, so2` with a truthy `<name>Grade`, sorted by grade descending; ties keep that order because the sort is stable for such short arrays ([`sortByGrade`](../../server/lib/aqi.converter.js#L451-L463)). The first gives `name`, `grade`, `value`, `str = last[<name>Str]`, `stationName`; `dataTime` is copied. |
| Air forecast | When there is no grade or `grade < airAlertsBreakPoint` and minute > 30, the next-hour hourly pollutant forecast is computed and then **deleted unconditionally** before return; it is only logged. The air-forecast branches in the send decision, state update and text are unreachable. |

`airAlertsBreakPoint` is stored per record. The app sends 3 for `airUnit` `airkorea`/`airkorea_who`, otherwise 4 ([client](../../client/www/js/service.push.js#L205-L211)). The schema has no default; without it every comparison is false and no air alert is sent ([model](../../server/models/alert.push.model.js#L42)).

### 3.3 Send decision and state

[`_compareWithLastInfo`](../../server/controllers/alert.push.controller.js#L463-L517) returns `none`, `weather`, `air` or `all` (weather and air):

| Category | Gate (all must hold) | Trigger |
| --- | --- | --- |
| Weather | `precipAlerts.pushTime` absent or older than 6 h; `precipAlerts.lastState` is `0` or absent | `weather.pty > 0` **and** `weather.rns`; otherwise `weather.forecast.pty > 0` |
| Air | `airAlerts.pushTime` absent or older than 6 h; `airAlerts.lastGrade < airAlertsBreakPoint` or absent | `air.grade >= airAlertsBreakPoint` |

Because the database prefilter already drops a record when either `pushTime` is within 6 h, the per-category time gates are effectively always open. The effective rule is a shared 6-hour quiet period after any alert, during which the record is not polled and its state is not refreshed.

[`_updateAlertPush`](../../server/controllers/alert.push.controller.js#L385-L454) then runs for every polled record whose request and parse succeeded, whatever the decision. `precipAlerts.lastState` = `forecast.pty` when current `pty` is 0 and a forecast has `pty > 0`, else `weather.pty`. `airAlerts.lastGrade/lastCode` = current `grade/name` when a grade exists. `pushTime = now` for each sent category. The database write is fire-and-forget and happens before text conversion and submission ([`_sendAlertPush`](../../server/controllers/alert.push.controller.js#L682-L746)), so a later failure still records the state. Consequences: current precipitation without `rns` sends nothing but sets `lastState > 0`, which blocks a later precipitation alert until a poll sees current `pty` 0 without a positive forecast. A new precipitation alert therefore always needs such a dry poll in between.

### 3.4 Title and text

[`_convertToNotification`](../../server/controllers/alert.push.controller.js#L526-L647) runs only when the decision is not `none`, and it **does not receive the decision**. It includes every currently qualifying condition, so an `air` alert sent while it rains also carries the rain sentence, and a `weather` alert also carries a qualifying air sentence.

1. `title = (pushInfo.name || parsed name || '') + ' '`.
2. Weather, if `weather.pty > 0`: title += `dateObj.substr(11,5)` (`HH:MM`); text += `LOC_IT_IS_RAINING` (1), `LOC_IT_IS_SLEETING` (2) or `LOC_IT_IS_SNOWING` (3); other codes add no sentence. This branch does not require `rns`.
3. Else, if `forecast.pty > 0`: title += `LOC_FORECAST`; text += `sprintf(template, hour of forecast.dateObj)` with `LOC_IT_WILL_BE_RAINY_FROM_H` (1), `…_SLEETING_…` (2) or `…_SNOWY_…` (3). Another code leaves the template undefined; the `sprintf` 0.1.x behavior for that was not checked.
4. Air, if `air.grade >= airAlertsBreakPoint`: text += `' '` when step 2 or 3 applied, otherwise title += `LOC_AIR_INFORMATION + ' '`. Then text += `sprintf(LOC_H_POLLUTANT_IS_GRADE, hour of air.dataTime, <translated pollutant name>, air.str || air.value)`. When the translated name contains `오존`, the first `가` of the template becomes `이` (`%d시 %s가 %s입니다.` → `%d시 %s이 %s입니다.`), fixing the Korean particle for ozone only.
5. Dead code: the `stationName` title fallback (the title is never empty after step 1) and the air-forecast sentence (§3.2).

| Key | ko | en |
| --- | --- | --- |
| `LOC_IT_IS_RAINING` / `SLEETING` / `SNOWING` | 비가 / 진눈깨비가 / 눈이 내리고 있습니다. | It is raining / sleeting / snowing (no period) |
| `LOC_FORECAST` | 예보 | Forecast |
| `LOC_IT_WILL_BE_RAINY_FROM_H` | %d시부터 비가 내릴 예정입니다. | It's expected to rain from %dh. |
| `LOC_IT_WILL_BE_SLEETING_FROM_H` | %d시부터 눈 또는 비가 내릴 예정입니다. | It's expected to snow or rain from %dh. |
| `LOC_IT_WILL_BE_SNOWY_FROM_H` | %d시부터 눈이 내릴 예정입니다. | It's expected to snow from %dh. |
| `LOC_AIR_INFORMATION` | 대기정보 | AQI |
| `LOC_H_POLLUTANT_IS_GRADE` | %d시 %s가 %s입니다. | %dh %s is %s. |

Pollutant names come from [`AqiConverter.name2string`](../../server/lib/aqi.converter.js#L465-L482) (`LOC_PM10`, `LOC_PM25`, `LOC_O3`, `LOC_CO`, `LOC_SO2`, `LOC_NO2`, `LOC_AQI`). Delivery constructs a `ControllerPush` per notification and reuses its FCM and GCM senders in the same provider order as the alarm worker. An iOS record without `fcmToken` fails after the state write (§1.1). An unregistered FCM token disables an alert record (same `update` without `multi`) through the alert controller's own `_disableByFcm` ([`_sendNotification`](../../server/controllers/alert.push.controller.js#L649-L680), [`_disableByFcm`](../../server/controllers/alert.push.controller.js#L1053-L1057)).

## 4. Worked examples

**Method (synthetic execution, 2026-09-24; re-run 2026-09-25 at `bd6640f2`).** The builders `_getAqiStr`, `_makeStrTmnTmx`, `_makeKmaPushWeatherMessage`, `_makeDsfPushWeatherMessage`, `_pty2str`, `_makePushAirMessage`, `_getWeatherEmoji`, `_getEmoji`, `_convertKmaPtyToStr` and the alert methods `_parseWeatherAirData`, `_compareWithLastInfo`, `_updateAlertPush`, `_convertToNotification` were extracted verbatim by name from the source files. At `bd6640f2` their text is identical to `ff7acf39`. `controllerPush.js` builders moved 101 lines up and `_convertKmaPtyToStr` moved from L3574 to [L3617-L3632](../../server/controllers/controllerTown.js#L3617-L3632). They were evaluated in Node 24.21.0 together with the real `server/lib/aqi.converter.js` and `server/lib/kmaTimeLib.js`. Stubs: a no-op `log`; a translator returning the `server/locales/<lang>.json` value for a key; `manager.leadingZeros`; and, for alert text only, a positional `%d`/`%s` `sprintf` (the real `sprintf` 0.1.x, `i18n`, Mongo, Firebase and HTTP code were not loaded). The alert database prefilter, state write and provider submission were not executed. Alarm outputs were identical under `TZ=UTC`, `Asia/Seoul` and `America/Los_Angeles`. Inputs are synthetic; strings that the server response supplies (`wfAm`, `*Str`, `summaryAir`) are fixture values. The harness is checked in as [server-push-text-purchase-expiry.js](../../reports/rewrite-verification/probes/server-push-text-purchase-expiry.js) with its [record](../../reports/rewrite-verification/probes/server-push-text-purchase-expiry.json). The checked-in record holds the `ff7acf39` file blobs; 27 of 27 checks match §2.4, §4.1–§4.3 and §5.4. A 2026-09-25 re-run on the `bd6640f2` files, with output written outside the repository, also matched 27 of 27 with no differences between time zones. The record was not rewritten.

### 4.1 KMA alarm, `lang=ko`, `name='집'`, default units

Fixture: `current {dateObj, skyIcon:'sun_smallcloud', t1h:18, pty:0, rn1:0, summaryAir:'대기질은 보통입니다.', arpltn:{pm25Grade:2,'보통'; pm10Grade:1; o3Grade:1; khaiGrade:2}}`; `dailyData` −1 `{tmn:17, tmx:25}`, 0 `{skyAm:'sun', skyPm:'sun_bigcloud_rain', wfAm:'맑음', wfPm:'구름많고 비', tmn:18, tmx:24.6, pty:1, pop:60, dustForecast:{pm10Grade:2, pm25Grade:2, both '보통'}}`, +1 `{skyAm:'cloud_rain', skyPm:'sun_smallcloud', wfAm:'흐리고 비', wfPm:'구름적고', tmn:15.5, tmx:21, pty:1, pop:70, dustForecast:{pm25Grade:3 '나쁨', pm10Grade:1, o3Str:'좋음'}}`; `airInfo.pollutants` daily rows pm25 {0: 20/2/보통, 1: 45/3/나쁨}, pm10 {0: 40/2/보통, 1: 25/1/좋음}.

| Case | Title | Text |
| --- | --- | --- |
| `todayWeather`, `dateObj 07:00` | `집 현재: ⛅,18˚,초미세먼지 보통` | `오늘: 맑음🌞→비☔,최저18˚(+1) 최고24˚,미세먼지 보통` |
| `todayWeather`, `19:00`, dry | `집 현재: ⛅,18˚,초미세먼지 보통` | `내일: 비☔→구름적고⛅,최저15˚(-2) 최고21˚(-4),강수확률 70%,초미세먼지 나쁨,오존 좋음` |
| `todayWeather`, `19:00`, `current.pty 1, rn1 2.5, skyIcon 'cloud_rain'` | `집 현재: ☔,18˚,초미세먼지 보통,강수량 2.5mm` | Same day line **without** `강수확률` |
| `todayAir`, `07:00` | `집 ` | `현재: 대기질은 보통입니다.` ⏎ `오늘: 초미세먼지 평균20 보통, 미세먼지 평균40 보통` |
| `todayAir`, `19:00` | `집 ` | `현재: 대기질은 보통입니다.` ⏎ `내일: 초미세먼지 평균45 나쁨` |
| `todayAir`, `07:00`, no `summaryAir` | `집 ` (the builder title is empty) | `undefined` |

Rules shown: the 18:00 switch, `wf` cleanup, the PM10 tie rule for `dustForecast`, truncation versus rounded delta (`24.6` → `최고24˚` with no delta against 25), POP suppression before 18:00 and while raining, comma joining, and the discarded day summary.

### 4.2 DSF alarm, `lang=en`, `name='Paris'`

Fixture: `thisTime[1] {dateObj, skyIcon:'sun_smallcloud' (dry) or 'cloud_rain' (raining), t1h:0, pty:<precType>, rn1:1.2, arpltn:{pm25Grade:3 'Unhealthy', pm10Grade:2}}`; `daily` 09-23 `{tmn:9.4, tmx:17}`, 09-24 `{sun_smallcloud, tmn:10, tmx:18.2, pty:0, pop:10}`, 09-25 `{sun_bigcloud_rain, tmn:11, tmx:16, pty:1, pop:80}`, 09-26 `{cloud}`.

| Case | Title | Text |
| --- | --- | --- |
| `19:00`, `pty 0` (dry) | `Paris Current: ⛅,0˚,PM2.5 Unhealthy` | `Tomorrow: ☔→☔,Lowest11˚(+1) Highest16˚(-2)` |
| `19:00`, `pty 1` (raining) | `Paris Current: ☔,0˚,PM2.5 Unhealthy,Precipitation 1.2mm` | `Tomorrow: ☔→☔,Lowest11˚(+1) Highest16˚(-2),Chance of precipitation 80%` |
| `08:00`, `pty 0` | `Paris Current: ⛅,0˚,PM2.5 Unhealthy` | `Today: ⛅→⛅,Lowest10˚(+1) Highest18˚(+1)` |
| `todayAir`, `summaryAir:'Air quality is moderate'` | `Paris ` | `Current: Air quality is moderate` (no `pollutants` in DSF `airInfo`) |
| `todayAir`, no `airInfo` | — | Throws `airInfo is invalid`; no notification |

Rules shown: the DSF POP inversion (POP only while currently precipitating), 0˚ kept, the repeated emoji pair, and the missing air item in the day line.

### 4.3 Alert worker, KMA response, `airAlertsBreakPoint 3`

Fixture: `current {dateObj:'2026.09.24 14:30'}`; `shortest` 15:00 `pty 1`, 16:00 `pty 1`, 17:00 `pty 0`; `short` 18:00 `pty 1`; `airInfo.last {dataTime:'2026-09-24 14:00', pm10Grade 2, pm25Grade 2, o3Grade 3, o3Str:'나쁨'}`; record `name '잠실본동'`, `lang ko`. Poll time is given in UTC.

| Case | Stored state before | Decision | Title / text | State after |
| --- | --- | --- | --- | --- |
| C1 05:35, `pty 1, rns true` | `lastState 1`, `lastGrade 2`, both `pushTime` 7 h ago | `air` | `잠실본동 14:30` / `비가 내리고 있습니다. 14시 오존이 나쁨입니다.` | `lastState 1`, `lastGrade 3` |
| C2 05:17, `pty 0` | `lastState 0`; `lastGrade 3` (air gate closed) | `weather` (forecast from the 15:00 + 16:00 slots) | `잠실본동 예보` / `15시부터 비가 내릴 예정입니다. 14시 오존이 나쁨입니다.` | `lastState 1` |
| C3 05:35, same data as C2 | Same as C2 | `none` (no forecast lookup at :35) | — | `lastState 0` |
| C4 05:07, `pty 1, rns false`, breakpoint 4 | Empty | `none` (air gate open, grade 3 < 4) | — | `lastState 1`, `lastGrade 3`; the rain state now blocks a later rain alert until a dry poll |

C1 and C2 show that the text ignores the decision, and C1 shows the ozone particle fix. With `lang en` the air-only title is `<name> AQI ` and the sentence `14h O3 is <o3Str>.`

## 5. Purchase validation (`POST /check-purchase`)

### 5.1 Mounts, callers, traffic and configuration

- **Route.** One `router.post('/')` in [receiptValidation.js](../../server/routes/v000705/receiptValidation.js), mounted as `/check-purchase` under [v000705](../../server/routes/v000705/index.js#L29), [v000803](../../server/routes/v000803/index.js#L118), [v000901](../../server/routes/v000901/index.js#L27), [v000902](../../server/routes/v000902/index.js#L27) and [v000903](../../server/routes/v000903/index.js#L27). The app-level JSON and URL-encoded body parsers apply ([app.js](../../server/app.js#L91-L92)). Under `/v000803` every POST first passes that router's JWT gate, which answers a receipt body without a valid `bearertoken` header with an HTTP 500 error page ([gate](api-endpoint-catalog.md#authentication-and-gating)).
- **Callers.** Both client variants use `clientConfig.serverUrl + '/v000705/check-purchase'`: the alexdisler controller posts JSON with a 10 s timeout ([request](../../client/www/js/controller.purchase.alexdisler.js#L45-L67)); the j3k0 controller sets it as `store.validator` ([validator](../../client/www/js/controller.purchase.j3k0.js#L113)). The gulp iOS tasks install the alexdisler plugin and copy its controller; the Android tasks install the j3k0 plugin ([gulpfile](../../client/gulpfile.js#L79-L94)). Products are `tw1year` (TodayWeather) and `ta1year` (TodayAir).
- **Traffic.** The 30-day CloudFront report (2026-08-23T19:53:45Z to 2026-09-22T19:53:45Z) lists 19 product-API method/path groups, and its scope includes every `/vNNNNNN/...` path. None is `check-purchase`, so **zero requests were observed** in that window. Requests that bypass that distribution are not covered ([report](../../reports/aws/api-traffic-2026-09-22.md#api-paths-and-responses)).
- **Configuration names only** ([config](../../server/config/config.js#L70-L77), [iap.config](../../server/routes/v000705/receiptValidation.js#L10-L28)): `applePassword` ← `APPLE_PASSWORD`; `googlePublicKey` ← `GOOGLE_PUBLIC_KEY`, used as both the sandbox and live key; `googleAccToken` ← `PLAY_STORE_API_ACCESS_TOKEN`; `googleRefToken` ← `PLAY_STORE_API_REFRESH_TOKEN`; `googleClientID` ← `PLAY_STORE_API_CLIENT_ID`; `googleClientSecret` ← `PLAY_STORE_API_CLIENT_SECRET`. Unset variables fall back to placeholder strings. `iap.setup` failure is only logged. The validator library is `in-app-purchase` `^1.8.4` ([package.json](../../server/package.json#L43)); its store calls and result fields are library behavior that was not executed here.

### 5.2 Request variants

| Sender | Body the route reads | Resulting branch |
| --- | --- | --- |
| alexdisler, iOS | `{type:'ios', id:'tw1year'\|'ta1year', receipt:<plugin receipt>}` from `getReceipt()` (restore) or `subscribe().receipt` ([bodies](../../client/www/js/controller.purchase.alexdisler.js#L116-L137), [subscribe](../../client/www/js/controller.purchase.alexdisler.js#L317-L322)) | iOS |
| alexdisler, Android (in source; the gulp Android tasks use j3k0) | `{type:'android', id, receipt:[<plugin purchase records with receipt and signature>]}` | Android, `receipt[0]` only |
| j3k0 | No `receipt`; `transaction.type == 'android-playstore'` | Adapter: `type = 'android'`, `receipt = [{receipt: transaction.receipt, signature: transaction.signature}]` → Android |
| j3k0, any other transaction | No adapter; `type = body.type` | Must be literally `ios` or `android`, otherwise HTTP 500 `Unknown type`. The plugin's own body is not in this checkout, so what it sends for iOS is unverified. |

`id` (the product id) is used only by the iOS branch.

### 5.3 Ordered validation

| Step | iOS (`type === 'ios'`) | Android (`type === 'android'`) |
| --- | --- | --- |
| 1 | `iap.validate(iap.APPLE, receipt)` | Logs an error if `receipt.length > 1`, then `iap.validate(iap.GOOGLE, {data: receipt[0].receipt, signature: receipt[0].signature})`. A missing receipt, an empty array or an object without index 0 throws a TypeError → HTTP 500 text. |
| 2 | Validator error → `{ok:false, data:{code:6778002, message: err.message}}` | Same |
| 3 | `!iap.isValidated(result)` → `{ok:false, data:{code:6778001, message:'receipts is invalid'}}` | Same |
| 4 | `calcExpirationDate(id, result.receipt.in_app)` (§5.4); `undefined` → `{ok:false, data:{code:6778003, message:'service is expired or canceled'}}` | `result.expirationTime <= now` → the same 6778003 envelope. No product filter and no cancellation check. |
| 5 | `result.receipt.expires_date = <UTC string>`; respond `{ok:true, data: result.receipt}`. `in_app` is returned sorted in place. | `product_id = productId`, `purchase_date_ms = purchaseTime`, `expires_date = new Date(Number(expirationTime)).toUTCString()`; respond `{ok:true, data: result}`. Without `expirationTime`, the `<=` test is false and `expires_date` becomes `Invalid Date` (JavaScript semantics; the library output was not checked). |

The Apple receipt's own subscription expiry fields are never read. The iOS callback reads `result.receipt.in_app` outside the route's `try`; an exception there is not turned into a response by the route (outcome depends on the library, not verified).

### 5.4 iOS expiry algorithm

[`calcExpirationDate`](../../server/routes/v000705/receiptValidation.js#L30-L73):

1. Sort `in_app` ascending by `purchase_date_ms` with `<`/`==`/`>`. The array is mutated. Apple sends these as strings, and equal-length digit strings compare like numbers.
2. For each entry: skip it when `product_id !== id` or when `cancellation_date` is present. Let `p = new Date(Number(purchase_date_ms))`.
3. If there is no running expiry, or `p` is **later than** it: expiry = `p` + 1 year (reset). Otherwise (`p` at or before the expiry): expiry += 1 year (extend), however early the purchase was.
4. No expiry, or expiry before `Date.now()` → `undefined` (6778003). Otherwise return `expiry.toUTCString()`, e.g. `Mon, 01 Mar 2027 00:00:00 GMT`.

Years are added with `setFullYear` in the server process's local time zone. The client stores `data.expires_date` unchanged as `purchaseInfo.expirationDate` and later parses it with `new Date()` ([alexdisler](../../client/www/js/controller.purchase.alexdisler.js#L344-L348), [j3k0](../../client/www/js/controller.purchase.j3k0.js#L138-L143)). Both platforms therefore return `toUTCString()` text.

**Worked timeline (synthetic execution, 2026-09-24; re-run 2026-09-25 on the `bd6640f2` files, where `receiptValidation.js` is unchanged):** the function was extracted verbatim and run in Node 24.21.0 with a fixed `Date.now`, under `TZ=UTC` and `Asia/Seoul` with identical results. All purchases are at 00:00 UTC.

| `in_app` entry (input order shuffled) | Effect with `id = 'tw1year'` | Running expiry |
| --- | --- | --- |
| `tw1year` 2024-01-10 | First purchase: reset | 2025-01-10 |
| `tw1year` 2024-12-20 | At or before the expiry: extend | 2026-01-10 |
| `tw1year` 2026-03-01 | After the expiry (lapsed): reset | 2027-03-01 |
| `tw1year` 2026-06-01 with `cancellation_date` | Skipped | 2027-03-01 |
| `ta1year` 2026-07-01 | Other product: skipped | 2027-03-01 |

| Check | Result |
| --- | --- |
| Now 2026-09-24 | `Mon, 01 Mar 2027 00:00:00 GMT` → `ok:true` |
| Only the first two entries, now 2025-06-01 | `Sat, 10 Jan 2026 00:00:00 GMT` |
| Full list, now 2027-03-02 | `undefined` → 6778003 |
| Two purchases on 2024-01-10 and 2024-01-11, now 2024-06-01 | `Sat, 10 Jan 2026 00:00:00 GMT`: a second purchase inside a window adds a whole year |
| `id = 'ta1year'` on the full list | `Thu, 01 Jul 2027 00:00:00 GMT` (only the TodayAir entry counts) |
| `id` missing | Every entry is skipped → `undefined` → 6778003 |

### 5.5 Response envelope and HTTP status

| Outcome | HTTP | Body |
| --- | --- | --- |
| Valid, not expired | 200 JSON (`res.send(object)`) | `{ok:true, data:{…store result…, expires_date:'<toUTCString>'}}` |
| Store or validator error | 200 JSON | `{ok:false, data:{code:6778002, message}}` |
| Invalid receipt | 200 JSON | `{ok:false, data:{code:6778001, message:'receipts is invalid'}}` |
| Expired, cancelled, other product or missing `id` (iOS) | 200 JSON | `{ok:false, data:{code:6778003, message:'service is expired or canceled'}}` |
| Unknown `type`, or a synchronous exception such as a malformed Android receipt | 500, string body (`res.status(500).send(e.message)`; Express labels a string body `text/html`) | Exception message, e.g. `Unknown type` |

The source comment names the codes `INVALID_PAYLOAD` (6778001), `CONNECTION_FAILED` (6778002) and `PURCHASE_EXPIRED` (6778003). A client must treat `ok`, not the HTTP status, as the validation result. The alexdisler client treats a non-2xx response as a connection failure and `ok:false` as a store message ([client](../../client/www/js/controller.purchase.alexdisler.js#L329-L341)).

## 6. Rewrite decisions to make explicitly

Preserve or change each item deliberately, and record the choice in [decisions and open questions](decisions-and-open-questions.md):

- **Worker contract.** The workers consume v000902 KMA/DSF shapes, including the singular `airInfo`, lower-case icon names and `dustForecast` grades shifted by one. Port the builders or keep an equivalent internal contract before retiring v000902.
- **Alarm text quirks.** Evening-only KMA POP versus DSF POP only while precipitating; KMA omits 0˚; truncated temperatures with rounded deltas; PM10 wins `dustForecast` ties; `_getAqiStr` has no fallback and an inconsistent comparator; TodayAir without `summaryAir` sends an undefined body; KMA `pty` values outside 1–3 produce an empty label.
- **Alert semantics.** Current precipitation alerts require `rns`; forecasts are looked up only at :07/:17 and only for precipitation; air forecasts are computed but discarded; any alert starts a shared 6-hour quiet period; the text ignores the decision; state is written before submission; a record without `airAlertsBreakPoint` never receives air alerts.
- **Retention.** Alarm records unused for 60 days are deleted; the alert cleanup never matches because of the `updateAt` field name.
- **Legacy iOS registrations.** Since `45b2eb3f`, iOS records without `fcmToken` are still stored, selected and requested, then fail at send time. Alert records among them also start a 6-hour quiet period. Decide whether to purge, disable or migrate them, and whether the worker should skip them before requesting weather (§1.1).
- **Provider initialization.** Firebase apps are created lazily per product, and a missing service-account file fails each send separately instead of failing at startup. Decide whether the replacement validates provider credentials at startup (fail fast) or keeps lazy loading so that non-push processes need no push credentials.
- **Entitlement.** iOS expiry is computed from purchase dates (+1 year per in-window purchase, reset after a lapse), not from store expiry fields. Android trusts `expirationTime` with no product or cancellation filter. Every validation outcome is HTTP 200 with `ok`. j3k0 non-Android bodies fail with HTTP 500. No `check-purchase` traffic was observed in the 30-day window, so a retirement or replacement decision needs release and store evidence, not traffic alone.
