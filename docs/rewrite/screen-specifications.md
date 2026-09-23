# Screen specifications

Baseline: `ff7acf3996ccb66c912d2ed4710cf300197d6966`, inspected 2026-09-23. This describes the existing application, not a proposed redesign. Screen IDs are documentation identifiers, not production route IDs. Repository prose is English; captures show the Korean UI.

Screenshots use current `client/www` JS/templates/assets and compiled current SCSS in an isolated iOS WKWebView. Weather, air, national summaries and warnings are **synthetic fixtures**, not real observations. Cordova readiness is simulated; native plugins, release credentials and external provider access are absent. See [capture provenance](screenshots/README.md), [data contracts](client-data-contracts.md), and [state behavior](client-state-and-behavior.md). A screenshot proves a rendered state, not an entire user journey or API integration.

## Navigation and coverage

The route registry is in [app.js](../../client/www/js/app.js). `tab` is an abstract container. TodayWeather iOS has favorites, hourly, daily and air tabs; TodayAir has favorites, air and combined weather. Android uses a separate tab template. A selected weather tab also acts as refresh through `doTabForecast`; changing tabs and refreshing are not identical actions.

| ID | Screen / route | Implementation | Capture |
| --- | --- | --- | --- |
| S01 | Initial location selection `/start` | `StartCtrl`, `start.html` | [Large](screenshots/tw-start.png), [compact](screenshots/tw-start-compact.png) |
| S02 | Saved locations/search `/tab/search` | `SearchCtrl`, `tab-search.html` | [Favorites](screenshots/tw-favorites.png) |
| S03 | Hourly weather `/tab/forecast?fav` | `ForecastCtrl`, `tab-forecast.html` | [Large](screenshots/tw-hourly.png), [compact](screenshots/tw-hourly-compact.png) |
| S04 | Daily weather `/tab/dailyforecast?fav` | `ForecastCtrl`, `tab-dailyforecast.html` | [Large](screenshots/tw-daily.png), [compact](screenshots/tw-daily-compact.png) |
| S05 | Air detail `/tab/air?fav&code` | `AirCtrl`, `tab-air.html` | [Air](screenshots/tw-air.png) |
| S06 | Side menu/settings, no separate state | `SettingCtrl`, `index.html` | [Menu](screenshots/tw-menu.png) |
| S07 | Unit overview `/units` | `UnitsCtrl`, `units.html` | [Units](screenshots/tw-units.png) |
| S08 | Generic radio choice `/setting-radio` | `RadioCtrl`, `setting-radio.html` | [Temperature](screenshots/tw-temperature-unit.png), [theme](screenshots/tw-theme.png) |
| S09 | City notifications `/setting-push?fav` | `PushCtrl`, `setting-push.html` | [Settings](screenshots/tw-push-settings.png) |
| S10 | Nationwide weather `/nation` | `NationCtrl`, `nation.html` | [Weather map](screenshots/tw-nation.png) |
| S11 | Nationwide air `/nation-air` | `NationAirCtrl`, `nation-air.html` | [Air map](screenshots/tw-nation-air.png) |
| S12 | Weather bulletins `/kma-special` | `KmaSpecialCtrl`, `kma-special.html` | [Synthetic bulletin](screenshots/tw-warning.png) |
| S13 | Purchase/ad removal `/purchase` | `PurchaseCtrl`, `purchase.html` | [Plugin unavailable](screenshots/tw-purchase-unavailable.png) |
| S14 | Legacy guide `/guide` | `GuideCtrl`, `guide.html` | [Guide](screenshots/tw-guide.png) |
| S15 | TodayAir combined weather `/tab/weather?fav` | `ForecastCtrl`, `ta-tab-weather.html` | [TodayAir weather](screenshots/ta-weather.png) |
| S16 | TodayAir primary air view `/tab/air` | `AirCtrl`, `tab-air.html`, `ta-tabs.html` | [TodayAir air](screenshots/ta-air.png) |

All routed screens above have a capture; S06 is the non-routed side menu. Native widget/watch surfaces are separate applications and are outside this screenshot set. The purchase capture is deliberately the plugin-unavailable state, not a simulated successful store purchase.

## Shared presentation and data rules

