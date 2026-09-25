# Client state and behavior reference

## Scope and evidence

Source baseline: `bd6640f2` (re-baselined 2026-09-25; `client/` is identical to `ff7acf3996ccb66c912d2ed4710cf300197d6966`, inspected 2026-09-23, so the storage and push/Branch probe results still apply; both were re-run at `bd6640f2` with identical output). This documents current behavior and the boundaries a rewrite needs to test. It does not claim that every behavior is desirable, every plugin works on current iOS, or the stored format has a formal schema. [Client data contracts](client-data-contracts.md) covers wire and normalized fields; [rewrite playbook](rewrite-playbook.md) covers migration choices.

The main web implementation is `client/www/`. Native widget code and bundled platform `www` trees can differ. Gulp replaces configuration, resources and purchase-controller implementations for product/platform variants. A replacement client must choose which variants it supports before treating a source file as universally shipped.

## Runtime ownership

| Component | Current responsibility | Suggested boundary to retain in a rewrite |
| --- | --- | --- |
| `app.js` | Angular modules, platform-ready startup, locale/native integration, route setup, D3 directives and application events | Separate bootstrap/lifecycle, navigation and chart rendering |
| `TwStorage` | JSON localStorage plus native app-preference mirroring and legacy migrations | Versioned persistence adapter with explicit migration outcomes |
| `WeatherInfo` | Mutable cities, selected index, ten-minute load gate, normalized data and widget projection | Stable location identity, cached view data and request freshness |
| `WeatherUtil` | URL construction, overlapping HTTP timers, geolocation watch, API-to-view-model conversion, photos | Transport, geolocation and provider adapters with explicit contracts |
| `StartCtrl` / `SearchCtrl` | First-run city selection, current position, autocomplete, add/remove/enable favorites | Location-management workflow |
| `TabCtrl` | Shared dimensions, city switching, refresh/resume, popup/loading, sharing, AQI palette | Screen lifecycle coordinator; avoid response ownership by current tab index |
| `ForecastCtrl` / `AirCtrl` | Derive view state from selected city and respond to applyEvent | Pure screen selectors where practical |
| `Units` / `radioList` | Unit defaults, selection, settings persistence, reload and push propagation | Settings state with value-unit consistency |
| `Push`, `Purchase`, `TwAds` | Native registration, receipt validation, entitlements and ads | Platform adapters separated from rendering |

Sources: [app](../../client/www/js/app.js), [WeatherInfo](../../client/www/js/service.weatherinfo.js), [WeatherUtil](../../client/www/js/service.weatherutil.js), [TabCtrl](../../client/www/js/controller.tabctrl.js), [build tasks](../../client/gulpfile.js).

## Startup and navigation

