# Overlays, dialogs and native hand-offs

Baseline: `bd6640f2` (re-baselined 2026-09-25; client source identical to `ff7acf3996ccb66c912d2ed4710cf300197d6966`, on which this was inspected 2026-09-24; captures keep their original dates and commit). This catalog complements the routed screens S01–S16 in [screen specifications](screen-specifications.md). It covers the modal popups, loading indicators and native surfaces that sit on top of those screens. They decide navigation, persistence and permissions. The IDs O01–O19 are documentation identifiers; the [screenshot manifest](screenshots/manifest.json) and [capture recipes](../../reports/rewrite-verification/capture/README.md) use the same IDs.

Evidence labels follow the [package README](README.md). Every statement below is **observed source** unless it is marked otherwise. **Synthetic execution** means a 2026-09-24 capture or probe in the isolated WKWebView harness: iPhone 17 Pro / iOS 26.5, TodayWeather, ko-KR, no Cordova plugins, synthetic data. Where a statement links a Node probe under [reports/rewrite-verification/probes](../../reports/rewrite-verification/probes/), it instead means that probe's VM run of checked-in client code with stubbed dependencies. Items marked "source-level, not reproduced" are anomalies read from code only. They are candidates for characterization tests, not confirmed production bugs.

## Shared popup mechanics