- `WeatherInfo` owns the selected city and normalized weather; controllers select subsets for templates. HTTP payloads are not bound directly to every screen. `Units` is separate global state, and icon paths come from `window.theme`.
- City index zero represents the current-position slot and may be disabled. `fav` parameters can select a stored city. A disabled current-position slot is not an ordinary empty favorite.
- Forecast/air pages inherit layout, refresh, sharing, location and menu behavior from `TabCtrl`. `applyEvent`, `reloadEvent`, resume and settings events coordinate updates. See [TabCtrl](../../client/www/js/controller.tabctrl.js).
- Text comes from [locales](../../client/www/locales); weather condition/summary strings may already arrive from the server. Preserve the distinction between localization keys and server prose.
- Horizontal forecast overflow is intentional. Page-wide overflow, clipped controls, missing fonts or hidden navigation titles are not acceptable rewrite outcomes. The [full-screen baseline](screenshots/baseline-unsafe-area.png) hides the city title under Dynamic Island; native safe-area hosting avoids this in the harness. Real Cordova status-bar/safe-area behavior remains unverified.
- Most pages assume partial cached data can exist. Define loading, stale, missing, offline and error states explicitly during rewrite; do not infer an empty-state design from a successful screenshot.

## S01 — Initial location selection

**Purpose and entry.** Establish the first enabled city. Startup enters `/start` when saved `startVersion` is absent or older than `Util.startVersion`; forecast pages can return here when no cities are enabled.

**Visible structure.** Product icon, region search input, recommended-city chips, current-location action, optional first-use access explanation. Recommended cities are a built-in list whose visible count depends on available space.

**Actions and data.** A chip supplies `{name,country,address,location:{lat,long}}` to `getWeatherByGeoInfo`. Search autocomplete is backed by Google Places, followed by location/geocode resolution and weather loading. Current-position uses the location service. Success converts weather, adds/updates the city, stores `startVersion`, selects the city and opens the product's primary weather/air page. Duplicate-city and request failures show alerts. No successful autocomplete or native permission result is implied by the capture.

**Rewrite checks.** Empty input, no predictions, unavailable Places SDK, duplicate city, location denied/disabled/timeout, weather failure, small-height chip layout, and a successful selected-city transition. Do not require live location merely to render the first screen.

Sources: [StartCtrl](../../client/www/js/controller.start.js), [template](../../client/www/templates/start.html), [startup](../../client/www/js/app.js).

## S02 — Saved locations and search

**Purpose and entry.** Select/manage favorites and add locations; first tab in both products.

**Visible structure.** Search field and edit action; saved-city cards; weather icon/current temperature and daily min/max for TodayWeather, air status/value for TodayAir; notification action; editing controls for disabling current location or deleting ordinary cities.

**Data and actions.** `WeatherInfo` cities become display rows with name/address, current-position/disabled state, weather/current temperature, daily extrema, air status and `hasPush`. Selecting a row changes the selected city and opens the appropriate product page. Search and addition reuse geocode/weather paths; deleting a city must also preserve/reconcile notification-to-city associations. Editing is a distinct state from normal row navigation.

**Failure behavior and rewrite checks.** Search errors and duplicates show alerts; missing weather may leave a row without complete values. Verify zero-valued AQI, disabled location row, multiple cities, deletion/reindexing, long translated names, empty favorites, refresh and persistence after restart. The capture contains one synthetic favorite, not search predictions.

Sources: [SearchCtrl](../../client/www/js/controller.searchctrl.js), [template](../../client/www/templates/tab-search.html), [WeatherInfo](../../client/www/js/service.weatherinfo.js).

## S03 — Hourly weather

**Purpose and entry.** Show current conditions relative to yesterday and short-range changes. This is TodayWeather's default startup page (`startupPage="0"`).

**Visible structure.** City header and location/loading indicator, notification/share actions, current temperature/icon, weather/air summary, horizontally scrolling day/hour labels, today's and yesterday's temperature lines, current marker, expandable details, optional hourly air forecast and weather detail cards.

| UI region | Consumed normalized fields |
| --- | --- |
| Hero | `currentWeather.t1h`, `skyIcon`, `summaryWeather` or `summary`, optional `summaryAir` |
| Hour labels | `timeTable[].date/time/fromToday` |
| D3 lines | `timeChart[0/1].values[].value.t3h`; row weather/icon/precipitation values; `[1].currentIndex/displayItemCount` |
| Required companion data | `dayChart[0].values`, `currentWeather.today`, selected city's name/address/source |
| Detail cards | Available humidity, wind, precipitation, visibility and other current values; yesterday comparison; observation/publication display |
| Air enrichment | Preferred `airInfoList[0]`, forecast publication/source and pollutant hourly rows |