1. Platform-ready initialization establishes locale/platform information and native event handlers. The web entry relies on Cordova `deviceready`; a plain browser does not automatically provide the same startup event.
2. `TwStorage.init()` initializes product defaults, attempts native preference restoration/migration where available, and publishes `settingsInfo` on root scope. The application continues in its `.finally()` handler.
3. Theme paths come from `window.theme[settingsInfo.theme]`. `WeatherInfo.loadCities()` restores full cities and selection ([restore rules](#persisted-record-shapes)), creates a disabled current-location placeholder for a new install, and starts loading the [weather photo feed](client-data-contracts.md#weather-photo-feed).
4. Startup invokes `Push.init()`, `Purchase.init()`, then `Units.loadUnits()`. Push loading may schedule a list repost after three seconds. When it migrates a legacy `pushData` list it returns true, and `app.js` broadcasts `showAlertInfoEvent` 500 ms later ([legacy migrations](#legacy-migrations)). Native setup can have side effects beyond showing the first screen.
5. If `startVersion` is null or lower than `Util.startVersion`, route to `/start`. Otherwise use the saved startup page. App-version/update-dialog state is checked separately.
6. `TabCtrl.init()` prepares the air palette and advertisements, then broadcasts `reloadEvent` with sender `init`. Forecast/Air controllers render cached city state and later receive `applyEvent` after data updates.

| Persisted startupPage string | Route | Product UI selection |
| --- | --- | --- |
| `"0"` | `tab.forecast` | TodayWeather hourly, default for TodayWeather |
| `"1"` | `tab.dailyforecast` | TodayWeather daily |
| `"2"` | `tab.search` | Both products' favorites/search |
| `"3"` | `tab.air` | Both; default for TodayAir |
| `"4"` | `tab.weather` | TodayAir combined weather |

The settings picker exposes only applicable values, but restored settings are strings and can contain invalid/old values. An unknown value falls back by package. Initial selection/start screens and missing-location/error paths must remain usable without weather data.

Sources: [app startup and routes](../../client/www/js/app.js), [entry HTML](../../client/www/index.html), [StartCtrl](../../client/www/js/controller.start.js), [settings options](../../client/www/js/controller.settingctrl.js).

## City model, selection and update semantics

The first list entry is treated as current position throughout the app. A new entry starts with `currentPosition:true`, `disable:true`, null address/location/weather/chart/photo fields. Saved entries default missing `disable` to false and missing `photo` to null. **Every restored city's in-memory loadTime is reset to null**, even when persisted weather is available.

Favorites are deduplicated by address, and by name when either item has one; current-position entries match each other by their flag. Coordinates alone are not the identity. The selected city is a mutable integer persisted as `cityIndex`; swipe navigation skips the disabled first entry and wraps. Removing a city splices the list. Push and widget integrations carry list indexes ([inbound notification payload](client-data-contracts.md#inbound-notification-payload), [app entry links](client-data-contracts.md#app-entry-links), [push records](#persisted-record-shapes)), so reorder/delete is an external contract concern, not merely UI state.

`WeatherInfo.updateCity(index, data)`:

- Replaces currentWeather/timeTable/timeChart/dayTable/dayChart/source/airInfo/airInfoList only when each incoming value is truthy. Omitted air fields therefore leave prior values in place; there is no explicit stale/removed-field marker.
- Updates name/country/address/location on the current-position city only when supplied truthily. For a fixed favorite, it repairs location only if the old latitude is absent/falsy and the new latitude is truthy.
- Calls the optional `window.updateCityInfo(index)` push integration hook, then sets loadTime to the current Date, selects a photo, and persists full cities plus their simplified native projection.

The converter emits dayChart rather than dayTable, although older model/update slots retain dayTable. This distinction matters when reading old storage or writing a replacement adapter.

Sources: [WeatherInfo createCity/getIndexOfCity/updateCity/saveCities](../../client/www/js/service.weatherinfo.js), [favorite manipulation](../../client/www/js/controller.searchctrl.js), [push index linkage](../../client/www/js/service.push.js).

## Refresh, cache and concurrent work

| Mechanism | Observed behavior | Consequence |
| --- | --- | --- |
| City memory freshness | canLoadCity is false for disabled city; otherwise null loadTime or strictly more than 10 minutes permits reload | Exactly ten minutes does not yet reload; restoration resets the gate |
| Immediate render | loadWeatherData broadcasts applyEvent before fetching | Persisted or previous city data can appear while a request is in flight |
| Resume/search event | Reload skipped if canLoadCity is false | Returning to a recent city need not issue a request |
| Other reload events | Clear selected city's loadTime, then load | Manual refresh/push/init can bypass the normal gate |
| Refresh interval | String minutes: 0/manual, 30, 60, 180, 360, 720; a timeout broadcasts refreshTimer | Separate from the ten-minute freshness gate and HTTP timers |
| Current location | Request saved location weather and obtain current location concurrently; coordinate change may cause another request | One user refresh can create multiple logical weather requests |
| HTTP timers | Attempt N+1 starts 2 s after attempt N unless attempt N itself has settled (max three attempts). A later attempt can start after an earlier attempt already settled the shared promise. Default timeout 10 seconds each | Slow requests overlap; this is not retry-after-failure. Example: attempt 1 resolves at 2.5 s while attempt 2 (started at 2 s) is still pending, so attempt 3 is still issued at 4 s |
| HTTP settlement | Success or error clears only that attempt's timer; first callback settles shared promise; no cancellation of already started requests | An early error can reject while another request remains in flight; a fast failure may prevent another attempt |
| Nation timeout | Same HTTP wrapper with 20 seconds per request | Potentially overlapping national requests are longer-lived |

The HTTP comment mentions 1.5-second retries and nine seconds total; executable code uses two-second timers and ten seconds per request. The otherwise unused three-argument overload also resets timeout before assigning callback. Do not copy comments or the overload into a new transport design.

**Response ownership risk:** TabCtrl's `updateWeatherData(geoInfo)` applies a successful result to `WeatherInfo.getCityIndex()` at completion, not an index captured when the request started. This source pattern warrants a race regression for switching cities mid-request; no live reproduction was performed here. Bind request results to stable location IDs/generations in a rewrite.

City memory freshness, provider/database freshness and gateway/CDN caching are independent. No full offline synchronization or cache-invalidity policy is established by this code. See [server data lifecycle](server-data-lifecycle.md) for provider/cache layers and [mobile API architecture](../architecture/mobile-api.md) for timestamped deployment cache observations.

Sources: [WeatherUtil HTTP wrapper](../../client/www/js/service.weatherutil.js), [WeatherInfo canLoadCity/reloadCity](../../client/www/js/service.weatherinfo.js), [TabCtrl loadWeatherData/updateWeatherData/reloadEvent](../../client/www/js/controller.tabctrl.js).

## Geolocation and failures

`WeatherUtil.getCurrentPosition()` uses navigator.geolocation.watchPosition with `timeout:60000`, `maximumAge:60000`, `enableHighAccuracy:true`. On first success it clears the watch and returns `{coords, provider:'watchPosition'}`. A truthy watch ID rejects duplicate calls as `alreadyCalled`. The error handler rejects without clearing that watch ID in the inspected function; whether later platform events recover it is a separate runtime question. Controllers also handle native diagnostic/location authorization and settings navigation.

Locations are normalized to three decimal places by `geolocationNormalize`. Compare this with native/provider precision requirements before adopting it as a universal rule. The URL branch and push helper both treat latitude zero as absent. Direct DSF responses use `location.lon`; the public gateway historically overwrites this with client-compatible `location.long`. Preserve that adapter explicitly when replacing or bypassing the gateway; the converter itself does not rename the field.

Transport errors become an Error with an HTTP status `code`; conversion failure returns null. Start/Tab controllers show translated retry prompts and analytics. Reload while an existing confirmation popup is open is skipped to avoid duplicate dialogs during permission/resume cycles. Existing cached fields can remain visible because a failed request does not complete a normal data update. Error objects, empty content, loading state and stale content are not represented by one explicit state machine.

Rewrite acceptance should distinguish `uninitialized`, `locating`, `loading with cached data`, `loaded`, `empty`, `stale`, `denied`, `offline`, and `error`; these names are proposed target states, not current enum values. Source: [WeatherUtil geolocation](../../client/www/js/service.weatherutil.js), [StartCtrl retry/authorization](../../client/www/js/controller.start.js), [TabCtrl retry/authorization](../../client/www/js/controller.tabctrl.js).

## Persistence and native preferences

`TwStorage.get(name)` JSON-parses localStorage; absent entries normally return null, malformed JSON is caught/logged and returns undefined. Callers do not all distinguish those safely (for example `loadCities` checks `items === null` before `items.forEach`). `TwStorage.set` JSON-stringifies and writes localStorage, and also schedules native storage when appPreferences exists. Native failure is logged; it does not roll back localStorage or provide a commit acknowledgement to the caller.

The native suite is the product's app group, `<app-group>`: a literal prefix plus the lower-case `clientConfig.package` (`todayweather` or `todayair`) ([service.storage.js](../../client/www/js/service.storage.js#L9-L12)). [Configuration inventory §4](configuration-inventory.md#4-native-hard-coded-constants) classes the app-group identifier as a Private ID, so it is not reproduced here. Android has an older suite `net.wizardfactory.todayweather_preferences` ([L5](../../client/www/js/service.storage.js#L5)). Preserve app-group relationships when widgets are in scope; suites per consumer are in [native consumers §3.1](native-consumers-and-plugins.md#31-suites).

| Key | Current value/use | Migration attention |
| --- | --- | --- |
| `cities` | Full mutable city array, including weather/air/charts, flags and photo | Cached domain data and view models are mixed; loadTime JSON date string is reset to null on restore |
| `cityIndex` | integer selected list index; absent on a new install | Migrate selection to stable location ID while translating native/push indexes; null/out-of-range/negative handling below |
| `cityList` | `{cityList:[{name?,currentPosition,address,location,country,index}]}` for enabled cities | Widget projection; omits weather and disabled locations, retains original full-list index |
| `settingsInfo` | `{startupPage:string,refreshInterval:string,theme:string}` | Product defaults; theme options vary by package |
| `units` | six unit settings on the Units object | Legacy `aircn` replacement; missing members filled from `Util.region` defaults |
| `pushData2` | registrationId/type/category/fcmToken/pushList; serialized alarm/alert Date fields | Rehydrate Dates and repair records on load; migrated from older `pushData.alarmList` (record shapes below) |
| `pushData` | legacy `{registrationId,type,alarmList}` | Current code reads it and mirrors it to native but never writes or removes it; still in native restore-key lists |
| `purchaseInfo` | accountLevel and expirationDate | Stored level is `free` or `premium`; `paid` is in-memory only ([other keys](#persisted-record-shapes)); expiration must remain parseable |
| `storeReceipt` | plugin receipt envelope | Sensitive; not plain UI cache; preserve only through a reviewed migration |
| `twAdsInfo` | `{enable:boolean}` written from purchase state | Absent key or `enable` means enabled unless a pending entitlement request wins |
| `startVersion`, `appVersion`, `disableUpdateInfo` | onboarding/update-dialog state | `guideVersion` migrates to startVersion only under the conditions in [legacy migrations](#legacy-migrations); app release is distinct from onboarding version |
| `expandShortChart` | boolean expanded hourly detail | UI preference |
| `daumServiceKeys` | configured provider key list | Sensitive configuration, not a user-owned preference to export blindly |

Native restoration is selective:

1. If localStorage is completely empty, fetch a fixed allowlist from the current native suite and copy values into localStorage; failures still allow initialization to finish.
2. Otherwise run backward compatibility, load absent units/cityList/daumServiceKeys from the old/current suite (also purchaseInfo on Android), then mirror a limited localStorage list to native.
3. `setForwardCompatibility` supplies theme light if missing and publishes settingsInfo.

**Observed gap:** the fixed empty-localStorage restore list includes `pushData` but not the current `pushData2` key, even though ordinary TwStorage.set writes pushData2 to native. Recovery after WebView storage loss may therefore lose current push settings from the app view. This is a source-based migration risk, not a demonstrated production incident.

No persistence version envelope, transaction across local/native stores or comprehensive malformed-data recovery exists here. The synthetic fixtures [storage-current.json](examples/storage-current.json) and [storage-legacy.json](examples/storage-legacy.json) cover the current key set (except the sensitive `storeReceipt` and `daumServiceKeys`) and the legacy keys, including an address-only city, `aircn`, standalone settings and `pushData`. Backup/restore fixtures are still needed for malformed JSON in other keys, missing units, WebView wipe with native preferences retained, and delayed native write failures. Sources: [TwStorage](../../client/www/js/service.storage.js), [WeatherInfo native projection](../../client/www/js/service.weatherinfo.js), [Push load/save](../../client/www/js/service.push.js), [Units](../../client/www/js/controller.units.js).

### Persisted record shapes

Statements marked *synthetic execution* come from the storage harness, first run on 2026-09-24 and now checked in as [client-storage-migration.js](../../reports/rewrite-verification/probes/client-storage-migration.js). Its [record](../../reports/rewrite-verification/probes/client-storage-migration.json) of the 2026-09-25 re-run (Node v24.21.0) shows 24/24 checks matching the fixtures' recorded outcomes and the statements labelled synthetic execution here. Both fixtures were loaded through the checked-in startup order `TwStorage.init` → `WeatherInfo.loadCities` → `Push.init` → `Units.loadUnits` ([app.js](../../client/www/js/app.js#L328-L341)) in an isolated Node VM; `Purchase.init` and the rest of that callback ([L343-L416](../../client/www/js/app.js#L343-L416): the `daumServiceKeys` write, routing and the update check) were not run. The run used a stubbed `appPreferences` (present, empty native suite), iOS platform, `Util.region` `KR`, no Firebase plugin, a fixed clock of 2026-09-24 09:00 Asia/Seoul and a `$http` that throws. No request was attempted. Variants used the same harness: an empty store, `cityIndex` 5, -1 and malformed JSON, an unparsable `pushData2`, several legacy alarms per city, a legacy `pushData` without `alarmList`, and `updateCityInfo(1)` before the popup answer. Each fixture's `expectedAfterStartup` and `variantRuns` blocks record the observed results. Everything else here is observed source.

**`cities[]` entry** ([createCity](../../client/www/js/service.weatherinfo.js#L8-L29), [addCity/updateCity](../../client/www/js/service.weatherinfo.js#L152-L276), [saveCities](../../client/www/js/service.weatherinfo.js#L377-L380)):

| Field | Persisted type | Written by | Rule |
| --- | --- | --- | --- |
| `currentWeather`, `timeTable`, `timeChart`, `dayChart`, `source`, `airInfo?`, `airInfoList?` | Normalized view model ([normalization](client-data-contracts.md#normalization-into-screen-state)) | `saveCity` → `addCity`; `updateCity` | Update replaces each member only when the incoming value is truthy |
| `name?`, `address`, `country?`, `location:{lat,long}` | Geography | `saveCity` from geoInfo; `updateCity` for the current-position entry only | Older favorites can be address-only; a fixed favorite gains `location` only through the falsy-`lat` repair |
| `currentPosition` | boolean | Placeholder `true`; `saveCity` sets `false` for favorites | Index 0 is the current-position entry by convention |
| `disable` | boolean | Placeholder `true`; `addCity` `false`; `disableCity()` for index 0 | Missing on restore → `false`, even for a current-position entry with `address:null` (synthetic execution) |
| `photo` | `twUrls.regular` string or `null` | `addCity`/`updateCity` via `_getPhoto`; `loadWeatherPhotos` fills `null` entries | Missing on restore → `null`; see [Weather photo feed](client-data-contracts.md#weather-photo-feed) |
| `loadTime` | ISO string or `null` | `new Date()` on add/update | Always reset to `null` on restore |
| `dayTable` | Legacy slot | Placeholder `null`; older saves | The converter never emits it |

The new-install placeholder is `{currentPosition:true, address:null, location:null, currentWeather/timeTable/timeChart/dayTable/dayChart:null, disable:true, photo:null, loadTime:null}`. `loadCities` does not save it (synthetic execution: after an empty-store start only `settingsInfo` and `units` were written). The first `saveCities` persists it, for example after a successful photo-feed load, `disableCity` or `addCity`. **Source anomaly (not reproduced):** `SearchCtrl.init` writes display placeholders into the shared city objects: an absent `currentWeather` becomes `{}`, then a missing `skyIcon` becomes `'sun'` and an undefined `t1h` becomes `'-'` ([SearchCtrl](../../client/www/js/controller.searchctrl.js#L128-L136)). The next `saveCities` persists them.

**Selection (`cityIndex`).** Every accepted `setCityIndex` stores a JSON number. `loadCities` handles the stored value as follows ([source](../../client/www/js/service.weatherinfo.js#L319-L331)):

| Stored value | Result |
| --- | --- |
| Absent | `setFirstCityIndex()` |
| `>= cities.length` | `setFirstCityIndex()` (synthetic execution: 5 → 0) |
| Negative | Kept unchanged; no guard (synthetic execution: -1 stays -1). `setCityIndex` never writes one, so only an external or corrupted write can produce it |
| Malformed JSON | `TwStorage.get` returns `undefined`, which is kept (synthetic execution) |

`setFirstCityIndex` picks 0 when the current-position entry is enabled, and 1 when it is disabled and favorites exist. Otherwise it requests -1. `setCityIndex` rejects anything outside `0..length-1` and records only the analytics event `city/error/Invalid set index`. On a new install the in-memory selection therefore stays `null` (synthetic execution) until a later call selects a valid index, for example `disableCity(false)` (`null <= 0` triggers `setFirstCityIndex`) or adding a favorite (SearchCtrl then selects the new last index). `removeCity` resets the selection only when the stored index equals the new length ([source](../../client/www/js/service.weatherinfo.js#L166-L179)). Deleting an earlier entry keeps the same number selected, which now names the following city.

**`pushData2`.** The key stores the whole in-memory `Push.pushData` object `{registrationId, type:'ios'|'android'|'', category:'', fcmToken, pushList:[...]}`. The top-level `category` is never assigned. Records ([newPushAlert/newPushAlarm](../../client/www/js/service.push.js#L534-L589), [PushCtrl defaults](../../client/www/js/controller.push.js#L33-L53)):

| Field | Alert | Alarm |
| --- | --- | --- |
| `cityIndex` | Full-list index | Same |
| `id` | PushCtrl default 1 | PushCtrl defaults 2 and 3; after that, last alarm id + 1 |
| `category`, `enable` | `'alert'`; `enable` defaults to `true` and follows the alert switch ([template](../../client/www/templates/setting-push.html#L14-L22)) | `'alarm'`, `true`; the time picker's cancel button (labelled `LOC_DELETE`) sets `false` instead of deleting the record, and the screen hides disabled alarms; a new alarm can be added only while fewer than five are enabled ([PushCtrl](../../client/www/js/controller.push.js#L370-L424), [template](../../client/www/templates/setting-push.html#L43-L47)) |
| Time | `startTime`, `endTime`: Date; defaults 07:00 and 22:00 local | `time`: Date; defaults 07:40 and 20:20 local |
| `dayOfWeek` | — | `boolean[7]`, Sunday first; default Monday–Friday; on save, all of a city's alarms share one array |
| City info | `name`, `source`, `location?`, `town?:{first,second,third}`, copied from `_getSimpleCityInfo(cityIndex)` ([source](../../client/www/js/service.push.js#L475-L524)). `location` is copied only when `lat` is truthy; `town` only for `source:'KMA'` with an address that parses to a non-empty `first`. A missing `name` falls back to `town.third`, then `second`, then `first` | Same |

PushCtrl never deletes a record. Saving writes the city's alert plus every alarm, including cancelled ones with `enable:false`, and replaces that city's records ([PushCtrl](../../client/www/js/controller.push.js#L169-L188), [updatePushListByCityIndex](../../client/www/js/service.push.js#L663-L674)). PushCtrl adds the default alert only when the city has none, and the two default alarms only when it has no alarm. A city with no prior records therefore gets one alert and two alarms on its first save, and later push-screen saves never reduce the alarm count.

**Source anomaly (not reproduced):** `_generateId` inspects only the current city's records ([PushCtrl](../../client/www/js/controller.push.js#L125-L137)), so the same ids recur across cities and a record is identified only by `(cityIndex, id)`.

**Source anomaly (not reproduced):** deleting a favorite with enabled push records removes only the records whose `cityIndex` equals the deleted index ([SearchCtrl](../../client/www/js/controller.searchctrl.js#L606-L614), [removePushListByCityIndex](../../client/www/js/service.push.js#L680-L701)). The check uses `hasPush`, computed by `Push.hasPushInfo` when the favorites screen initializes, which requires an enabled record; records of a city whose records are all disabled are not removed at all. Nothing re-indexes the rest. Records of later cities keep their old index, which after the splice names the next city or no city. `removePushListByCityIndex` also returns before changing the list when neither `fcmToken` nor `registrationId` exists.

The time of day is stored as a full Date. `secs2date` builds today's local midnight plus the given seconds ([source](../../client/www/js/service.push.js#L761-L766)), so JSON holds an ISO instant on the day the Date was built: 07:00 KST on 2026-09-20 is stored as `"2026-09-19T22:00:00.000Z"`. That day is the alarm's creation or last time-picker edit ([L413-L423](../../client/www/js/controller.push.js#L413-L423)); an alert's `startTime`/`endTime` are rebuilt on every push-screen save that changed something ([L169-L176](../../client/www/js/controller.push.js#L169-L176)). `loadPushInfo` rehydrates `time`, or `startTime`/`endTime`, with `new Date()` according to `category` (synthetic execution: every record typed Date). Consequences (source-level, not reproduced):

- The POST's UTC seconds-of-day (`date2utcSecs`) use the UTC offset of that stored day, but `timezoneOffset` is the offset at submission. The two can disagree after a DST change or a device timezone change.
- An end of 24 h is stored as the next day's 00:00. PushCtrl detects it only through `endTime.getDate() > startTime.getDate()` ([source](../../client/www/js/controller.push.js#L55-L61)), which fails when the save day was the last day of a month.

`loadPushInfo` repairs each record after rehydration ([source](../../client/www/js/service.push.js#L89-L145)):

1. `cityIndex === 0`: `_getSimpleCityInfo(0)` is copied over the record, so the current-position entry always wins. Synthetic execution: a stale name, location and town were replaced.
2. `location` present with `location.lat == undefined`: `_getSimpleCityInfo(record.cityIndex)` is copied, re-deriving the record from its own index. Synthetic execution: repaired.

Only keys present in the fresh info are overwritten. A record at a non-zero index with no `location` at all is not repaired. If the city is missing, or has neither a location nor a town, the error is caught, reported through `trackException`, and the record is left unchanged. The repaired list is not saved. It is reposted after 3 s, and `_postPushList` returns without a request when `fcmToken` is empty (synthetic execution).

**Other keys**

- `twAdsInfo`: `{enable:boolean}`. It is written only by `savePurchaseInfo`: `false` for premium, `true` otherwise. `loadTwAdsInfo` runs after an AdMob plugin init succeeds. A `setEnableAds` request queued before that point wins; it can come from the paid-app flag or the entitlement that `Purchase` loaded. Otherwise an absent key or absent `enable` means enabled ([TwAds](../../client/www/js/service.twads.js#L16-L40), [Purchase](../../client/www/js/controller.purchase.js#L19-L85)). Every checked-in purchase variant normally queues such a request at startup: the paid-app flag at construction, otherwise `setAccountLevel` from `Purchase.init()` ([app.js](../../client/www/js/app.js#L340)). The alexdisler (iOS) variant reaches `setAccountLevel` only when `window.inAppPurchase` exists ([init](../../client/www/js/controller.purchase.alexdisler.js#L222-L241)). That happens before `TabCtrl` calls `TwAds.init()` ([TabCtrl](../../client/www/js/controller.tabctrl.js#L63)), so the stored value is normally only a fallback (source-level ordering, not reproduced). **Source anomaly (not reproduced):** the default and j3k0 variants call `loadPurchaseInfo` in `init()` without a paid-app check ([L95-L99](../../client/www/js/controller.purchase.j3k0.js#L95-L99)), so an `isPaidApp` build replaces `'paid'` with the stored level, or with `'free'` when none is stored or it has expired; `'free'` queues ads enabled. alexdisler returns early for `'paid'`. The checked-in configuration sets `isPaidApp:false` ([client.config.js](../../client/www/client.config.js#L22)).
- `purchaseInfo`: `{accountLevel, expirationDate}`. Every checked-in writer calls `setAccountLevel('free'|'premium')` and then saves `Purchase.accountLevel`, so the stored level is `'free'` or `'premium'`. `'paid'` is the in-memory level that `clientConfig.isPaidApp` sets at construction (see the anomaly above) and is not written by these paths. On an upgrade to premium, `expirationDate` is the receipt-validation `expires_date`, passed through unchanged; a downgrade to free re-saves the previous in-memory value, which can be `null` ([j3k0](../../client/www/js/controller.purchase.j3k0.js#L135-L148), [alexdisler](../../client/www/js/controller.purchase.alexdisler.js#L194-L202)). The server sets it from a JavaScript Date on iOS, which reaches the client as JSON (ISO 8601), and with `toUTCString()` on Android ([receipt route](../../server/routes/v000705/receiptValidation.js#L115-L155)). An expired value is treated as free at load, but the stored value is not rewritten.
- `settingsInfo` holds three strings. `units` holds the six unit members (`JSON.stringify` of the `Units` object drops its methods). `startVersion` is the number `Util.startVersion` (1). `appVersion` is a string. `disableUpdateInfo` and `expandShortChart` are booleans.

### Legacy migrations

| Migration | Condition and trigger | Exact result |
| --- | --- | --- |
| `guideVersion` → `startVersion` | `appPreferences` plugin present **and** localStorage non-empty (`_setBackwardCompatibility` inside `TwStorage.init`); `startVersion` absent; `guideVersion` present | Raw string copied; `guideVersion` removed (synthetic execution: `"1"` → `startVersion` 1) |
| Standalone `startupPage`/`refreshInterval` → `settingsInfo` | Same plugin and non-empty condition; `settingsInfo` absent | Raw strings copied without JSON parsing. A missing key defaults to `"0"` for both products (TodayAir's own default elsewhere is `"3"`). The standalone keys are removed, then `setForwardCompatibility` adds `theme:'light'` (synthetic execution: `{startupPage:"1", refreshInterval:"60", theme:"light"}`). Had the unknown legacy writer stored JSON text such as `"\"1\""`, the quotes would be kept and startup would take the unknown-page fallback (source-level, not reproduced) |
| `pushData.alarmList` → push list | Every `Push.init` while `pushData2` is absent or unparsable (`TwStorage.get` returns `undefined`, which also passes `== null`) and `pushData` exists and parses | Steps below. Synthetic execution with `pushData2` set to `{bad`: the migration ran, and the popup's save replaced the unparsable value. A `pushData` without an `alarmList` array makes `Push.init` throw `TypeError` at `alarmList.map` (synthetic execution); in `app.js` that throw would abort the `TwStorage.init().finally` callback before `Purchase.init`, `Units.loadUnits` and startup routing (source-level, not reproduced) |
| `units` value `aircn` | Every `Units.loadUnits` | Each member equal to `aircn`, and each missing member, takes the `_getDefaultUnits()` value for the `Util.region` known at that moment; units are then saved (synthetic execution, region KR: `airkorea`) |
| City restore defaults | Every `loadCities` | Missing `disable` → `false`, missing `photo` → `null`, `loadTime` → `null`. A missing `cityList` is rebuilt from the restored array (synthetic execution: the legacy placeholder appears with `address:null` and no `country`) |

The first two migrations never run without the plugin, and they are skipped in the empty-localStorage native-restore branch ([TwStorage](../../client/www/js/service.storage.js#L125-L153), [init](../../client/www/js/service.storage.js#L197-L248)).

`pushData.alarmList` migration ([loadOldPushInfo](../../client/www/js/service.push.js#L50-L84), [Push.init](../../client/www/js/service.push.js#L797-L806)):

1. `registrationId` and `type` are copied. `fcmToken` stays null.
2. Each legacy alarm yields an alert from `newPushAlert(1, cityIndex, 7, 22)` with `enable:false`. Every migrated alert therefore has id 1, a 07:00–22:00 local window on the migration day, and city info from `_getSimpleCityInfo`. If that lookup throws (for example for a current-position placeholder with neither location nor address), the error goes to `trackException` and the alert keeps only its base fields.
3. Each legacy alarm is then mutated in place: `time` → `new Date(time)`, `category:'alarm'`, `id: cityIndex+1`, `enable:true`, and `dayOfWeek` all seven `true`. Other legacy fields are kept, and no city info is added. **Source anomaly:** ids collide. For `cityIndex` 0 the alarm id 1 equals the alert id 1. A city with several legacy alarms gets one alert per alarm, all with id 1, and alarms that share id `cityIndex+1` (synthetic execution with two alarms for city 1 and one for city 0: six records, where `(1,1)`, `(1,2)` and `(0,1)` each occur twice, and the city-0 alert has no city info).
4. `pushList` is the alerts followed by the alarms. A repost is scheduled after 3 s; it does nothing without `fcmToken`.
5. `Push.init()` returns true even when the Firebase plugin is absent, and `app.js` broadcasts `showAlertInfoEvent` 500 ms later. TabCtrl then shows `LOC_WEATHER_ALERT` / `LOC_ADDED_BAD_WEATHER_ALERT_FUNCTION` ([popup](../../client/www/js/controller.tabctrl.js#L1276-L1322); [capture](screenshots/tw-overlay-alert-intro.png), triggered by a direct broadcast rather than a real migration). OK calls `enableAlertForOldAlarm(true)`, which enables every alert, posts and saves. Close calls `enableAlertForOldAlarm(false)`, which only saves. **Source anomaly (not reproduced):** the answer event `app/event/enableAlertForOldAlarm` sends `res===true?1:0`, but `res` is the string `'ok'` or `'close'`, so its value is always 0.
6. `pushData2` is written only by a later `savePushInfo`: the popup answer, `updateCityInfo` when a record changed, a push-settings save, or a push-record removal after a city delete/disable (only when a token or registration ID exists). `pushData` is never removed. Until `pushData2` exists, the migration and its popup re-run on each start, and each run creates a new alert date.

Synthetic execution with [storage-legacy.json](examples/storage-legacy.json) ([probe record](../../reports/rewrite-verification/probes/client-storage-migration.json)) reproduced steps 1–4, the `true` return of step 5 and the step 6 write, by calling `enableAlertForOldAlarm(false)` (the Close branch) directly; the `app.js` broadcast, the TabCtrl popup and the OK branch were not executed. It also showed a further failure. Take a migrated alarm without `town` whose city is a KMA city with an address: `updateCityInfo(1)` copies `name`/`source` into that alarm in memory, then throws at `pushInfo.town.first`, and nothing is posted or saved. The partial copy remains in memory, and the later Close save persisted it. In the app this path needs `window.updateCityInfo`, which `Push.init` installs only after the Firebase plugin initializes ([Push.init](../../client/www/js/service.push.js#L855-L903)); the harness called `Push.updateCityInfo` directly. The legacy writer's alarm fields beyond `cityIndex`/`time` are unknown, so this is a fixture-dependent anomaly.

## Screen derivation and UI constraints

- Hourly/daily/TodayAir weather share ForecastCtrl. The selected route/package chooses short, mid or combined weather mode. Valid address plus dayChart[0] is checked before populating even hourly state.
- Forecast screens derive chart width from row count and column width, choose heights using displayItemCount, and programmatically scroll to current/today after a 300ms timeout. Charts are D3 SVG directives embedded in app.js, with scope watchers and mutable records, not static image assets.
- AirCtrl derives selected station/pollutant, current grade/action guide, a 24-point timeline, forecast tiles and station list. An applyEvent resets station selection to zero.
- Units are display labels from global Units; they are not attached to each stored weather value by the converter. Radio changes persist, invalidate all city load times, and broadcast reload; air-unit changes also rebuild the air palette, and unit changes repost push settings.
- Theme settings switch asset paths and native status-bar style. TodayWeather supports photo/light/dark/old; TodayAir offers light/dark. One portrait/light-theme screenshot cannot establish parity for every theme, language or font size.
- Current code includes a fixed 20px iOS status-bar subtraction. The isolated simulator rendering follow-up found Dynamic Island title overlap under full-screen native hosting; safe-area native constraints resolved it in that harness. A full Cordova integration must verify its own insets/status bar. This is a hosting assumption, not a production CSS fix already applied.

Sources: [ForecastCtrl](../../client/www/js/controller.forecastctrl.js), [AirCtrl](../../client/www/js/controller.air.js), [D3 directives/routes](../../client/www/js/app.js), [radio changes](../../client/www/js/controller.setting.radio.js), [settings](../../client/www/js/controller.settingctrl.js). Screenshot evidence and its precise harness limitations are catalogued in this documentation set; synthetic data does not establish live weather correctness.

## Native and external behavior to preserve separately

| Boundary | Behavior to characterize | Why a rendered screen is insufficient |
| --- | --- | --- |
| Push | FCM token refresh, [inbound notification payload](client-data-contracts.md#inbound-notification-payload) (foreground popup versus background-tap `cityIndex`), alarm/alert sync and errors | Local settings save and server acknowledgement are separate; current token update mutates local memory despite request failure |
| Purchase | iOS alexdisler versus j3k0, receipt restore/validation, expiry, free/premium/paid, ad visibility | Gulp selects implementation and native plugin availability changes behavior |
| Widgets | App-group preferences, currentPosition and index mapping, their older weather paths | Native request code does not automatically use the Angular v000903 contract |
| Location | Denied/restricted/disabled permission, resume, approximate coordinates, watch failure | Harness uses fixture location and plugin shims |
| Sharing/deep links | Current city/page, text/image share, [app entry links](client-data-contracts.md#app-entry-links), whose number is applied as a full-list city index | Platform plugins and OS handoff required |
| Search/photo sources | Google Places, bundled Korean towns, [weather photo feed](client-data-contracts.md#weather-photo-feed) (shown only in the photo theme) | Missing remote resources can produce partial but renderable views |
| Ads/analytics | Entitlement gates, lifecycle and error logs ([analytics and error reporting](#analytics-and-error-reporting)) | Missing-plugin development fallback is not production parity |

Sources: [Push/Firebase](../../client/www/js/service.push.js), [purchase](../../client/www/js/controller.purchase.alexdisler.js), [TwAds](../../client/www/js/service.twads.js), [Branch](../../client/www/js/service.branch.js), [TabCtrl share/deep-link behavior](../../client/www/js/controller.tabctrl.js), [TodayWeather widget](../../tw.ios/widget/TodayViewController.m), [TodayAir widget](../../ta.ios/widget/TodayViewController.m).

### Analytics and error reporting

All tracking goes through `Util.ga` ([service.util.js](../../client/www/js/service.util.js#L12-L204)). It wraps `window.ga` from `cordova-plugin-google-analytics@1.8.3` ([tw.package.json](../../client/tw.package.json), [ta.package.json](../../client/ta.package.json)); Fabric Answers is used only for screen views. Each of the five `release-*` gulp tasks adds `cordova-fabric-plugin` with the build variables `FABRIC_API_KEY` and `FABRIC_API_SECRET` ([gulpfile](../../client/gulpfile.js#L101-L233)). The tracker ID is `clientConfig.gaIOSKey` or `gaAndroidKey`, and Android also passes a dispatch-period argument of 30 ([app.js](../../client/www/js/app.js#L66-L71)). It is unverified whether any GA or Fabric property still consumes these hits, so keeping the event taxonomy is an open decision, not an established requirement.

| Mechanism | Call shape and trigger | Notes |
| --- | --- | --- |
| Screen view | `$stateChangeStart` calls `trackView(toState.name)` ([app.js](../../client/www/js/app.js#L295-L326)) | Names are ui-router state names such as `tab.forecast`, `tab.air`, `start`, `setting-push`; Fabric `Answers.sendContentView(name)` is also sent when present |
| Event | `trackEvent(category, action, label?, value?)` | Free-form strings from controllers and services; labels often embed addresses, indexes or JSON |
| Exception | `trackException(description, fatal)` | Error object, stack or string; `fatal:true` from the global hooks and Google Places lazy-load failures |
| Timing | `trackTiming(category, ms, name, label)` | Weather request (`weather`, `get`/`error`, `info`) and geolocation watch (`position`, `get`, `watch`) durations |
| Global errors | Angular `$exceptionHandler` sends event `angular/error/<message>` and `trackException(stack, true)` ([app.js](../../client/www/js/app.js#L38-L57)). `window.onerror` sends event `window/error/ERROR in <file> (line #N): <msg>` plus a fatal exception, then returns false ([app.js](../../client/www/js/app.js#L199-L211)). `enableUncaughtExceptionReporting(true)` enables plugin-level reporting | With `clientConfig.debug` set, both hooks also call `alert()` |

**Queue and replay.** When `window.ga` is undefined or the plugin reports an error, `trackView`, `trackEvent` and `trackException` push the call onto the in-memory `gaArray`; `trackTiming` is never queued. The only replay is `platformReady()`. It runs once, synchronously in the run block ([app.js](../../client/www/js/app.js#L124)), which executes after `angular.bootstrap` on `deviceready` ([index.html](../../client/www/index.html#L68-L69)). When `window.ga` exists it replays queued views (name only) and events and drops queued exceptions. It then clears the queue in every case, so without the plugin everything queued before that point is discarded. Anything queued later is never replayed in that session, and without the plugin the queue keeps growing.

**Privacy-relevant fields** (observed source):

- `trackEvent('app','uuid', device.uuid)` sends the device UUID as an event label ([app.js](../../client/www/js/app.js#L173-L176)). The same UUID is sent as the `Device-Id` header on push requests and on the alexdisler (iOS) receipt-validation request, and as `uuid` in push bodies ([push body](../../client/www/js/service.push.js#L170-L185), [push headers](../../client/www/js/service.push.js#L242-L248), [purchase](../../client/www/js/controller.purchase.alexdisler.js#L45-L52)).
- `setAllowIDFACollection(true)` is enabled at startup ([app.js](../../client/www/js/app.js#L126-L127)). Language, user agent and screen or window size events follow ([app.js](../../client/www/js/app.js#L171-L190)).
- `savePushInfo` calls `trackEvent('push','post', JSON.stringify({savePushInfo: pushData}))` ([service.push.js](../../client/www/js/service.push.js#L147-L151)). The whole `pushData2` object becomes an event label, including `fcmToken`/`registrationId` when present and every record's location and town. The storage synthetic execution, run with null tokens, showed this label structure.
- City add/delete events use the full or shortened address, or the Places search description, as the label ([SearchCtrl add](../../client/www/js/controller.searchctrl.js#L317-L321), [search description](../../client/www/js/controller.searchctrl.js#L473), [delete](../../client/www/js/controller.searchctrl.js#L607), [StartCtrl](../../client/www/js/controller.start.js#L595-L605)).
- The user-initiated feedback `mailto:` body contains the app version, device UUID and user agent ([service.util.js](../../client/www/js/service.util.js#L251-L266)).

A rewrite should choose which events to keep as an explicit decision. It should not forward tokens, device identifiers or precise locations to analytics without a privacy review.

## Preserve intent, explicitly reconsider quirks

| Preserve through tests | Reconsider through an explicit decision |
| --- | --- |
| Favorites/current location, product-specific startup, unit/AQI choices, yesterday comparison, localized dates, forecast attribution, widget/push mapping | Index-based identity and completion-time response destination; push ids unique only per city; push records not re-indexed after a delete |
| Cached content during refresh with clear outcome | Truthy partial updates retaining old air fields without freshness labels |
| Provider/time/unit differences and optional data | Dropping response units and reusing ambiguous precipitation field names |
| User-owned settings and older saved location migration | Silent malformed-storage failure; missing pushData2 native restore; legacy push migration that re-runs until `pushData2` is saved; push times stored as full-date instants |
| Responsive charts, current/today scroll position, compact screen readability | Fixed eight-sample/index-7/8 assumptions, fixed status-bar sizes, timed DOM scrolling |
| Expected retry/error affordances | Concurrent retry timers, no cancellation, geolocation watch left active on rejection |
| Existing consumers' API compatibility | Falsy latitude 0, unencoded paths, repeated airInfoList branch, national map locale quirks |
| Screen-view/event analytics that an owner confirms is still consumed | Device UUID, push tokens, push locations and addresses in analytics labels; replay limited to startup |

These source anomalies are documented to prevent accidental dependence during a rewrite. This documentation change does not alter them. Convert each into a characterization test and an accepted compatibility/fix decision before implementation.

## Verification and remaining uncertainty

This reference was checked against source; its JSON normalization examples were executed with the current converter in an isolated VM. The storage fixtures and their recorded variants were also loaded through the current storage, city, push and units services in an isolated VM with plugin stubs, a fixed clock and network disabled: first on 2026-09-24, then on 2026-09-25 through the checked-in [storage probe](../../reports/rewrite-verification/probes/client-storage-migration.json), with 24/24 checks matching ([persisted record shapes](#persisted-record-shapes)). Neither run covers `Purchase`/`TwAds` nor a real WebView, native preference plugin or Firebase plugin. No live geocoding/weather/push/purchase request, mobile release build, plugin integration, storage-loss simulation or concurrency failure reproduction was performed for these documents. Exact deployed configuration, provider freshness, real legacy-user storage populations and behavior of shipped native/plugin versions remain independent verification work.