- Every web dialog is an Ionic 1 `$ionicPopup`. [`client/bower.json`](../../client/bower.json) pins `ionic-bower#1.3.5`, and the bundled copy under [`tw.ios/www/lib/ionic`](../../tw.ios/www/lib/ionic/js/ionic.bundle.js) is v1.3.5. `client/www/lib` is not in this checkout.
- A button's `onTap` return value resolves the popup promise. A button without `onTap` resolves `undefined`. `$ionicPopup.alert` without `okText` or `buttons` shows the Ionic default English `OK` ([bundle L56918-L56928](../../tw.ios/www/lib/ionic/js/ionic.bundle.js#L56918-L56928)).
- On Android, hardware back while a popup is open resolves the top popup with `undefined`, without running any `onTap`. Popups use back priority 400 and loading uses 500, which disables back while the overlay is shown ([L56842-L56862](../../tw.ios/www/lib/ionic/js/ionic.bundle.js#L56842-L56862), [L55517-L55521](../../tw.ios/www/lib/ionic/js/ionic.bundle.js#L55517-L55521), [priority map L56078-L56085](../../tw.ios/www/lib/ionic/js/ionic.bundle.js#L56078-L56085)). The highest priority wins; on a tie the last registered action wins ([L56178-L56191](../../tw.ios/www/lib/ionic/js/ionic.bundle.js#L56178-L56191)). This is source-level and not reproduced. Where it matters, the dialog sections below give the `undefined` branch.
- Titles, bodies and button labels are resolved through `$translate([...])` before the popup opens. `app.js` registers en/de/ko/ja/zh-CN/zh-TW with `en` as the fallback language ([app.js L422-L439](../../client/www/js/app.js#L422-L439)). In the bundled angular-translate 2.16.0, an array call always resolves; an id that is missing in both the current and the fallback language resolves to the id itself ([angular-translate.js L1473-L1500](../../tw.ios/www/lib/angular-translate/angular-translate.js#L1473-L1500), [L1979-L2004](../../tw.ios/www/lib/angular-translate/angular-translate.js#L1979-L2004)). The controllers' rejection branches and their `translate/error/...` events therefore do not run with that version (source-level). `client/bower.json` allows `^2.13.0`, and `client/www/lib` is absent, so the shipped version is unverified. The English literals that controllers pre-assign are visible only when a controller-level string is read before its translation resolves. Two titles are always English: the push `"Permission"` and `"Save"` titles.
- Analytics calls are written as `category/action/label[/value]` for `Util.ga.trackEvent`.
- `$rootScope.title` is `LOC_TODAYWEATHER` or `LOC_TODAYAIR` ([app.js L65](../../client/www/js/app.js#L65)).

## Catalog

| ID | Overlay | Host / trigger | Capture |
| --- | --- | --- | --- |
| O01 | Start access explanation | S01, every `StartCtrl` entry | [tw-overlay-access-explanation.png](screenshots/tw-overlay-access-explanation.png) |
| O02 | Zero-city start choice | S03/S04/S15 init or tab tap with no enabled city; share with no selected city or one without `location` | [tw-overlay-start-popup.png](screenshots/tw-overlay-start-popup.png) |
| O03 | TabCtrl retry confirm | Tab screens and S02: weather or position failure | [tw-overlay-retry-weather.png](screenshots/tw-overlay-retry-weather.png) (weather variant only) |
| O04 | StartCtrl retry confirm | S01 current-location failure | Not captured |
| O05 | Update information | Startup past the `startVersion` gate | [tw-overlay-update-info.png](screenshots/tw-overlay-update-info.png) |
| O06 | Weather-alert introduction | Startup after legacy alarm migration | [tw-overlay-alert-intro.png](screenshots/tw-overlay-alert-intro.png) |
| O07 | Foreground notification | Push received while foregrounded | [tw-overlay-foreground-notification.png](screenshots/tw-overlay-foreground-notification.png) |
| O08 | Air-forecast source information | S03, S05/S16 source row | [tw-overlay-air-source-info.png](screenshots/tw-overlay-air-source-info.png) |
| O09 | Shared `showAlert` / `showConfirm` | S01/S02 add-city errors, S06 About | [tw-overlay-start-error-alert.png](screenshots/tw-overlay-start-error-alert.png) |
| O10 | About attribution | S06, Korean language only | [tw-overlay-about.png](screenshots/tw-overlay-about.png) |
| O11 | Push permission popup | S09 init or Save with notifications off | Not captured |
| O12 | Push save-changes confirm | S09 Back/Cancel with pending changes | [tw-overlay-push-save-confirm.png](screenshots/tw-overlay-push-save-confirm.png) |
| O13 | Push equal-time alert | S09 Save with start = end | Not captured |
| O14 | Push time picker | S09 alarm row or add row | Not captured |
| O15 | Android hardware-back exit confirm | Five tab routes, Android only | Not captured |
| O16 | Share sheet and message text | Header share action | Not capturable without plugin |
| O17 | Loading overlay and header spinner | Start/Search/Nation flows; tab refresh | [overlay](screenshots/tw-loading-overlay-search.png), [spinner light](screenshots/tw-loading-header-spinner-light.png), [spinner dark](screenshots/tw-loading-header-spinner-dark.png) |
| O18 | Purchase progress and error alerts | S13, iOS builds | Not captured (only S13 [plugin-unavailable](screenshots/tw-purchase-unavailable.png)) |
| O19 | Native surfaces and hand-offs | AdMob, OS prompts, settings, mail, store, browser | Not capturable in the harness |

## O01 — Start access explanation

- **Trigger/host:** `StartCtrl.init()` runs this dialog unconditionally ([controller.start.js L201-L241](../../client/www/js/controller.start.js#L201-L241), called at [L823](../../client/www/js/controller.start.js#L823)). It therefore appears on every S01 entry on every platform, iOS included. S01 is entered only through the `startVersion` gate: no stored `startVersion`, or `Util.startVersion` (`1.0`, [service.util.js L209](../../client/www/js/service.util.js#L209)) greater than the stored value ([app.js L352-L356](../../client/www/js/app.js#L352-L356)). `close()` stores it after a city is added ([start.js L129-L132](../../client/www/js/controller.start.js#L129-L132)).
- **Text:**
  - Title: `LOC_NEEDS_ACCESS_TO`.
  - Body: `LOC_STORAGE_SPACE` `<br>` `LOC_LOCATION_ACCESS` `<br>` `LOC_CALL_INFORMATION`.
  - The controller pre-assigns English literals, but the popup opens only after the translation call settles.
- **Buttons:** `LOC_OK` only, with no `onTap`. The result is only logged.
- **Effects:** No navigation, persistence or analytics. The dialog does not request any OS permission; it only describes them. The same `init()` hides the ad banner (`_setShowAds(false)`, [L202](../../client/www/js/controller.start.js#L202)).
- **Capture:** [tw-overlay-access-explanation.png](screenshots/tw-overlay-access-explanation.png), captured before dismissal.

## O02 — Zero-city start choice (`TabCtrl.startPopup`)

- **Trigger/host:** [controller.tabctrl.js L316-L378](../../client/www/js/controller.tabctrl.js#L316-L378). It opens when `WeatherInfo.getEnabledCityCount() === 0` in these cases:
  - `ForecastCtrl` init on S03/S04/S15 ([forecastctrl.js L167-L171](../../client/www/js/controller.forecastctrl.js#L167-L171)).
  - `doTabForecast` on the hourly, daily, air or weather tab ([L74-L77](../../client/www/js/controller.tabctrl.js#L74-L77)). The favorites tab uses `href` and does not call it.
  - `doTabShare` when the selected city is missing or has no `location` ([L223-L228](../../client/www/js/controller.tabctrl.js#L223-L228)).
  - `AirCtrl` (S05/S16) returns without a prompt when zero cities are enabled ([air.js L362-L365](../../client/www/js/controller.air.js#L362-L365)).
- **Text:**
  - The title is the translated product name (`$rootScope.title`), but it is never visible because `.ionic_popup .popup-head {display: none}` hides it ([ionic.app.scss L1344-L1346](../../client/scss/ionic.app.scss#L1344-L1346)).
  - The body contains two `ion-radio` controls on `data.autoSearch`, in this order ([L333-L336](../../client/www/js/controller.tabctrl.js#L333-L336)):
    1. `LOC_USE_YOUR_CURRENT_LOCATION`, `ng-value="false"`
    2. `LOC_FIND_LOCATION_BY_NAME`, `ng-value="true"`
  - A missing key would render as the key itself (see Shared popup mechanics).
- **Preselection:** `data.autoSearch` starts as `false` ([L12](../../client/www/js/controller.tabctrl.js#L12)). When the diagnostic plugin exists, `TabCtrl.init()` overwrites it asynchronously with `isLocationEnabled()` ([L14-L22](../../client/www/js/controller.tabctrl.js#L14-L22)). The popup scope is a child of the `TabCtrl` scope, so a radio choice is written to the shared `data` object and persists into the next opening in the same session (source-level).
- **Buttons:** A single `LOC_OK` (`button-positive`) returns `data.autoSearch`. There is no cancel button.
- **Analytics on open:** `show/popup/startPopup`.

| Resolved value | Radio label bound to it | Action | Analytics |
| --- | --- | --- | --- |
| `true` | `LOC_FIND_LOCATION_BY_NAME` | Calls `WeatherInfo.disableCity(false)`, which enables and persists the current-position slot (index 0) and selects it when no city was selected ([service.weatherinfo.js L99-L112](../../client/www/js/service.weatherinfo.js#L99-L112), [L181-L190](../../client/www/js/service.weatherinfo.js#L181-L190)). Routes to `/tab/forecast` (TodayWeather) or `/tab/air` (TodayAir). If already on that route, broadcasts `reloadEvent` `'startPopup'` instead | `action/click/auto search` |
| `false` or `undefined` (Android back) | `LOC_USE_YOUR_CURRENT_LOCATION` | Routes to `/tab/search`. If already there, broadcasts `setInputFocus`, which does nothing on iOS ([searchctrl.js L945-L957](../../client/www/js/controller.searchctrl.js#L945-L957)) | `action/click/city search` |

**Anomaly: label/action inversion.** Whichever radio is preselected, OK runs the action named by the *other* label:
- With the default `false`, "Use your current location" is checked, but OK opens search.
- With location services on (`true`), "Search for a new location" is checked, but OK enables current position.

The harness reproduced this (synthetic execution, [start-popup-choice.json](../../reports/rewrite-verification/probes/start-popup-choice.json)):
- Value `true` stayed on `tab.forecast` and enabled the current-position slot.
- Value `false` moved to `tab.search`.
- Both runs showed the labels "현재위치 날씨보기" and "지역 검색으로 시작" in that order.

Evidence of intent:
- Commit `61be2230` (2018-01-08, issue #2018) swapped the two `ng-value`s; in `startPopup` it otherwise only added the comment below and the `show/popup/startPopup` event. Its parent revision already defaulted `autoSearch` to `false`, overwrote it with `isLocationEnabled()`, and had the same result handler. Before the commit, each label named its own action (git history, observed source).
- The comment the commit added at [L312-L315](../../client/www/js/controller.tabctrl.js#L312-L315) says: the popup should run only with zero enabled cities, #2018 suggests it can run anyway, so the default was changed to "go to favorites" to avoid adding the current location by a mistaken tap.
- `GuideCtrl` keeps the unswapped mapping: `true` ↔ `LOC_USE_YOUR_CURRENT_LOCATION`, default `true`, plus a Cancel button that resolves `undefined` and only logs `action/click/cancel` ([guidectrl.js L5](../../client/www/js/controller.guidectrl.js#L5), [L88-L128](../../client/www/js/controller.guidectrl.js#L88-L128)). Its `showPopup()` has no caller at this revision.

The commit changed which label appears checked, not what OK does for the preselected value. With location services off or no plugin, an untouched OK still opens search, as before. With location services on, an untouched OK still enables the current position, now under a checked "Search" label. The #2018 comment's goal ("favorites by default") therefore holds only when location services are off or the plugin is missing.

## O03 — TabCtrl retry confirm (`showRetryConfirm(title, template, type)`)

Source: [controller.tabctrl.js L399-L600](../../client/www/js/controller.tabctrl.js#L399-L600). `SearchCtrl` calls the same function through scope inheritance. Every caller passes TabCtrl's or SearchCtrl's `strError` as the title: `LOC_ERROR`, or the literal `"Error"` until that controller's startup translation resolves.

| `type` | Caller | Body text |
| --- | --- | --- |
| `weather` | `loadWeatherData` when `updateWeatherData` rejects on an HTTP failure or unconvertible response ([L950](../../client/www/js/controller.tabctrl.js#L950), [L1179-L1216](../../client/www/js/controller.tabctrl.js#L1179-L1216)) | `LOC_FAIL_TO_GET_WEATHER_INFO` |
| `forecast` | `loadWeatherData` when the current-position update rejects with a message ([L1001-L1009](../../client/www/js/controller.tabctrl.js#L1001-L1009)) | One of four messages: `LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION` (on Android, `<br>` plus `LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI` is appended); `LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED`; `LOC_PERMISSION_REQUEST_DENIED_PLEASE_SEARCH_BY_LOCATION_NAME_OR_RETRY` (Android request denied); `LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION` (location off and no stored position). See [L1085-L1177](../../client/www/js/controller.tabctrl.js#L1085-L1177) |
| `search` | S02 find-by-location (`OnSearchCurrentPosition`) and the current-position row refresh (`updateCurrentPositionWeather`) ([searchctrl.js L257-L265](../../client/www/js/controller.searchctrl.js#L257-L265), [L567-L576](../../client/www/js/controller.searchctrl.js#L567-L576)) | `LOC_FAIL_TO_GET_LOCATION_INFORMATION` (reverse geocode failed); `LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION` (on Android plus `<br>` `LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI`); `LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED`, also used for an Android request denial. See [L684-L826](../../client/www/js/controller.searchctrl.js#L684-L826) |

Rejections without a message open no popup:
- `TabCtrl` ignores `null` and `undefined` (`if (msg)`). `undefined` comes from `WeatherUtil.getCurrentPosition()` rejecting with `'alreadyCalled'` ([L1097-L1100](../../client/www/js/controller.tabctrl.js#L1097-L1100)).
- `SearchCtrl` immediately re-broadcasts the event that started the lookup (`searchCurrentPositionEvent` or `updateCurrentPositionWeatherEvent`), a silent retry.

**Variant selection.** Branches are evaluated in order. Selection depends on two inputs, not on the message:
- `gLocationAuthorizationStatus`: the last status recorded through TabCtrl's `setLocationAuthorizationStatus`. It starts `undefined`. TabCtrl records it only on Android ([L1061](../../client/www/js/controller.tabctrl.js#L1061), [L1121](../../client/www/js/controller.tabctrl.js#L1121)). SearchCtrl has no setter of its own and writes the same variable through scope inheritance: on Android at [searchctrl.js L659](../../client/www/js/controller.searchctrl.js#L659), [L722](../../client/www/js/controller.searchctrl.js#L722) and [L796](../../client/www/js/controller.searchctrl.js#L796), and on every platform for the location-off `DENIED` case ([L780-L785](../../client/www/js/controller.searchctrl.js#L780-L785)). On iOS that last case is the only writer.
- `Util.isLocationEnabled()`: on iOS this means permission granted; on Android it means a location mode is on. It returns `true` when the plugin is missing ([service.util.js L223-L243](../../client/www/js/service.util.js#L223-L243)).

Buttons are listed in display order with their return values. A `search` type always prepends `LOC_CLOSE`→`close` ([L421-L428](../../client/www/js/controller.tabctrl.js#L421-L428)).

| # | Variant (condition) | `weather` | `forecast` | `search` | Analytics on open |
| --- | --- | --- | --- | --- | --- |
| 1 | `type == 'weather'` | `LOC_CLOSE`→`close`, `LOC_OK`→`retry` | — | — | `window/show/getWeatherPopup` |
| 2 | Android and status `DENIED_ALWAYS`; body gets `<br>` + `LOC_OPENS_THE_APP_INFO_PAGE` | — | `LOC_SEARCH`→`search`, `LOC_SETTING`→`settings` | `LOC_CLOSE`, `LOC_SETTING`→`settings` | `window/show/deniedAlwaysPopup` |
| 3 | Status `DENIED` | — | `LOC_SEARCH`→`search`, `LOC_OK`→`retry` | `LOC_CLOSE`, `LOC_OK`→`retry` | `window/show/deniedPopup` |
| 4 | `Util.isLocationEnabled() == false` | — | `LOC_SEARCH`→`search`, `LOC_SETTING`→`locationSettings` (Android) or `settings` (iOS), `LOC_OK`→`retry` | `LOC_CLOSE`, `LOC_SETTING` (as in `forecast`), `LOC_OK`→`retry` | `window/show/locationDisabledPopup` |
| 5 | Otherwise (position or address failure) | — | `LOC_CLOSE`→`close`, `LOC_OK`→`retry` | `LOC_CLOSE`, `LOC_OK`→`retry` | `window/show/getAddressPopup` |

Every open also sends `show/popup/retryConfirm`.

| Result | Action ([L558-L598](../../client/www/js/controller.tabctrl.js#L558-L598)) |
| --- | --- |
| `retry` | Sends `action/click/reloadEvent`. On the next tick: `search` broadcasts `searchCurrentPositionEvent`; other types broadcast `reloadEvent` `'retryPopup'`, which runs `reloadCity` and `loadWeatherData` |
| `search` | Sends `action/click/moveSearch`. Calls `WeatherInfo.disableCity(true)`, which disables and persists the current-position slot and, if that slot was selected, selects index 1 (or `-1` when no saved city exists) ([service.weatherinfo.js L99-L112](../../client/www/js/service.weatherinfo.js#L99-L112), [L181-L190](../../client/www/js/service.weatherinfo.js#L181-L190)). Routes to `/tab/search` |
| `settings` | Sends `action/click/settings`. Calls `cordova.plugins.diagnostic.switchToSettings()` (app settings) |
| `locationSettings` | Calls `switchToLocationSettings()`. No analytics |
| `close` or `undefined` | Sends `action/click/close` |

Notes:
- The retry button label is `LOC_OK` (`strOkay`, [L1427](../../client/www/js/controller.tabctrl.js#L1427)). `LOC_RETRY` is translated into `strRetry` ([L1422](../../client/www/js/controller.tabctrl.js#L1422)) but never displayed.
- The Android `DENIED_ALWAYS` variant has no retry button.
- `LOC_OPENS_THE_APP_INFO_PAGE` names TodayWeather in every locale (for example "[Settings]>[App]>[TodayWeather]"), including in TodayAir.
- Only one TabCtrl confirm is shown at a time: an open one is closed first ([L401-L403](../../client/www/js/controller.tabctrl.js#L401-L403)); the closed one resolves `undefined` and logs `action/click/close`. For the current-position city, `loadWeatherData` runs the weather request and the position update in parallel, so a `weather` confirm can be replaced by a `forecast` confirm or the reverse ([L940-L1009](../../client/www/js/controller.tabctrl.js#L940-L1009)). When the position has moved, the follow-up weather request for the new coordinates only logs a failure; no confirm opens ([L992-L996](../../client/www/js/controller.tabctrl.js#L992-L996)). While a confirm is open, every `reloadEvent` is skipped with `reload/skip/popup` ([L773-L776](../../client/www/js/controller.tabctrl.js#L773-L776)).
- The Close, Search, Settings and app-info strings are translated per call ([L410-L419](../../client/www/js/controller.tabctrl.js#L410-L419)); `strOkay` comes from TabCtrl's startup translation; the messages come from the calling controller's startup translation or from `$translate.instant`. The `translate/error/showRetryConfirm` branch does not run with the bundled angular-translate.
- **Anomaly: `search` retry target** (source-level). Retry always broadcasts `searchCurrentPositionEvent`, which runs `OnSearchCurrentPosition` ([searchctrl.js L231-L234](../../client/www/js/controller.searchctrl.js#L231-L234)). When the failed flow was the current-position row refresh, Retry therefore starts a find-by-location search instead of repeating the row refresh.
- **Unguarded plugin access** (source-level): non-`weather` types read `cordova.plugins.diagnostic.permissionStatus` without a guard. [L450](../../client/www/js/controller.tabctrl.js#L449-L450) does this on Android; [L472](../../client/www/js/controller.tabctrl.js#L472) does it on every platform. Without the plugin, the `finally` callback throws before `$ionicPopup.show`, so no popup appears. For this reason the harness rendered only the `weather` variant.
- **Capture:** [tw-overlay-retry-weather.png](screenshots/tw-overlay-retry-weather.png) shows `showRetryConfirm(LOC_ERROR, LOC_FAIL_TO_GET_WEATHER_INFO, 'weather')`.

## O04 — StartCtrl retry confirm

Source: [controller.start.js L690-L821](../../client/www/js/controller.start.js#L690-L821). The only caller is `_onUseLocationService()`, with `ctrl = 'useLocationService'`, after the S01 current-location action fails with a message ([L632-L662](../../client/www/js/controller.start.js#L632-L662)). A `null` rejection re-broadcasts `useLocationService` immediately without a popup.

The title is `LOC_ERROR`. The body is one of:
- `LOC_FAIL_TO_GET_LOCATION_INFORMATION`: reverse geocode failed ([L453](../../client/www/js/controller.start.js#L453)).
- `LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION`: on Android, `<br>` plus `LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI` is appended ([L456-L462](../../client/www/js/controller.start.js#L456-L462)).
- `LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED`: Android `DENIED_ALWAYS`, an Android permission-request denial, or location off with status `DENIED` ([L465-L468](../../client/www/js/controller.start.js#L465-L468), [L477-L480](../../client/www/js/controller.start.js#L477-L480), [L534-L539](../../client/www/js/controller.start.js#L534-L539)). TabCtrl uses `LOC_PERMISSION_REQUEST_DENIED_PLEASE_SEARCH_BY_LOCATION_NAME_OR_RETRY` for the request denial instead.

The `LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION` branch ([L501-L522](../../client/www/js/controller.start.js#L501-L522)) needs `enabled=false, authorized=true`, which `updateCurrentPosition()` never passes, so it is unreachable here (source-level).

`gLocationAuthorizationStatus` is StartCtrl's own variable ([L673-L676](../../client/www/js/controller.start.js#L673-L676)). Unlike TabCtrl, StartCtrl also records it on iOS when location is enabled ([L400-L402](../../client/www/js/controller.start.js#L400-L402)).

Every variant starts with `LOC_CLOSE`→`close` and ends with `LOC_OK`→`retry` ([L711-L774](../../client/www/js/controller.start.js#L711-L774)).

| Variant (evaluated in order) | Buttons | Body addition | Analytics on open |
| --- | --- | --- | --- |
| Status `DENIED_ALWAYS` (not platform-gated) | Close, `LOC_SETTING`→`settings`, OK | `<br>` + `LOC_OPENS_THE_APP_INFO_PAGE` | `window/show/deniedAlwaysPopup` |
| Status `DENIED` | Close, `LOC_SETTING`→`settings`, OK | — | `window/show/deniedPopup` |
| `Util.isLocationEnabled() == false` | Close, `LOC_SETTING`→`locationSettings` (Android) or `settings` (iOS), OK | — | `window/show/locationDisabledPopup` |
| Otherwise | Close, OK | — | `window/show/retryPopup` |

Results:
- `retry` sends `action/click/reloadEvent`, then broadcasts `useLocationService` on the next tick. This re-runs `_onUseLocationService()`. The `ctrl == 'search'` branch has no caller here.
- `settings` and `locationSettings` behave as in O03.
- Anything else sends `action/click/close`.

Differences from O03:
- No Search button.
- `DENIED` offers Settings.
- `DENIED_ALWAYS` offers retry and is not Android-gated.
- No `show/popup/retryConfirm` event.
- The default variant is logged as `retryPopup`.

The (unreachable, see Shared popup mechanics) translation-failure event is spelled `translate/error/ShowRetryConfirm` with a capital S ([L706-L709](../../client/www/js/controller.start.js#L706-L709)). StartCtrl's `strError`, `strOkay` and messages are translated once at controller creation ([L9-L42](../../client/www/js/controller.start.js#L9-L42)); a failure that happens before that call resolves shows the pre-assigned English literals.

[L718](../../client/www/js/controller.start.js#L718) reads `cordova.plugins.diagnostic.permissionStatus` without a guard on every call. Without the plugin (browser or harness), `updateCurrentPosition()` takes the browser path; a position failure then hides the overlay and throws before the popup opens, so the failure is silent (source-level). **Capture:** not captured, because rendering needs the diagnostic plugin or a shim.

## O05 — Update information

**Scheduling** ([app.js L382-L416](../../client/www/js/app.js#L382-L416)):
1. After `TwStorage.init()`, the `startVersion` gate returns before scheduling ([L352-L356](../../client/www/js/app.js#L352-L356)). The popup therefore never runs on a launch that opens S01.
2. If the stored `appVersion` differs from `Util.version`, the new version is stored. `disableUpdateInfo` is reset to `false` only when `window[package].enablePopup === true`. Both products set `enablePopup: false` ([update.info.js L1](../../client/www/data/update.info.js#L1), [L30](../../client/www/data/update.info.js#L30)).
3. If `TwStorage.get('disableUpdateInfo') !== true`, `showUpdateInfoEvent` is broadcast after 500 ms, or 100 ms after a late `$rootScope.version`.
4. `disableUpdateInfo` has no default; it only appears in the restore key list ([service.storage.js L27-L28](../../client/www/js/service.storage.js#L27-L28)). The popup therefore recurs on every cold launch past the gate until the user disables it.
5. The listener exists only in `TabCtrl` ([L799-L916](../../client/www/js/controller.tabctrl.js#L799-L916)).

**Content:**
- Title: `'v' + Util.version`. The version comes from the app-version plugin, else from `update.info.js` `appVersion` ([app.js L158-L169](../../client/www/js/app.js#L158-L169)). The capture shows `v1.0.0`.
- Body entry: `Util.language.split('-')[0]` is matched against `lang`, falling back to the first entry (`en`). Only `en` and `ko` entries exist, so de/ja/zh users see English.
- Body lines: the entry's `android` lines on Android, then its `ios` lines on iOS, then its `all` lines. Each is followed by `<br>` and inserted into the template as HTML.
- A checkbox bound to `data.disable` with label `LOC_DISABLE_UPDATE_POPUP` follows the lines.
- CSS class: `update_information_popup` (85% width, max 600 px).

**Buttons:** None return values, and all close the popup. If the box is ticked, each first stores `disableUpdateInfo = true` and sends `action/popup/disableUpdateInfo` ([L857-L912](../../client/www/js/controller.tabctrl.js#L857-L912)). `data.disable` lives on the shared `TabCtrl` `data` object (see O02).

| Button | Action |
| --- | --- |
| `LOC_FEEDBACK` | `Util.sendMail` (O19) |
| `LOC_REVIEW` | `Util.openMarket` (O19) |
| `LOC_CLOSE` | Close only |

**Analytics:**
- `app/update/from X to Y` on a version change.
- `app/update/triggerShowUpdateInfo` when the event is scheduled.
- `window/show/showUpdateInfoEvent` when the listener receives the event, then `app/update/showUpdateInfoPopup` before the popup opens.
- A non-array `updateInfo` is tracked as an exception after `window/show/showUpdateInfoEvent`, and no popup is shown.

**Anomaly:** The ko label "다음 업데이트까지 닫기" ("close until the next update") is wrong, because with `enablePopup: false` no later version clears the flag. The en label "Disable update info" matches the behavior. Users who never tick the box see the same notes on every launch. Android back resolves without `onTap`, so a ticked box is ignored (source-level).

**Capture:** [tw-overlay-update-info.png](screenshots/tw-overlay-update-info.png) shows the iOS lines before the shared lines. Per the manifest note, recurrence after reload was observed until the box was ticked and a button tapped (synthetic execution).

## O06 — Weather-alert introduction (legacy alarm migration)

**Trigger:**
- `Push.init()` returns `true` when `pushData2` is absent or unparsable but legacy `pushData` exists ([service.push.js L797-L806](../../client/www/js/service.push.js#L797-L806)).
- The migration builds one alert per legacy alarm (`alarmList.map`, so a city with two legacy alarms gets two alerts), with `enable: false` and a 07–22 window. It converts old alarms to every-day alarms (`id = cityIndex + 1`) and schedules a server repost after 3 s ([L50-L83](../../client/www/js/service.push.js#L50-L83)). The result is kept in memory; `pushData2` is written by the next `savePushInfo`: a popup button, `updateCityInfo` when a record changed, a push-settings save, or a push-record removal (see [legacy migrations](client-state-and-behavior.md#legacy-migrations), step 6).
- Every migrated alert is created with `id: 1` (`newPushAlert(1, …)`), and the alarm for `cityIndex` 0 also gets `id: 1`. A source comment on the post object describes the identifier as unique within a registration ([L167-L173](../../client/www/js/service.push.js#L167-L173)), yet migrated entries can share one. Synthetic execution ([storage probe](../../reports/rewrite-verification/probes/client-storage-migration.json), variant `several legacy alarms`): two legacy alarms for city 1 and one for city 0 gave six records in which `(1,1)`, `(1,2)` and `(0,1)` each occur twice. The server-side effect was not checked.
- `showAlertInfoEvent` is broadcast 500 ms later ([app.js L333-L339](../../client/www/js/app.js#L333-L339)).
- The listener exists only in `TabCtrl` ([L1276-L1322](../../client/www/js/controller.tabctrl.js#L1276-L1322)). On a launch that routes to S01, nothing handles it (source-level).

**Text:**
- Title: `LOC_WEATHER_ALERT`.
- Body: `LOC_ADDED_BAD_WEATHER_ALERT_FUNCTION`, with only the first `\n` replaced by `<br>`.
- Button labels are TabCtrl's startup translations of `LOC_CLOSE` and `LOC_OK`. The pre-assigned English literals (title "Weather alert", a body with a raw `\n`) are replaced before the popup opens.

| Button (order) | Returns | Result |
| --- | --- | --- |
| `LOC_CLOSE` | `close` | `Push.enableAlertForOldAlarm(false)`: saves `pushData2` only; migrated alerts stay disabled |
| `LOC_OK` (`button-dark`) | `ok` | `Push.enableAlertForOldAlarm(true)`: sets `enable = true` on every alert entry, posts the whole list (skipped without an FCM token) and saves `pushData2` ([L768-L779](../../client/www/js/service.push.js#L768-L779)) |
| Android back | `undefined` | Nothing is saved. Unless another push save writes `pushData2` first, the migration, the 3 s repost and the popup repeat on the next launch (source-level) |

**Analytics:** `app/event/triggerShowAlertInfoEvent`, `app/event/showAlertInfoPopup`, and `app/event/enableAlertForOldAlarm` with value `res===true?1:0` ([L1313](../../client/www/js/controller.tabctrl.js#L1313)). **Anomaly:** that value is always `0`, because `res` is `'ok'`, `'close'` or `undefined`, never `true`.

**Capture:** [tw-overlay-alert-intro.png](screenshots/tw-overlay-alert-intro.png), triggered by broadcasting the event directly.

## O07 — Foreground notification

**Trigger:** `Push` broadcasts `notificationEvent` when the Firebase notification callback reports `tap === false` ([service.push.js L819-L850](../../client/www/js/service.push.js#L819-L850)):
- When the payload has `aps` (the iOS shape), `aps.alert.title` and `aps.alert.body` become `title` and `message`.
- Otherwise, `message = body`; `title` is whatever the payload carries.
- A tapped notification (`tap === true`) with a numeric `cityIndex` selects that city and broadcasts `reloadEvent` `'push'`, with no popup.
- The legacy `gcmRegister` path also broadcasts on `foreground === true`, but it has no caller at this revision.
- Only `TabCtrl` listens, so nothing is shown on S01 before `TabCtrl` exists. Delivery while a non-tab route (S07–S14) is active was not checked.
- The `aps`/non-`aps` and tap rules above were reproduced by the [push probe](../../reports/rewrite-verification/probes/client-push-branch-entry.json) (synthetic execution of the captured callback in a Node VM; no plugin or FCM delivery). The full field table is in [inbound notification payload](client-data-contracts.md#inbound-notification-payload).

**Content** ([controller.tabctrl.js L1254-L1274](../../client/www/js/controller.tabctrl.js#L1254-L1274)):
- Title: `LOC_WEATHER`. TabCtrl's `strWeather` starts as the literal `"Weather"`, so the `'Notification'` fallback in `strWeather||'Notification'` is unreachable.
- Body: `data.title`, then `<br>` only when both parts are non-empty, then `data.message`, concatenated as HTML. Either part may be absent; the source comment says iOS has no title.
- One `LOC_OK` button (`button-dark`) with no action.

**Analytics:** only `action/broadcast/notificationEvent`, sent by the service.

**Capture:** [tw-overlay-foreground-notification.png](screenshots/tw-overlay-foreground-notification.png) uses synthetic text; no real payload was received.

## O08 — Air-forecast source information

**Trigger:** tapping the `LOC_AIR_FORECAST_SOURCE` row, which shows the uppercased source:
- S03: the row is shown when `airForecastSource` is set ([tab-forecast.html L341](../../client/www/templates/tab-forecast.html#L341), [forecastctrl.js L376-L389](../../client/www/js/controller.forecastctrl.js#L376-L389)). It is set only from `airInfoList[0]` with an `aqi` pollutant; the `airInfo` fallback repeats the `airInfoList` test and never runs.
- S05/S16: the row is shown when `forecastSource` is set ([tab-air.html L155](../../client/www/templates/tab-air.html#L155), [air.js L263](../../client/www/js/controller.air.js#L263)).
- The publication-date row above it is display-only.

**Content** ([L1324-L1350](../../client/www/js/controller.tabctrl.js#L1324-L1350)): `$ionicPopup.alert` with no title and one `LOC_CLOSE` button. The label is TabCtrl's startup translation of `LOC_CLOSE`.

| Source value | Body |
| --- | --- |
| `kaq` | `LOC_KAQ_DESCRIPTION` |
| `airkorea` | `LOC_AIRKOREA_DESCRIPTION` |
| Anything else | No popup |

No analytics or persistence.

**Capture:** [tw-overlay-air-source-info.png](screenshots/tw-overlay-air-source-info.png), `'airkorea'` on `tab.air`.

## O09 — Shared `$rootScope.showAlert` / `showConfirm`

`SettingCtrl` defines both helpers. It lives in the `index.html` side menu, so they always exist ([settingctrl.js L120-L149](../../client/www/js/controller.settingctrl.js#L120-L149)).
- `showAlert(title, msg, callback)` shows `$ionicPopup.alert` with `okText` `LOC_OK` and calls the optional `callback` after close. No caller passes a callback, and there is no analytics.
- `showConfirm(title, template, callback)` shows `$ionicPopup.confirm` with `LOC_OK` and `LOC_CANCEL` and calls `callback(res)`. It has no caller at this revision.

| Flow | Condition | Title / body |
| --- | --- | --- |
| S01 search result, chip, current location ([start.js L243-L375](../../client/www/js/controller.start.js#L243-L375), [L612-L662](../../client/www/js/controller.start.js#L612-L662)) | `saveCity()` returns `false`: either `WeatherInfo.addCity()` rejected a duplicate or `convertWeatherData()` returned `undefined` ([L582-L610](../../client/www/js/controller.start.js#L582-L610)). For current location, only the conversion failure is possible, and the slot is re-disabled first ([L639-L643](../../client/www/js/controller.start.js#L639-L643)) | `LOC_ERROR` / `LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED` |
| Same | Weather request failed | `LOC_ERROR` / `LOC_FAIL_TO_GET_WEATHER_INFO` |
| S02 result selection ([searchctrl.js L355-L508](../../client/www/js/controller.searchctrl.js#L355-L508)) | Same two conditions; its `saveCity()` also returns `false` for an unconvertible response ([L305-L325](../../client/www/js/controller.searchctrl.js#L305-L325)) | Same two messages |
| S06 About | See O10 | — |

**Anomaly: misleading duplicate message** (source-level). An unconvertible weather response is reported as "already added". For the S01 current-location path it is the only way to reach that message.

**Silent failures:**
- A Google prediction whose geocode (`getGeoInfoByAddr`) fails only hides the loading overlay; no alert is shown ([start.js L351-L354](../../client/www/js/controller.start.js#L351-L354), [searchctrl.js L483-L486](../../client/www/js/controller.searchctrl.js#L483-L486)).
- An exception while `SearchCtrl` builds the query string is also silent ([L455-L459](../../client/www/js/controller.searchctrl.js#L455-L459)).

**Capture:** [tw-overlay-start-error-alert.png](screenshots/tw-overlay-start-error-alert.png), from a direct call; the add flow was not executed.

## O10 — About attribution

**Trigger:** The S06 item is visible only when `Util.language` contains `ko` ([index.html L148](../../client/www/index.html#L148), [settingctrl.js L89-L91](../../client/www/js/controller.settingctrl.js#L89-L91)). It calls `clickMenu('openInfo')`, which runs `openInfo()` ([L63-L83](../../client/www/js/controller.settingctrl.js#L63-L83)). The side menu is not closed.

**Content** (via O09 `showAlert`, OK only):
- Title: the translated product name.
- Body (fixed text, independent of the city's data source):
  - `LOC_WEATHER_INFORMATION : LOC_KOREA_METEOROLOGICAL_ADMINISTRATION` `<br>`
  - `LOC_AQI_INFORMATION : LOC_KOREA_ENVIRONMENT_CORPORATION` `<br>`
  - `LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS`
- A missing key is displayed as the key itself.

No analytics or persistence.

**Capture:** [tw-overlay-about.png](screenshots/tw-overlay-about.png).

## O11 — Push permission popup

Source: `PushCtrl._showPermissionPopUp()` ([controller.push.js L190-L245](../../client/www/js/controller.push.js#L190-L245)).

**Triggers:**
- `PushCtrl` init, when `Push.inited` is true, an FCM token exists and `hasPermission` reports `isEnabled === false`. On iOS, `Push.grantPermission` runs first; this is the OS prompt in O19 ([L85-L116](../../client/www/js/controller.push.js#L85-L116)).
- `onOkay()` (the bottom `LOC_SAVE` button or O12 Save), when `Push.inited` is true and `hasPermission` reports permission off. Nothing is saved and the page stays open ([L358-L368](../../client/www/js/controller.push.js#L358-L368)).

**Text:**
- Title: hard-coded English `"Permission"`.
- Body: `LOC_NOTIFICATION_IS_OFF_TURN_ON_NOTIFICATION_FOR_THIS_APP`.

**Buttons:**
- `LOC_CLOSE`→`close`: sends `action/click/close`. Android back (`undefined`) takes the same branch.
- `LOC_SETTING` (`button-dark`)→`settings`: sends `action/click/settings` and calls `diagnostic.switchToSettings()` (unguarded).
- The unreachable translation-failure branch would log `translate/error/showRetryConfirm`, a label copied from TabCtrl ([L196-L203](../../client/www/js/controller.push.js#L196-L203)).

**Capture:** not captured, because it needs Firebase and a token.

## O12 — Push save-changes confirm

**Trigger:** `PushCtrl.onClose()` sends `action/click/arrow back` on every call, then goes back directly when `updated` is false and opens this confirm when it is true ([L257-L310](../../client/www/js/controller.push.js#L257-L310)). It is bound to both the header back arrow and the bottom `LOC_CANCEL` button ([setting-push.html L4](../../client/www/templates/setting-push.html#L4), [L53](../../client/www/templates/setting-push.html#L53)). `updated` is set by:
- Defaults applied at init.
- The range slider.
- The alert toggle.
- A weekday toggle.
- Time-picker Set or Delete (O14).

**Text:**
- Title: hard-coded English `"Save"`.
- Body: `LOC_SAVE_CHANGES`.

| Button (order) | Returns | Result |
| --- | --- | --- |
| `LOC_CLOSE` | `close` | `action/click/close`, then `$ionicHistory.goBack()`; edits are discarded |
| `LOC_SAVE` (`button-dark`) | `save` | Calls `onOkay()` ([L326-L369](../../client/www/js/controller.push.js#L326-L369)). If start = end, shows O13 and stays. If `!Push.inited`, saves locally and goes back. Otherwise, if permission is on, saves and goes back; if off, shows O11 and stays |
| Android back while the confirm is open | `undefined` | Same as Close |

Saving calls `Push.updatePushListByCityIndex`, which POSTs the list (skipped without a token) and stores `pushData2` ([service.push.js L663-L674](../../client/www/js/service.push.js#L663-L674)). Save with `updated` false saves nothing and goes back ([L169-L188](../../client/www/js/controller.push.js#L169-L188)).

**Android hardware back bypasses this confirm** (source-level). S09 (`/setting-push`) is not a tab route, so the O15 handler that `TabCtrl` registered and never deregisters calls `$ionicHistory.goBack()` directly; pending edits are discarded without a prompt.

**First open prompts:** When a city has no stored alert, weekdays or alarms, `init()` fills in defaults and sets `updated = true` ([L33-L53](../../client/www/js/controller.push.js#L33-L53)). Back or Cancel therefore prompts immediately, and Save submits values the user never edited:
- Alert enabled, 07–22.
- Weekdays Mon–Fri: `[false,true,true,true,true,true,false]`.
- Alarms at 07:40 and 20:20.

**Capture:** [tw-overlay-push-save-confirm.png](screenshots/tw-overlay-push-save-confirm.png) shows the English "Save" title over the default form.

## O13 — Push equal-time alert

**Trigger:** `onOkay()` (bottom `LOC_SAVE` button or O12 Save) when the slider's `startTime === endTime` ([L327-L349](../../client/www/js/controller.push.js#L327-L349)). The check ignores `alert.enable`, so it also blocks saving while the alert toggle is off and the slider is hidden (`ng-hide="alert.enable === false"`, [setting-push.html L27](../../client/www/templates/setting-push.html#L27)).

**Content:** `$ionicPopup.alert` with no title, body `LOC_START_TIME_AND_END_TIME_CAN_NOT_BE_THE_SAME_TIME` and one `LOC_CLOSE` button.

**Effects:** Returns without saving or navigating. No analytics.

**Capture:** not captured. It would render without plugins but was not attempted in this round.

## O14 — Push time picker

**Trigger:** tapping an enabled alarm row, or the `HH:MM` add row. The add row is shown while fewer than 5 alarms are enabled ([L371-L376](../../client/www/js/controller.push.js#L371-L376)). Either calls `onOpenTimePicker(index)` ([L383-L451](../../client/www/js/controller.push.js#L383-L451)).

**Library:** `ionicTimePicker`, from the fork `WizardFactory/ionic-timepicker#e2d5cd3` ([client/bower.json](../../client/bower.json)). It is not vendored in `client/www`; the same commit is bundled at [tw.ios/www/lib/ionic-timepicker](../../tw.ios/www/lib/ionic-timepicker/src/ionic-timepicker.provider.js#L113-L163) (the app loads its `dist` bundle, [index.html L29](../../client/www/index.html#L29); the provider source was read). App configuration: 12-hour format, 5-minute step, 3 buttons ([app.js L1976-L1980](../../client/www/js/app.js#L1976-L1980)). The initial time is the alarm's time, or 08:00 for a new alarm.

| Button (library order) | Callback value | PushCtrl result |
| --- | --- | --- |
| `LOC_SETTING` (Set) | Seconds since midnight | `alarm/set`. Appends a new alarm that shares the weekday array, or updates `time` and sets `enable = true`. `updated = true` |
| `LOC_DELETE` | `0` | `alarm/cancel`. Sets the existing alarm's `enable = false`. On the add row there is no alarm, so only `updated = true` changes |
| `LOC_CLOSE` | `undefined` | `alarm/close/timePicker`; no change |
| Android back | No callback | Nothing is logged or changed (source-level) |

Every opening sends `alarm/open/timePicker`. Deleted alarms stay in the list with `enable = false` and are hidden by the row's `ng-if` ([setting-push.html L43](../../client/www/templates/setting-push.html#L43)). Changes persist only through Save (O12).

**Anomaly:** Choosing Set at 12:00 AM yields `0` seconds, which PushCtrl handles as Delete (source-level, from the bundled provider). Midnight alarms therefore cannot be created.

**Capture:** not captured.

## O15 — Android hardware-back exit confirm

**Registration:** Only on Android, in `TabCtrl.init()`, at priority 100 ([L34-L60](../../client/www/js/controller.tabctrl.js#L34-L60)). The deregistration handle is discarded, so the handler stays active on every later route. It ties with Ionic's default view handler (also 100, [L54679-L54694](../../tw.ios/www/lib/ionic/js/ionic.bundle.js#L54679-L54694)) and wins because it is registered later. Before `TabCtrl` exists (for example on a first-run S01), Ionic's default applies: go to the back view, or exit when there is none.

**Routes:** On `/tab/search`, `/tab/forecast`, `/tab/dailyforecast`, `/tab/air` and `/tab/weather`, back opens a popup. On every other route it calls `$ionicHistory.goBack()` without checking the page state; on S09 this skips the O12 save prompt.

**Content:** No title; body `LOC_DO_YOU_WANT_TO_EXIT`.

**Buttons:**
- `LOC_CANCEL`: no action.
- `LOC_OK`: calls `ionic.Platform.exitApp()`.
- No analytics.

An open side menu (priority 150, closes the menu), open popups (400) and loading (500) take precedence over this handler ([side menu L61163-L61172](../../tw.ios/www/lib/ionic/js/ionic.bundle.js#L61163-L61172)). Pressing back again while the exit confirm is open resolves it with `undefined`, which does nothing. `TabCtrl.init()` registers the handler only after TabCtrl's startup translation settles, so the texts are already translated ([L1400-L1438](../../client/www/js/controller.tabctrl.js#L1400-L1438)).

**Capture:** not captured. The iOS harness has no hardware back; the Ionic-android-mode captures do not exercise it.

## O16 — Share sheet and message text

**Trigger:** the header share button on S03/S04/S05/S15/S16 ([tab-forecast.html L24-L31](../../client/www/templates/tab-forecast.html#L24-L31); the same button exists in the daily, air and TodayAir weather templates). It calls `doTabShare()` ([L218-L287](../../client/www/js/controller.tabctrl.js#L218-L287)).

**Guards:**
- Without `window.plugins.socialsharing`, the handler returns **silently**: no UI, no analytics ([L219-L222](../../client/www/js/controller.tabctrl.js#L219-L222)).
- A missing selected city, or a city without `location`, opens O02 instead. This also covers a stored address-only city.

**Message templates:** `\n`-separated. The product line uses the translated `$rootScope.title`. `cityName` is `city.name`, else `WeatherUtil.getShortenAddress(address)`.

| Product | Lines |
| --- | --- |
| TodayWeather ([L167-L201](../../client/www/js/controller.tabctrl.js#L167-L201)) | `{cityName}` / `{LOC_CURRENT} {t1h}˚ {emoji}` / `{LOC_HIGHEST} {tmx}˚, {LOC_LOWEST} {tmn}˚` / `{summary}` (only if present) / *(blank)* / `{LOC_TODAYWEATHER} {url}` |
| TodayAir ([L203-L216](../../client/www/js/controller.tabctrl.js#L203-L216)) | `{cityName}` / `{LOC_CURRENT} {summaryAir}` (empty line if absent) / `{LOC_WEATHER} {weather} {t1h}˚` / `{LOC_TODAYAIR} {url}` |

- `summary` is `summaryWeather`, followed by `"\n" + summaryAir` when present; otherwise it is `summary`.
- `emoji` comes from `WeatherUtil.getWeatherEmoji(skyIcon)`, a first-match substring test in this order ([service.weatherutil.js L849-L876](../../client/www/js/service.weatherutil.js#L849-L876)): `lightning` ⛈; `rainsnow` ☔☃; `rain` ☔; `snow` ☃; `cloud` with `sun` or `moon` ⛅; other `cloud` ☁; `sun` or `moon` 🌞 (night icons also get the sun emoji); otherwise an empty string.

Branch share URLs ([L239-L258](../../client/www/js/controller.tabctrl.js#L239-L258)):

| Product | `Util.language` contains `ko` | Other languages |
| --- | --- | --- |
| TodayWeather | `https://twa.app.link/wgVmUTfVoM` | `https://twa.app.link/II1JstpVoM` |
| TodayAir | `https://ta.app.link/cgFJXnSUoM` | `https://ta.app.link/0fdwClTVoM` |
| Unknown package | `https://twa.app.link/II1JstpVoM` | Same |

**Call:** `window.plugins.socialsharing.share(message, null, null, null)`. The URL appears only inside the text, with no subject, file or URL argument. The result is not observed.

**Analytics:** `action/tab/share` is sent once the guards pass. The rejection branch (message = the URL alone, `action/error/fail to translate for sharing`) does not run with the bundled angular-translate.

**Source-level anomalies (not reproduced):**
- A missing `today` renders `undefined˚` (TodayWeather); a missing `weather` or `t1h` renders `undefined` (TodayAir).
- A missing `currentWeather` (both products) or `skyIcon` (TodayWeather) throws inside the translation callback. `finally` still opens the sheet, with only the city-name line.

**Capture:** not capturable, because the plugin is absent. Only the text is documented.

## O17 — Loading: `$ionicLoading` overlay and header spinner

**Full-screen overlay.** The default template is `<ion-spinner icon="bubbles" class="spinner-stable">` ([app.js L1982-L1984](../../client/www/js/app.js#L1982-L1984)). It blocks input and disables Android back while shown. It is used only by:

| Flow | Source |
| --- | --- |
| S01 selection | [start.js L256](../../client/www/js/controller.start.js#L256), [L614](../../client/www/js/controller.start.js#L614) |
| S01 current location, through a race guard | [L377-L393](../../client/www/js/controller.start.js#L377-L393) |
| S02 result selection | [searchctrl.js L369](../../client/www/js/controller.searchctrl.js#L369) |
| S02 find-by-location and current-position row refresh, through the same race guard | [L245](../../client/www/js/controller.searchctrl.js#L245), [L527](../../client/www/js/controller.searchctrl.js#L527), [L627-L641](../../client/www/js/controller.searchctrl.js#L627-L641) |
| S10 initial load; a failure only records an exception, hides the overlay and leaves the map empty | [nation.js L160-L173](../../client/www/js/controller.nation.js#L160-L173) |
| S11 initial load, same failure behavior | [nation.air.js L128-L141](../../client/www/js/controller.nation.air.js#L128-L141) |
| iOS purchase, custom text (O18) | [purchase.alexdisler.js L306](../../client/www/js/controller.purchase.alexdisler.js#L306), [L375](../../client/www/js/controller.purchase.alexdisler.js#L375) |

`TabCtrl` does not inject `$ionicLoading`.

**Anomaly: overlay may never hide** (source-level, not reproduced). This affects the S01/S02 current-location flow with location services off:
1. `_getCurrentPosition(false, undefined)` queries the authorization status.
2. The promise settles only for `DENIED` and `NOT_REQUESTED`.
3. `GRANTED` and `GRANTED_WHEN_IN_USE` are only logged. Other values and the error callback are unhandled.
4. The promise therefore never settles, and nothing hides the overlay ([start.js L532-L573](../../client/www/js/controller.start.js#L532-L573), [searchctrl.js L778-L819](../../client/www/js/controller.searchctrl.js#L778-L819)).

An example trigger is Android with location mode off and permission granted. The Android location-on path has the same gap: a status other than the four handled ones, or the status error callback, never settles ([start.js L409-L423](../../client/www/js/controller.start.js#L409-L423), [searchctrl.js L656-L670](../../client/www/js/controller.searchctrl.js#L656-L670)).

**Header spinner.** `TabCtrl` toggles `showLoadingIndicator` ([L1019-L1025](../../client/www/js/controller.tabctrl.js#L1019-L1025)):
- `loadWeatherData` sets it ([L939](../../client/www/js/controller.tabctrl.js#L939)).
- For saved cities, the weather result clears it.
- For the current-position city, it clears only when the position update settles ([L940-L1009](../../client/www/js/controller.tabctrl.js#L940-L1009)).
- It renders `<ion-spinner icon="bubbles">` in the nav title of `tab-forecast.html`, `tab-dailyforecast.html`, `tab-air.html` and `ta-tab-weather.html` ([tab-forecast.html L5-L11](../../client/www/templates/tab-forecast.html#L5-L11)).
- It replaces the location glyph and does not block input.
- **Anomaly: spinner can stay on** (source-level, not reproduced). On Android with location on, `updateCurrentPosition()` settles only for the statuses `GRANTED`, `DENIED_ALWAYS`, `NOT_REQUESTED` and `DENIED`. Any other status, or the error callback of `getLocationAuthorizationStatus`, leaves the promise pending. Nothing then clears the spinner until another city's load finishes ([L1057-L1072](../../client/www/js/controller.tabctrl.js#L1057-L1072)).

**Anomaly: invisible in the light theme.** `.body-content .bar p svg {stroke: #fff; fill: #fff}` ([ionic.app.scss L170-L182](../../client/scss/ionic.app.scss#L170-L182)) paints the spinner white on the white `.light-theme` header ([L103-L114](../../client/scss/ionic.app.scss#L103-L114)). Light is the default theme ([service.storage.js L202-L214](../../client/www/js/service.storage.js#L202-L214), also the fallback for a stored setting without a theme at [L160-L161](../../client/www/js/service.storage.js#L160-L161)) and the only non-dark choice in TodayAir. The captures confirm it (synthetic execution): [light](screenshots/tw-loading-header-spinner-light.png) shows the spinner in the DOM but invisible, and [dark](screenshots/tw-loading-header-spinner-dark.png) shows it visible.

**Captures:** [tw-loading-overlay-search.png](screenshots/tw-loading-overlay-search.png) and the two spinner captures above.

## O18 — Purchase progress and error alerts

**Build selection:** Gulp copies [controller.purchase.alexdisler.js](../../client/www/js/controller.purchase.alexdisler.js) for the iOS tasks and [controller.purchase.j3k0.js](../../client/www/js/controller.purchase.j3k0.js) for the Android tasks ([gulpfile.js L80](../../client/gulpfile.js#L80), [L94](../../client/gulpfile.js#L94) and the matching release tasks). The checked-in `controller.purchase.js` is a j3k0 variant fixed to `tw1year`.

**iOS (`cordova-plugin-inapppurchase`), PurchaseCtrl** ([L283-L437](../../client/www/js/controller.purchase.alexdisler.js#L283-L437)):
- **Order:** `$ionicLoading` with a `dots` spinner and `LOC_PURCHASING`. On plugin failure, a `$ionicPopup.alert` appears with title `LOC_PURCHASE_ERROR`, body the raw `err.message` (not localized) and Ionic's default English `OK`. A user cancel (`err.code == -5`) is logged as `purchase/cancel/subscribe`, but the same error alert is still shown ([L351-L371](../../client/www/js/controller.purchase.alexdisler.js#L351-L371)).
- **Restore:** `$ionicLoading` with `LOC_RESTORING_PURCHASES`. On failure, an alert with title `LOC_RESTORE_ERROR` and body `err.message` ([L374-L405](../../client/www/js/controller.purchase.alexdisler.js#L374-L405)).
- **Success:** No popup. The page switches to the premium state (`accountLevel`, `expirationDate`).
- **Anomaly** (source-level, not reproduced): receipt-validation failures throw inside the `checkReceiptValidation` `$http` callback, outside the promise chain ([L329-L341](../../client/www/js/controller.purchase.alexdisler.js#L329-L341)). The `.catch` alert is never reached; only the loading overlay is hidden. That message would also use `LOC_PLEASE_RESTORE_AFTER_1_2_MINUTES`, which zh-CN/zh-TW spell `LOC_PLEASE_RESTORE_AFTER_1-2_MINUTES`.

**Android (`cc.fovea.cordova.purchase`):** `order()` and `restore()` delegate to `store.order` and `store.refresh`, which use native store UI. There is no web progress or alert; `store.error` only logs `purchase/error/<message>` ([j3k0 L87-L158](../../client/www/js/controller.purchase.j3k0.js#L87-L158)).

**Capture:** not captured. Only the S13 plugin-unavailable state exists.

## O19 — Native surfaces and hand-offs

None of these render in the plugin-less harness. The screenshots also omit the banner area reserved for free accounts.

| Surface | Trigger / owner | Behavior and failure path |
| --- | --- | --- |
| AdMob bottom banner | `TwAds.init()` from `TabCtrl.init()` ([L63](../../client/www/js/controller.tabctrl.js#L63), [service.twads.js L140-L186](../../client/www/js/service.twads.js#L140-L186)) | Banner at the bottom center with `overlap: false`, so the web view shrinks. `SMART_BANNER` on iOS, `BANNER` on Android ([service.admobpro.js L34-L45](../../client/www/js/service.admobpro.js#L34-L45)). Enabled when `twAdsInfo` is absent ([twads L28-L30](../../client/www/js/service.twads.js#L28-L30)). Hidden on S01 (re-shown on its `close()` for free accounts), S13 and S14. Recreated on `orientationchange`. Configuration uses the `clientConfig.admob*` unit names |
| OS location-permission prompt | `diagnostic.requestLocationAuthorization(WHEN_IN_USE)` when status is `NOT_REQUESTED` (on Android, also `DENIED`), from TabCtrl [L1114-L1148](../../client/www/js/controller.tabctrl.js#L1114-L1148), StartCtrl [L469-L499](../../client/www/js/controller.start.js#L469-L499) and SearchCtrl [L715-L745](../../client/www/js/controller.searchctrl.js#L715-L745). Start and Search also request it for location off with status `NOT_REQUESTED` ([start.js L546-L569](../../client/www/js/controller.start.js#L546-L569), [searchctrl.js L792-L815](../../client/www/js/controller.searchctrl.js#L792-L815)). Only their location-on branch hides the loading overlay first | Android `DENIED` produces a message and O03/O04. Every other result, and every iOS result, rejects `null` without a popup. TabCtrl then waits: on iOS for `reloadEvent` `'locationOn'` from `registerLocationStateChangeHandler` ([app.js L235-L247](../../client/www/js/app.js#L235-L247)), on Android for the `resume` reload ([app.js L228-L231](../../client/www/js/app.js#L228-L231)). Start and Search re-run their flow immediately on a `null` rejection |
| Location-accuracy (turn-on) prompt | `cordova.plugins.locationAccuracy.request(HIGH_ACCURACY)`. In TabCtrl it runs only when location is off and the current-position city has `address === null && location === null` ([L1150-L1171](../../client/www/js/controller.tabctrl.js#L1150-L1171)). Not platform-gated | Success is silent; the app reloads on `locationOn`. Error or missing plugin produces `LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION` and O03 `forecast`. The Start/Search branches ([start.js L501-L522](../../client/www/js/controller.start.js#L501-L522), [searchctrl.js L747-L767](../../client/www/js/controller.searchctrl.js#L747-L767)) need `enabled=false, authorized=true`, which their `updateCurrentPosition()` never passes: they are unreachable (source-level) |
| Settings deep links | `switchToSettings()` (app settings) and `switchToLocationSettings()` (Android) from O03, O04 and O11, and from the header location glyph ([forecastctrl.js L658-L674](../../client/www/js/controller.forecastctrl.js#L658-L674)) | The glyph acts only while location is disabled, then calls `WeatherInfo.reloadCity`. The glyph handler exists only in ForecastCtrl screens |
| iOS notification permission | `Push.grantPermission()` on every S09 init when `Push.inited` is true and an FCM token exists ([push.js L85-L106](../../client/www/js/controller.push.js#L85-L106)) | Followed by `hasPermission`; if off, shows O11 |
| Feedback mail | Menu `sendMail` (closes the menu) and O05 Feedback, through `Util.sendMail` ([service.util.js L251-L266](../../client/www/js/service.util.js#L251-L266)) | `mailto:` to `clientConfig.mailTo`, subject `LOC_SEND_FEEDBACK`. The body contains the app version, device UUID and user agent. Reads `window.device.uuid` without a guard. Sends `action/click/send mail` |
| Store page | Menu `openMarket` (closes the menu) and O05 Review, through `Util.openMarket` ([L268-L295](../../client/www/js/service.util.js#L268-L295)) | Opens `clientConfig.iOSStoreUrl`, `androidStoreUrl` or `etcUrl` via InAppBrowser `_system` and sends `action/click/open market`; without the plugin it sends `inappbrowser/error/loadPlugin` and calls `window.open(_blank)` |
| Wind map | Menu `nullschool`, KR region only ([settingctrl.js L39-L53](../../client/www/js/controller.settingctrl.js#L39-L53)) | Opens `earth.nullschool.net` externally (`_system`, else `window.open`). The menu stays open. Sends `action/click/open nullschool` |
| Share sheet, store purchase UI | O16, O18 | — |

## Rewrite notes: behaviors needing an explicit keep/fix decision

These are proposals for the decision register, not implemented changes.

1. **O02 label/action inversion.** Keep the shipped action mapping, or restore the label mapping (as before `61be2230` and in `GuideCtrl`) and make search the explicit default regardless of location state (the #2018 intent). Also decide on the hidden title and the Android-back → search branch.
2. **O05 recurrence.** The popup shows on every cold launch past the `startVersion` gate until disabled, and disabling is permanent despite the ko label "until the next update" (`enablePopup: false`). Android back ignores the checkbox. Define a per-version "seen" rule and a single language-fallback policy.
3. **O06 migration popup.** The analytics value is always 0, dismissing with back leaves the migration unsaved so it re-prompts and re-posts, and migrated entries can share `id: 1`. Decide whether legacy `pushData` migration is still needed at all.
4. **O12/O14 push defaults.** First-open Back or Cancel prompts to save defaults the user never edited, and Save registers a 07–22 alert plus 07:40/20:20 Mon–Fri alarms. Android hardware back skips the prompt and discards edits. Midnight equals Delete. The titles `"Permission"` and `"Save"` are English-only.
5. **O03/O04 retry sets.** The retry button reads `LOC_OK` (`LOC_RETRY` is unused). The two controllers offer different button sets and messages for the same permission states. The `search` Retry re-runs find-by-location even after a row-refresh failure. Plugin reads are unguarded, so failures are silent without the plugin, and the app-info hint text names TodayWeather in TodayAir. Specify one variant table for all flows.
6. **O09 duplicate message.** An unconvertible weather response is reported as "already added". Decide on a distinct conversion-failure message.
7. **O16 share.** Share is a silent no-op without the plugin, an address-only city opens O02, and missing fields render as `undefined`. Decide the fallback (for example a web share or a copy-link action) and the exact text template per product and language.
8. **O17 loading.** The light-theme header spinner is invisible. The Start/Search overlay can stay on when location is off with permission granted; the overlay and the tab spinner can both stay on when Android returns an unexpected location status or a status error. Tab refresh has no blocking overlay, while Start/Search/Nation do, and Nation failures are silent.
9. **O18 purchase errors.** Raw plugin messages, an English `OK` button, an alert on user cancel, and validation errors that never reach the user.
10. **O19 native hand-offs.** The location-accuracy prompt is reachable only from TabCtrl. The feedback mail includes the device UUID. The access explanation (O01) describes permissions it does not request and repeats on every S01 entry.
11. **Android back.** Popups resolve `undefined`, and the `TabCtrl` handler stays registered for every later route. Any rewrite that adds cancel semantics must define the back result for each dialog and each non-tab page.