**Actions and states.** Swipe changes city; chart scroll changes viewed hours; expander reveals detail series; repeated active-tab selection requests refresh; share/notification actions cross native/service boundaries. Missing valid city/day data short-circuits rendering; request failures go through shared retry/error behavior. Charts deliberately rely on yesterday/current series alignment—do not replace this with arbitrary sorting.

**Rewrite checks.** Midnight and date labels, currentIndex edges, missing/sentinel values, C/F, mixed publication times, correct yesterday comparison, zero precipitation, short data arrays and compact-width scrolling.

Sources: [ForecastCtrl](../../client/www/js/controller.forecastctrl.js), [template](../../client/www/templates/tab-forecast.html), [chart directives](../../client/www/js/app.js), [normalizer](../../client/www/js/service.weatherutil.js).

## S04 — Daily weather

**Purpose and entry.** Show historical/current/future daily min/max and weather; TodayWeather startup option `"1"`.

**Visible structure.** Shared hero and header; weekday/day labels; morning/afternoon icons, rain probability/amount, vertical min/max ranges with current marker; optional daily air outlook and detailed day cards.

**Data.** `dayChart[0]` carries `values`, current `temp`, and a display bitmask. Rows include `date`, `dayOfWeek`, `fromToday`, `tmn`, `tmx`, `skyAm`, `skyPm` and optional precipitation/air/life fields. `currentWeather.today.index` connects the hero/current day with detail rows. Unlike the hourly series, `values` contains day objects directly, not `{name,value}` wrappers.

**Actions/states and checks.** Horizontal scrolling, city switching, refresh, share and notification behavior follows the shared weather shell. Verify yesterday/today/tomorrow lookup, min/max order, missing morning/afternoon icons, day boundary labels and optional cards. A missing field must not silently become a meteorological zero.

Sources: [ForecastCtrl](../../client/www/js/controller.forecastctrl.js), [daily template](../../client/www/templates/tab-dailyforecast.html), [normalizer](../../client/www/js/service.weatherutil.js).

## S05 — Air detail

**Purpose and entry.** Inspect a selected air-quality index/pollutant and station. `code` chooses the main pollutant; `fav` selects the city. Default is AQI.

**Visible structure.** Large grade/value and action guide, current-weather shortcut, colored threshold ruler, hourly bar chart, daily outlook, pollutant selector cards, observation/forecast time/source, station alternatives when supplied.

**Data contract.** Prefer `city.airInfoList[stnIndex]`, then `city.airInfo`. `last` is the current station record, falling back to `currentWeather.arpltn`. It supplies `dataTime`, station name and `<code>Value/Grade/Str/ActionGuide`. `pollutants[code].hourly[]` uses `{date,val,grade,str}`; daily rows include date, relative day and grade/text. The controller builds a 24-slot series around the first hourly timestamp at or after `last.dataTime`. `WeatherUtil.aqiStandard[Units.airUnit]` supplies thresholds and colors.

**Actions/states and checks.** Change pollutant or station, open units, switch to weather, refresh. Missing air data can fail inside a caught controller path rather than a polished empty state. Cover no station, no matching hourly timestamp, missing pollutant, true zero, multiple stations, incompatible air standards and stale station time. Grade text/color is distinct from numeric concentration.

Sources: [AirCtrl](../../client/www/js/controller.air.js), [template](../../client/www/templates/tab-air.html), [air standards](../../client/www/js/service.weatherutil.js).

## S06 — Side menu and settings entry

**Purpose.** Navigate secondary features and global preferences. It lives in `index.html`, not a route of its own.

**Items.** KR-only weather warnings/national weather/national air as conditioned by product/region, external wind map, units, startup page, update interval, theme, purchase when available, feedback, store review, version and about. Some items open native/external destinations; they are not additional Angular pages. The guide menu item is present but disabled with `ng-if="false"`.

**State and checks.** Values come from `settingsInfo`, product/region, app version and purchase capability. Opening a generic settings page populates `radioList` before navigation. Verify product/region visibility and close/navigation behavior; test external actions separately with native adapters.

Sources: [SettingCtrl](../../client/www/js/controller.settingctrl.js), [index template](../../client/www/index.html).

## S07 — Unit overview

**Purpose.** Display current temperature, wind, pressure, distance, precipitation and air-standard settings. Selecting a row opens S08.

