# Client state and behavior reference

## Scope and evidence

Source baseline: `ff7acf3996ccb66c912d2ed4710cf300197d6966`, inspected 2026-09-23. This documents current behavior and the boundaries a rewrite needs to test. It does not claim that every behavior is desirable, every plugin works on current iOS, or the stored format has a formal schema. [Client data contracts](client-data-contracts.md) covers wire and normalized fields; [rewrite playbook](rewrite-playbook.md) covers migration choices.

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
3. Theme paths come from `window.theme[settingsInfo.theme]`. `WeatherInfo.loadCities()` restores full cities and selection, creates a disabled current-location placeholder for a new install, and starts optional photo loading.
4. Startup invokes `Push.init()`, `Purchase.init()`, then `Units.loadUnits()`. Push loading may schedule a list repost after three seconds; native setup can have side effects beyond showing the first screen.
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

Favorites are deduplicated by address, and by name when either item has one; current-position entries match each other by their flag. Coordinates alone are not the identity. The selected city is a mutable integer persisted as `cityIndex`; swipe navigation skips the disabled first entry and wraps. Removing a city splices the list. Push and widget integrations carry list indexes, so reorder/delete is an external contract concern, not merely UI state.

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
| HTTP timers | At most three attempts start around 0, 2, 4 seconds if earlier attempts remain unresolved; default timeout 10 seconds each | Slow requests overlap; this is not retry-after-failure |
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

Native suite name is `group.net.wizardfactory.<lowercase package>`, for example todayweather/todayair. Android has an older suite `net.wizardfactory.todayweather_preferences`. Preserve app-group relationships when widgets are in scope.

| Key | Current value/use | Migration attention |
| --- | --- | --- |
| `cities` | Full mutable city array, including weather/air/charts, flags and photo | Cached domain data and view models are mixed; loadTime JSON date string is reset to null on restore |
| `cityIndex` | integer selected list index | Migrate selection to stable location ID while translating native/push indexes |
| `cityList` | `{cityList:[{name?,currentPosition,address,location,country,index}]}` for enabled cities | Widget projection; omits weather and disabled locations, retains original full-list index |
| `settingsInfo` | `{startupPage:string,refreshInterval:string,theme:string}` | Product defaults; theme options vary by package |
| `units` | six unit settings on the Units object | Legacy `aircn` replacement; missing members filled from locale defaults |
| `pushData2` | registrationId/fcmToken/type/pushList; serialized alarm/alert Date fields | Rehydrate Dates on load; migrated from older `pushData.alarmList` |
| `pushData` | legacy push configuration | Still appears in native restore-key lists |
| `purchaseInfo` | accountLevel and expirationDate | Separate free/premium/paid logic; expiration must remain parseable |
| `storeReceipt` | plugin receipt envelope | Sensitive; not plain UI cache; preserve only through a reviewed migration |
| `twAdsInfo` | advertisement-related settings/state | Entitlement and explicit ad settings interact |
| `startVersion`, `appVersion`, `disableUpdateInfo` | onboarding/update-dialog state | `guideVersion` migrates to startVersion; app release is distinct from onboarding version |
| `expandShortChart` | boolean expanded hourly detail | UI preference |
| `daumServiceKeys` | configured provider key list | Sensitive configuration, not a user-owned preference to export blindly |

Native restoration is selective:

1. If localStorage is completely empty, fetch a fixed allowlist from the current native suite and copy values into localStorage; failures still allow initialization to finish.
2. Otherwise run backward compatibility, load absent units/cityList/daumServiceKeys from the old/current suite (also purchaseInfo on Android), then mirror a limited localStorage list to native.
3. `setForwardCompatibility` supplies theme light if missing and publishes settingsInfo.

**Observed gap:** the fixed empty-localStorage restore list includes `pushData` but not the current `pushData2` key, even though ordinary TwStorage.set writes pushData2 to native. Recovery after WebView storage loss may therefore lose current push settings from the app view. This is a source-based migration risk, not a demonstrated production incident.

No persistence version envelope, transaction across local/native stores or comprehensive malformed-data recovery exists here. Make backup/restore fixtures for older address-only cities, malformed JSON, missing units, WebView wipe with native preferences retained, and delayed native write failures. Sources: [TwStorage](../../client/www/js/service.storage.js), [WeatherInfo native projection](../../client/www/js/service.weatherinfo.js), [Push load/save](../../client/www/js/service.push.js), [Units](../../client/www/js/controller.units.js).

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
| Push | FCM token refresh, foreground notification event, background tap cityIndex, alarm/alert sync and errors | Local settings save and server acknowledgement are separate; current token update mutates local memory despite request failure |
| Purchase | iOS alexdisler versus j3k0, receipt restore/validation, expiry, free/premium/paid, ad visibility | Gulp selects implementation and native plugin availability changes behavior |
| Widgets | App-group preferences, currentPosition and index mapping, their older weather paths | Native request code does not automatically use the Angular v000903 contract |
| Location | Denied/restricted/disabled permission, resume, approximate coordinates, watch failure | Harness uses fixture location and plugin shims |
| Sharing/deep links | Current city/page, text/image share, incoming favorite index | Platform plugins and OS handoff required |
| Search/photo sources | Google Places, bundled Korean towns, optional weather photos | Missing remote resources can produce partial but renderable views |
| Ads/analytics | Entitlement gates, lifecycle and error logs | Missing-plugin development fallback is not production parity |

Sources: [Push/Firebase](../../client/www/js/service.push.js), [purchase](../../client/www/js/controller.purchase.alexdisler.js), [TwAds](../../client/www/js/service.twads.js), [Branch](../../client/www/js/service.branch.js), [TabCtrl share/deep-link behavior](../../client/www/js/controller.tabctrl.js), [TodayWeather widget](../../tw.ios/widget/TodayViewController.m), [TodayAir widget](../../ta.ios/widget/TodayViewController.m).

## Preserve intent, explicitly reconsider quirks

| Preserve through tests | Reconsider through an explicit decision |
| --- | --- |
| Favorites/current location, product-specific startup, unit/AQI choices, yesterday comparison, localized dates, forecast attribution, widget/push mapping | Index-based identity and completion-time response destination |
| Cached content during refresh with clear outcome | Truthy partial updates retaining old air fields without freshness labels |
| Provider/time/unit differences and optional data | Dropping response units and reusing ambiguous precipitation field names |
| User-owned settings and older saved location migration | Silent malformed-storage failure; missing pushData2 native restore |
| Responsive charts, current/today scroll position, compact screen readability | Fixed eight-sample/index-7/8 assumptions, fixed status-bar sizes, timed DOM scrolling |
| Expected retry/error affordances | Concurrent retry timers, no cancellation, geolocation watch left active on rejection |
| Existing consumers' API compatibility | Falsy latitude 0, unencoded paths, repeated airInfoList branch, national map locale quirks |

These source anomalies are documented to prevent accidental dependence during a rewrite. This documentation change does not alter them. Convert each into a characterization test and an accepted compatibility/fix decision before implementation.

## Verification and remaining uncertainty

This reference was checked against source; its JSON normalization examples were executed with the current converter in an isolated VM. No live geocoding/weather/push/purchase request, mobile release build, plugin integration, storage-loss simulation or concurrency failure reproduction was performed for these documents. Exact deployed configuration, provider freshness, real legacy-user storage populations and behavior of shipped native/plugin versions remain independent verification work.