**Data/actions.** `Units` exposes current values and supported choices. Labels and display text are translated independently from wire values such as `C`, `m/s`, `hPa`, `km`, `mm` and `airkorea`.

**Rewrite checks.** Current selection survives restart; every displayed setting affects the appropriate request/query and presentation exactly once. A new units model must retain raw/wire identity separately from translated labels. Changing settings also invalidates city freshness and may synchronize push-unit settings.

Sources: [UnitsCtrl and Units service](../../client/www/js/controller.units.js), [template](../../client/www/templates/units.html).

## S08 — Radio choices: units, startup, refresh, theme

**Purpose.** Reuse one screen for several preference families. It requires a populated `radioList` service; directly navigating to its URL is not a complete entry contract.

| Family | Existing choices and effect |
| --- | --- |
| Units | `Units.getSelectList(type)`; save units, update push settings; air-unit changes emit an event |
| Startup | TodayWeather `0/1/2/3` (hourly/daily/favorites/air); TodayAir `3/4/2` (air/weather/favorites) |
| Refresh interval | `0/30/60/180/360/720`; labels and scheduling logic use this stored value |
| Theme | TodayWeather photo/light/dark/old; TodayAir light/dark; updates image paths and native status-bar style if available |

Selecting an item persists it immediately. `RadioCtrl.valueChanged` resets city load times and broadcasts reload; Back is navigation, not a Cancel transaction. Do not silently change this persistence behavior during rewrite.

Sources: [RadioCtrl/radioList](../../client/www/js/controller.setting.radio.js), [SettingCtrl](../../client/www/js/controller.settingctrl.js), [template](../../client/www/templates/setting-radio.html).

## S09 — City notification settings

**Purpose.** Configure weather alerts over a time window and scheduled daily alarms for one city.

**Visible structure.** Alert enable toggle, range slider, alarm weekday choices, existing times, add-time action, Cancel/Save. The time picker is a modal interaction inside this screen. With no stored settings, source initializes a 7–22 alert window, weekday defaults and initial alarm times; these are default UI values, not proof of backend registration.

**Data/actions.** `Push.getPushListByCityIndex` supplies alert/alarm records. City index, record IDs, date/time values, weekday booleans and enabled state are significant. Save builds/updates notification settings through `Push`; Cancel/back handles pending edits. Permission/token/provider state is a separate layer from visible form state.

**Capture limitation and rewrite checks.** The form renders with Firebase absent; no settings were submitted and no delivery was tested. Verify midnight/overnight windows, index/ID zero, duplicate alarms, weekdays/timezone, unsaved exit, token unavailable/rotation, partial batch persistence failure and server/device confirmation separately.

Sources: [PushCtrl](../../client/www/js/controller.push.js), [template](../../client/www/templates/setting-push.html), [Push service](../../client/www/js/service.push.js), [notification architecture](../architecture/push-notifications.md).

## S10 — Nationwide weather

**Purpose.** Compare fixed Korean cities on a map. Menu visibility is region/product dependent; this is not a general interactive world map.

**Data/layout.** `getNationWeather(Util.region)` returns an object whose `weather` array is used. Each city lookup searches the concatenated region/city/town names. The controller contains fixed map positions. Current records supply `skyIcon`, `t1h`, `rn1`, `wdd` and `wsd` for weather/temperature, precipitation and wind modes.

**Actions/states and checks.** Switch among three modes. Loading is shown; errors are logged and loading is hidden, without a detailed page-specific recovery panel. Verify missing cities, long names, correct unit labels, small-height scrolling and every map mode. Map captures are synthetic and carry no live forecast claim.

Sources: [NationCtrl](../../client/www/js/controller.nation.js), [template](../../client/www/templates/nation.html).

## S11 — Nationwide air

**Purpose.** Compare regional pollutant values. The top strip selects PM2.5, PM10, O3, NO2, SO2 or CO; overflow of the strip is intentional.

**Data/layout.** Reads the same nation endpoint's `air` array, matching `sidoName`. `<code>Value` and `<code>Grade` populate labels/colors; display selector `pm2.5` maps to field prefix `pm25`. Threshold colors depend on selected air unit. Map positions are fixed, not derived geographic coordinates.

**Rewrite checks.** Missing regional values, zero, pollutant field mapping, thresholds, label collisions, strip/map scrolling and request failure. The capture's identical values are deliberately synthetic.

Sources: [NationAirCtrl](../../client/www/js/controller.nation.air.js), [template](../../client/www/templates/nation-air.html).

## S12 — Weather warnings/bulletins

**Purpose.** Show published KMA bulletin content.

**Data/layout.** `GET /v000903/kma/special` with a 3-second timeout returns a list. Rows use `name`, `announcement`, optional `imageUrl`, `situationList[].weatherStr/levelStr/info[].timeStr/location`, `type` and `comment`. The client localizes announcement date/time and replaces comment newlines with `<br>` before `ng-bind-html` presentation.

**States/checks.** Empty list and request error differ; the controller sets `$scope.error`, but the current template has no dedicated error block. Preserve/decide content sanitization, timezone, long bulletin wrapping and image failure behavior. The screenshot explicitly says the warning is synthetic and omits the optional image.

Sources: [KmaSpecialCtrl](../../client/www/js/controller.kma.special.js), [template](../../client/www/templates/kma-special.html).

## S13 — Ad removal/purchase

**Purpose.** Present product entitlement, purchase/restore actions or premium expiration.

**Data/states.** Product title/description/price come from the platform purchase plugin; account level and receipt/expiration state interact with persisted purchase data and validation. Free, plugin-unavailable, product-loading, premium and renewal states are distinct. Product/platform builds select different purchase controllers and plugins.

**Capture and checks.** Captured plugin-unavailable presentation only: the normal menu may hide the entry, and direct route access does not establish a working purchase flow. No fabricated store price or transaction is shown. Rewriting needs real store sandbox tests for purchase, cancellation, restore, receipt failure, expiry and entitlement synchronization.

Sources: [current Purchase service/controller](../../client/www/js/controller.purchase.js), [template](../../client/www/templates/purchase.html), [variant build selection](../../client/gulpfile.js).

## S14 — Legacy guide

**Purpose.** Older slide-based onboarding/help with image pages and skip/back/close actions. The state still exists, while its current menu item is disabled.

**Data and checks.** Local guide images vary by platform/language. Some slides describe old UI behavior and must not be treated as the authoritative current design. Capture records the present route; decide whether to retain, update or remove it during rewrite.

Sources: [GuideCtrl](../../client/www/js/controller.guidectrl.js), [template](../../client/www/templates/guide.html), [disabled menu entry](../../client/www/index.html).

## S15–S16 — TodayAir product differences

TodayAir is selected through `clientConfig.package="todayAir"`; the same Angular application registers a different tab arrangement and `tab.weather`. Its combined weather template contains hourly and daily material, while the primary air screen reuses S05. Saved-city cards emphasize AQI, default startup is air, theme choices are light/dark, and purchase/plugin behavior differs by variant.

The two TodayAir captures switch only the staged product configuration and startup preference, preserving the shared current source and synthetic fixture. They do not prove TodayAir release resources, native bundle configuration or store integration.

Sources: [product registration](../../client/www/js/app.js), [TodayAir tabs](../../client/www/templates/ta-tabs.html), [combined weather](../../client/www/templates/ta-tab-weather.html), [product build](../../client/gulpfile.js).

## Cross-screen states to implement and verify during rewrite

These are required review cases, not claims that all existing states are polished or captured:

| State | Existing mechanism / rewrite concern |
| --- | --- |
| First launch | Native preference restoration, settings defaults, disabled current-position slot and startVersion gate |
| Loading/refresh | `$ionicLoading`, per-city loading indication, ten-minute memory gate and separate overlapping HTTP timers |
| Failure/retry | Shared alert/confirm paths; retained cached city; not every secondary page visibly renders errors |
| Missing/partial data | Truthy merge may retain old sections; absent, null, sentinel and zero must remain distinct |
| Permission/SDK unavailable | Location diagnostic, Google Places, Firebase, purchase and sharing have separate fallback paths |
| Settings change | Unit/theme/startup/refresh changes persist and trigger different events; avoid stale unit/value combinations |
| Resume/rapid navigation | Refresh and location updates can overlap; bind responses to the initiating city in any intentional fix |
| Update/permission dialogs | Existing modal overlays may cover otherwise correct screens; capture and test separately from layout |
| Accessibility/keyboard | Not covered by these captures; add Dynamic Type/text size, VoiceOver, keyboard, focus and long translations |

Use [verification matrix](verification-matrix.md) for proposed acceptance cases and [decision ledger](decisions-and-open-questions.md) for behavior changes that need an explicit migration decision.
