# Screen specifications

Baseline: `bd6640f2` (re-baselined 2026-09-25; client source identical to `ff7acf3996ccb66c912d2ed4710cf300197d6966`, on which this was inspected 2026-09-23 and extended 2026-09-24 and 2026-09-25). Screenshots keep their original capture dates and `ff7acf39` commit, and remain valid because nothing under `client/` changed. Server-side changes that reach these screens are in the [re-baseline summary](README.md#re-baselined-to-bd6640f2); the main one is that KMA daily rows can now skip dates (D51). This describes the existing application, not a proposed redesign. Screen IDs are documentation identifiers, not production route IDs. Repository prose is English; most captures show the Korean UI, and en-US captures exist for S01, S06 and S07.

Screenshots use current `client/www` JS/templates/assets and compiled current SCSS in an isolated iOS WKWebView. Weather, air, national summaries, warnings and the photo-theme feed are **synthetic fixtures**, not real observations. Cordova readiness is simulated; native plugins, release credentials and external provider access are absent. See [capture provenance](screenshots/README.md), [data contracts](client-data-contracts.md), and [state behavior](client-state-and-behavior.md). A screenshot proves a rendered state, not an entire user journey or API integration.

Two companion documents cover what this page does not repeat:

- [Overlays, dialogs and loading states](screen-overlays.md): popups, alerts, loading indicators and native hand-offs with `O` IDs, for example the zero-city start choice, retry confirms, update information, the About alert and the Android exit confirm.
- [Element bindings](screen-element-bindings.md): per-region tables for S02–S05 and S15–S16. Each row gives the template expression, the normalized field, the visibility rule, the action and the `LOC_` key.

## Navigation and coverage

The route registry is in [app.js](../../client/www/js/app.js). `tab` is an abstract container, and its template depends on product and platform ([app.js](../../client/www/js/app.js#L1881-L1896)):

- TodayWeather on iOS uses `tabs.html`: favorites, hourly, daily and air tabs.
- TodayWeather on Android uses `tabs-android.html`: the same tabs with Android glyphs.
- TodayAir uses `ta-tabs.html` on every platform: favorites, air and combined weather tabs.

See [Product and platform differences](#product-and-platform-differences). A selected weather/air tab also acts as refresh through `doTabForecast`, so changing tabs and refreshing are not identical actions. The favorites tab is a plain `href` and never calls `doTabForecast`.

| ID | Screen / route | Implementation | Capture |
| --- | --- | --- | --- |
| S01 | Initial location selection `/start` | `StartCtrl`, `start.html` | [Large](screenshots/tw-start.png), [compact](screenshots/tw-start-compact.png), [en-US](screenshots/tw-start-en-us.png) |
| S02 | Saved locations/search `/tab/search` | `SearchCtrl`, `tab-search.html` | [Favorites](screenshots/tw-favorites.png), [searching](screenshots/tw-favorites-search.png), [editing](screenshots/tw-favorites-editing.png), [TodayAir](screenshots/ta-favorites.png) |
| S03 | Hourly weather `/tab/forecast?fav` | `ForecastCtrl`, `tab-forecast.html` | [Large](screenshots/tw-hourly.png), [compact](screenshots/tw-hourly-compact.png), [dark](screenshots/tw-theme-dark-hourly.png), [old](screenshots/tw-theme-old-hourly.png), [photo](screenshots/tw-theme-photo-hourly.png), [Ionic Android mode](screenshots/tw-android-mode-hourly.png), [iPad portrait](screenshots/tw-ipad-hourly.png) |
| S04 | Daily weather `/tab/dailyforecast?fav` | `ForecastCtrl`, `tab-dailyforecast.html` | [Large](screenshots/tw-daily.png), [compact](screenshots/tw-daily-compact.png), [iPad portrait](screenshots/tw-ipad-daily.png) |
| S05 | Air detail `/tab/air?fav&code` | `AirCtrl`, `tab-air.html` | [Air](screenshots/tw-air.png) |
| S06 | Side menu/settings, no separate state | `SettingCtrl`, `index.html` | [Menu](screenshots/tw-menu.png), [en-US](screenshots/tw-menu-en-us.png), [Ionic Android mode](screenshots/tw-android-mode-menu.png) |
| S07 | Unit overview `/units` | `UnitsCtrl`, `units.html` | [Units](screenshots/tw-units.png), [en-US defaults](screenshots/tw-units-en-us.png) |
| S08 | Generic radio choice `/setting-radio` | `RadioCtrl`, `setting-radio.html` | [Temperature](screenshots/tw-temperature-unit.png), [theme](screenshots/tw-theme.png) |
| S09 | City notifications `/setting-push?fav` | `PushCtrl`, `setting-push.html` | [Settings](screenshots/tw-push-settings.png) |
| S10 | Nationwide weather `/nation` | `NationCtrl`, `nation.html` | [Weather map](screenshots/tw-nation.png), [precipitation](screenshots/tw-nation-rain.png), [wind](screenshots/tw-nation-wind.png) |
| S11 | Nationwide air `/nation-air` | `NationAirCtrl`, `nation-air.html` | [Air map](screenshots/tw-nation-air.png) |
| S12 | Weather bulletins `/kma-special` | `KmaSpecialCtrl`, `kma-special.html` | [Synthetic bulletin](screenshots/tw-warning.png) |
| S13 | Purchase/ad removal `/purchase` | `PurchaseCtrl`, `purchase.html` | [Plugin unavailable](screenshots/tw-purchase-unavailable.png) |
| S14 | Legacy guide `/guide` | `GuideCtrl`, `guide.html` | [Guide](screenshots/tw-guide.png) |
| S15 | TodayAir combined weather `/tab/weather?fav` | `ForecastCtrl`, `ta-tab-weather.html` | [TodayAir weather](screenshots/ta-weather.png) |
| S16 | TodayAir primary air view `/tab/air` | `AirCtrl`, `tab-air.html`, `ta-tabs.html` | [TodayAir air](screenshots/ta-air.png), [dark](screenshots/ta-theme-dark-air.png) |

All routed screens above have a capture; S06 is the non-routed side menu. The 2026-09-23 captures are Korean with the light theme. The 2026-09-24 captures add these states: favorites search/edit, TodayAir favorites, national map modes, dark/old/photo themes, en-US locale/region and Ionic Android platform mode. The 2026-09-25 captures add S03 and S04 on an iPad in portrait ([Device classes and orientation](#device-classes-and-orientation)); every other capture is an iPhone in portrait. For each capture from 2026-09-24 on, the [manifest](screenshots/manifest.json) records the `trigger` that produced the state, plus `notes`. Overlay, dialog and loading-state captures (`O` IDs) are defined in [screen-overlays.md](screen-overlays.md). No capture comes from an Android device or Android WebView. No capture shows a TodayAir iOS purchase page with a loaded store product. Native widget/watch surfaces are separate applications and are outside this screenshot set. The purchase capture is deliberately the plugin-unavailable state, not a simulated successful store purchase.

## Shared presentation and data rules

- `WeatherInfo` owns the selected city and normalized weather; controllers select subsets for templates. HTTP payloads are not bound directly to every screen. `Units` is separate global state, and icon paths come from `window.theme`.
- City index zero represents the current-position slot and may be disabled. `fav` parameters can select a stored city. A disabled current-position slot is not an ordinary empty favorite.
- Forecast/air pages inherit layout, refresh, sharing and menu behavior from `TabCtrl`. `applyEvent`, `reloadEvent`, resume and settings events coordinate updates. See [TabCtrl](../../client/www/js/controller.tabctrl.js).
  - The header location glyph is a `location_on`/`location_off` material icon. It appears when the selected city is the current-position city and no refresh is in progress ([template](../../client/www/templates/tab-forecast.html#L5-L12)).
  - Only `ForecastCtrl.switchToLocationSettings` handles taps on it, so it works on S03, S04 and S15 ([ForecastCtrl](../../client/www/js/controller.forecastctrl.js#L658-L674)). The handler acts only when `Util.isLocationEnabled()` is false: Android opens device location settings and iOS opens the app's settings page. `WeatherInfo.reloadCity` then clears the city's `loadTime` without fetching. With location on, a tap only records analytics.
  - `tab-air.html` binds the same handler, but neither `AirCtrl` nor `TabCtrl` defines it, so the glyph does nothing on S05/S16 (anomaly).
- Text comes from [locales](../../client/www/locales); weather condition/summary strings may already arrive from the server. Preserve the distinction between localization keys and server prose. Language and region rules are in [Locale and region](#locale-and-region).
- Horizontal forecast overflow is intentional. Page-wide overflow, clipped controls, missing fonts or hidden navigation titles are not acceptable rewrite outcomes. The [full-screen baseline](screenshots/baseline-unsafe-area.png) hides the city title under Dynamic Island; native safe-area hosting avoids this in the harness. Real Cordova status-bar/safe-area behavior remains unverified.
- Most pages assume partial cached data can exist. Define loading, stale, missing, offline and error states explicitly during rewrite; do not infer an empty-state design from a successful screenshot.

### Advertising surface

For free accounts, a native AdMob banner sits outside the web content. No capture includes it ([capture limits](screenshots/README.md)).

| Aspect | Current behavior | Source |
| --- | --- | --- |
| Placement and size | `admobPro` sets `position: BOTTOM_CENTER`, `overlap: false` and `autoShow: true`. Its plugin, `cordova-plugin-admobpro-firebase`, is listed in both product package files. The size is `SMART_BANNER` on iOS and `BANNER` on Android. The alternative `admobClean` adapter is used only when `window.admob` exists; it sets `bannerAtTop: false` and `overlap: false`. `overlap:false` asks the plugin not to draw over the web view (plugin semantics, not captured). A rewrite therefore has to reserve or resize for a bottom strip on free accounts. | [admobPro](../../client/www/js/service.admobpro.js#L25-L45), [admobClean](../../client/www/js/service.admobclean.js#L21-L40) |
| Units and lifecycle | `TwAds.init()` runs from `TabCtrl.init`. Banner units come from the configuration names `admobIOSBannerAdUnit` and `admobAndroidBannerAdUnit`. The banner is created once an adapter reports ready. On orientation change the banner is destroyed and recreated while ads are enabled. Interstitial units are passed as configuration only; no code shows an interstitial. | [TwAds](../../client/www/js/service.twads.js#L140-L185), [TabCtrl](../../client/www/js/controller.tabctrl.js#L63) |
| Entitlement | Stored `twAdsInfo.enable` controls ads, and the default is enabled when the value is absent. `Purchase` maps entitlement to ads: `clientConfig.isPaidApp` sets level `paid` with ads disabled, `free` enables ads and `premium` disables them. `setShowAds(true)` is refused while ads are disabled. | [TwAds](../../client/www/js/service.twads.js#L16-L35), [show gate](../../client/www/js/service.twads.js#L102-L123), [Purchase](../../client/www/js/controller.purchase.js#L19-L39) |
| Screens without the banner | S01 hides it on init and re-shows it in `close()` only for free accounts. S14 hides it on init/enter and re-shows it on leave only for free accounts. S13 hides it on init/enter and re-shows it on leave/close unless the level is premium; `TwAds` refuses the re-show anyway while ads are disabled. Every other screen keeps the banner. | [StartCtrl](../../client/www/js/controller.start.js#L65-L72), [close](../../client/www/js/controller.start.js#L129-L131), [GuideCtrl](../../client/www/js/controller.guidectrl.js#L173-L180), [PurchaseCtrl](../../client/www/js/controller.purchase.js#L183-L211) |

### Theme variants

The theme is `settingsInfo.theme`. The default is `light` for both products ([defaults](../../client/www/js/service.storage.js#L201-L214)), and saved settings without a theme migrate to `light` ([migration](../../client/www/js/service.storage.js#L154-L167)). TodayWeather offers `photo`, `light`, `dark` and `old`; TodayAir offers `light` and `dark` ([SettingCtrl](../../client/www/js/controller.settingctrl.js#L174-L185)). S08 persists a selection immediately.

| Theme | Icons / weather images | Header and tab bar ([SCSS](../../client/scss/ionic.app.scss)) | iOS status bar |
| --- | --- | --- | --- |
| `light` | `img/icons_default` / `img/weather_default` | White bars with black text | `styleDefault` |
| `dark` | `img/icons_dark` / `img/weather_default` | `#1b1b1b` bars and tab bar. Dark backgrounds on hourly, daily, air (including TodayAir weather, whose state class is `forecast`), search, push, menu and settings | `styleLightContent` |
| `old` (TodayWeather) | `img/icons_old` / `img/weather_old` | `#444` bars; hourly header and tab bar `#03a9f4`, daily `#00bcd4` | `styleLightContent` |
| `photo` (TodayWeather) | `img/icons_default` / `img/weather_default` | Hourly and daily headers transparent over the hero photo, with outlined white text (the daily rule is `.photo-theme.dailyforecast .menu-content .bar`). Other pages use `#444` bars; the tab bar is white | `styleLightContent` |

How themes are applied:

- `<body ng-class="[package, settingsInfo.theme+'-theme']">` ([index.html](../../client/www/index.html#L73)) sets the theme class.
- A state class comes from `$rootScope.state` ([app.js](../../client/www/js/app.js#L295-L322)). The values are `search`, `forecast` (also used by TodayAir `tab.weather`), `dailyforecast`, `air`, `start`, `setting` and `push`; national maps, bulletins, guide and purchase get none.
- SCSS scopes rules by `<theme>-theme.<state>`.
- Image paths are `$rootScope.iconsImgPath` and `weatherImgPath` from [`window.theme`](../../client/www/data/theme.js). They are set at startup ([app.js](../../client/www/js/app.js#L329-L330)) and on theme change ([radioList.setValue](../../client/www/js/controller.setting.radio.js#L41-L58)).
- Theme-dependent status-bar calls run only on iOS when the `StatusBar` plugin exists ([app.js](../../client/www/js/app.js#L286-L292)). Separately, the config block calls `StatusBar.styleLightContent()` on iOS and `StatusBar.backgroundColorByHexString('#111')` on other platforms when `window.StatusBar` exists ([app.js](../../client/www/js/app.js#L1962-L1969)); Angular is bootstrapped on `deviceready`, and `cordova-plugin-statusbar` is in both product package files (source-level).

Captures: [dark hourly](screenshots/tw-theme-dark-hourly.png), [old hourly](screenshots/tw-theme-old-hourly.png), [photo hourly](screenshots/tw-theme-photo-hourly.png), [TodayAir dark air](screenshots/ta-theme-dark-air.png). They were made by persisting the theme and reloading the document; the live switch from S08 was not captured.

**Header refresh spinner (anomaly).** Weather/air tab screens signal a refresh only through the header `ion-spinner` (`showLoadingIndicator`, [TabCtrl](../../client/www/js/controller.tabctrl.js#L1019-L1025)). While it is shown, the location glyph is hidden.

- `.body-content .bar p svg` forces `fill`/`stroke` to `#fff` ([SCSS](../../client/scss/ionic.app.scss#L170-L181)), and the light-theme header background is `#fff` ([SCSS](../../client/scss/ionic.app.scss#L103-L115)). In the default light theme the spinner is therefore rendered but invisible, and only the title shifts to make room.
- Compare the [light](screenshots/tw-loading-header-spinner-light.png) and [dark](screenshots/tw-loading-header-spinner-dark.png) captures. The old-theme headers and the photo-theme air header are not white (source-level). The photo-theme hourly/daily headers are transparent over the hero, whose `[md-page-header]` background stays `#fff`, so the spinner there stays white on white until a photo has loaded (source-level).
- Loading-state definitions: O17 in [screen-overlays.md](screen-overlays.md).

**Photo theme hero (TodayWeather hourly/daily).**

1. **Feed.** The feed URL is `clientConfig.weatherPhotosUrl`, fetched with a 20-second timeout. It is empty in the checked-in [client.config.js](../../client/www/client.config.js#L25), and the deployed value is unverified. Entries are `{tags:[...], twUrls:{regular}}` ([synthetic example](examples/weather-photos-feed.json)), and entries without a `tags` array are skipped. The joined tags pick a bucket in this order: lightning, rain, snow, sun (with `_smallcloud`/`_bigcloud` variants), moon (same variants), cloud ([WeatherUtil](../../client/www/js/service.weatherutil.js#L925-L993)).
2. **Loading.** The feed loads at startup (`loadCities`), on a city add/update while no feed is loaded, and on the `online` event. Once `window.weatherPhotos` is set, later calls return immediately, so a session never refreshes the feed. After the first successful load, every city whose `photo` is null gets one, and `loadWeatherPhotosEvent` is broadcast ([WeatherInfo](../../client/www/js/service.weatherinfo.js#L278-L297)).
3. **Selection (anomaly).** `findWeatherPhoto` walks the keys in that fixed order. It uses the first key that is a substring of `skyIcon` and has a non-empty bucket, and returns `photos[Math.floor(Math.random()*(length-1))].twUrls.regular` ([WeatherUtil](../../client/www/js/service.weatherutil.js#L995-L1012)).
   - In a bucket of two or more photos it never picks the last one; a two-photo bucket returned index 0 in 200/200 draws in the [probe](../../reports/rewrite-verification/probes/weather-photo-selection.json) (synthetic execution).
   - An empty bucket falls through to later keys that also match; in the probe, `sun_smallcloud` with an empty bucket returned a `sun` photo.
   - No match returns null.
4. **Persistence.** The URL is stored in `city.photo` whenever the city is added or updated, whatever the theme ([add](../../client/www/js/service.weatherinfo.js#L158), [update](../../client/www/js/service.weatherinfo.js#L273)).
5. **Rendering.**
   - `ForecastCtrl` passes `city.photo` to the template only when the theme is `photo` ([apply](../../client/www/js/controller.forecastctrl.js#L362-L364), [photo event](../../client/www/js/controller.forecastctrl.js#L686-L699)).
   - The `photo-url` directive preloads the image ([app.js](../../client/www/js/app.js#L1796-L1819)). On success it draws `linear-gradient(to bottom, rgba(0,0,0,0.3) 95%, rgba(255,255,255,0.9))` over the photo. On a load error it shows `img/bg.png`; with no URL it sets no background. `.photo-box` covers the hero at 80% opacity.
   - Only in the photo theme, `bar-scrolled` paints the header with an `rgba(68,68,68,…)` gradient after 44 px of scroll, reaching full opacity at 132 px. Each state change clears it ([directive](../../client/www/js/app.js#L1765-L1794), [reset](../../client/www/js/app.js#L295-L300)).
6. **Scope.** Only `tab-forecast.html` and `tab-dailyforecast.html` use `photo-url`. `ta-tab-weather.html` has an inline photo binding, but TodayAir does not offer the photo theme.

### Locale and region

Two independent inputs drive locale behavior:

- **UI text** comes from angular-translate with the static files `locales/<lang>.json` ([app.js](../../client/www/js/app.js#L422-L439)).
  - There are six languages: `en`, `de`, `ko`, `ja`, `zh-CN` and `zh-TW`, with 327 keys each at the baseline.
  - The mapping is `en_*` → `en`, `de_*` → `de`, `ko_*` → `ko`, `ja_*` → `ja`, `zh_HK`/`zh_TW` → `zh-TW` and other `zh_*` → `zh-CN`.
  - The preferred and fallback language is `en`; `determinePreferredLanguage()` reads the WebView locale.
- **`Util.language`** is the raw `navigator.userLanguage || navigator.language` ([app.js](../../client/www/js/app.js#L129)).
- **`Util.region`** comes from one of two paths ([app.js](../../client/www/js/app.js#L130-L155)):
  - When `navigator.globalization` exists, it is the last `-` segment of the asynchronous `getLocaleName()` result (for example `ko-Kore-KR` → `KR`). Release builds include `cordova-plugin-globalization` in both product package files. On error the region stays undefined, which hides every KR-only item.
  - Without the plugin, it is the last segment of the first `navigator.languages` entry that contains `-`, otherwise `KR`.

| Gate | Condition | Effect | Source |
| --- | --- | --- | --- |
| Special weather (S12), national air (S11), wind map | `Util.region === 'KR'` | Menu item shown | [index.html](../../client/www/index.html#L96-L111) |
| National weather (S10) | Region `KR` and product TodayWeather | Menu item shown | [index.html](../../client/www/index.html#L100) |
| Unit defaults | Region | See [client data contracts](client-data-contracts.md#units-query-strings-and-headers) | [Units](../../client/www/js/controller.units.js) |
| National map request | Region | `getNationWeather(Util.region)`. `getNationName` has JP/CN/US/GB branches (JP returns `LOC_CHINA`, anomaly), but the menu exposes S10/S11 only for KR | [NationCtrl](../../client/www/js/controller.nation.js#L17-L33), [request](../../client/www/js/controller.nation.js#L161) |
| About | `Util.language` contains `ko` | Menu item; opens the attribution alert described in S06 | [SettingCtrl](../../client/www/js/controller.settingctrl.js#L63-L91) |
| Share link | `Util.language` contains `ko` | Korean or non-Korean Branch link per product | [TabCtrl](../../client/www/js/controller.tabctrl.js#L239-L258) |
| Current-position label (S02) | Language contains `ko`, `ja` or `zh-CN` (the Traditional Chinese check is misspelled `zh-TU`) | `LOC_CURRENT`+`LOC_LOCATION` without a space; with a space otherwise | [SearchCtrl](../../client/www/js/controller.searchctrl.js#L115-L127) |
| Update-information text | `Util.language` before the first `-` | Matching entry, else the first entry | [TabCtrl](../../client/www/js/controller.tabctrl.js#L817-L829) |
| Push registration | Raw `Util.language` | `Accept-Language` request header | [Push](../../client/www/js/service.push.js#L244) |

en-US captures: [start](screenshots/tw-start-en-us.png), [menu](screenshots/tw-menu-en-us.png) with no KR-only items and no About, and [units](screenshots/tw-units-en-us.png) with US defaults. The harness overrides `navigator.language`/`navigator.languages`, so the region came from `navigator.languages`, not from the globalization plugin.

### Product and platform differences

The gulp file has build tasks for all four combinations ([gulpfile](../../client/gulpfile.js)):

- TodayWeather iOS: `build_tw_ios`, `release-tw-ios-nonpaid`.
- TodayWeather Android: `build_tw_android`, `release-tw-android-min20-nonpaid`, `release-tw-android-min16-nonpaid`.
- TodayAir iOS: `build_ta_ios`, `release-ta-ios-nonpaid`.
- TodayAir Android: `build_ta_android`, `release-ta-android-nonpaid`.

Template platform checks use `isAndroid()`/`isIOS()`, not the product. TodayAir Android therefore gets Android header glyphs with iOS-style tab icons.

| Aspect | iOS | Android | Source |
| --- | --- | --- | --- |
| Tab template and icons | TodayWeather: `tabs.html` with `ion-ios-star`, `ion-ios-clock-outline`, `ion-ios-calendar-outline` and `ion-ios-cloud-outline`; a selected weather/air tab shows `ion-ios-reload`. TodayAir: `ta-tabs.html` (favorites, air, weather) with `ion-ios-*` icons | TodayWeather: `tabs-android.html` with `ion-android-star`, `ion-android-time`, `ion-calendar` and `ion-android-cloud-outline`; a selected weather/air tab shows `ion-android-refresh`. TodayAir: the same `ta-tabs.html` with `ion-ios-*` icons | [app.js](../../client/www/js/app.js#L1881-L1896), [tabs](../../client/www/templates/tabs.html), [Android tabs](../../client/www/templates/tabs-android.html), [TodayAir tabs](../../client/www/templates/ta-tabs.html) |
| Header bell/share (S03–S05, S15, S16) | `ion-ios-bell`/`-outline`, `ion-ios-upload-outline` | `ion-android-notifications`/`-none`, `ion-android-share-alt` (both products) | [hourly header](../../client/www/templates/tab-forecast.html#L13-L32); same in the daily, air and TodayAir weather templates |
| S02 row bell | `ion-android-notifications`/`-none` on both platforms | Same | [template](../../client/www/templates/tab-search.html#L61-L63) |
| Back icons | `ion-ios-arrow-back` in the menu header and on S07–S13 | `ion-android-arrow-back` | [index.html](../../client/www/index.html#L88-L91), for example [units](../../client/www/templates/units.html) |
| Menu chevrons | Shown | Hidden on Units, Remove ads, Send feedback, Rate, the disabled Guide and About; KR-only items keep their chevrons | [index.html](../../client/www/index.html#L112-L151) |
| Hardware back | Not applicable | Registered in `TabCtrl.init`. On `/tab/search`, `/tab/forecast`, `/tab/dailyforecast`, `/tab/air` and `/tab/weather` it opens an exit confirm (`LOC_DO_YOU_WANT_TO_EXIT`; Cancel, or OK → `ionic.Platform.exitApp()`). Elsewhere it calls `$ionicHistory.goBack()`. Dialog: O15 in [screen-overlays.md](screen-overlays.md) | [TabCtrl](../../client/www/js/controller.tabctrl.js#L34-L60) |
| Location settings | The location-off Settings button and the header glyph open the app's settings page | Same controls open device location settings. The `DENIED_ALWAYS` retry variant adds `LOC_OPENS_THE_APP_INFO_PAGE` and a Settings button. Dialog details: O03 in [screen-overlays.md](screen-overlays.md) | [TabCtrl](../../client/www/js/controller.tabctrl.js#L449-L525), [ForecastCtrl](../../client/www/js/controller.forecastctrl.js#L658-L674) |
| High-accuracy location request | `cordova.plugins.locationAccuracy.request` runs when location is off and the current-position city has no stored location. Only plugin presence gates it, and the plugin is in both package files | Same | [TabCtrl](../../client/www/js/controller.tabctrl.js#L1150-L1171) |
| System text size | No call | `MobileAccessibility.usePreferredTextZoom(false)` | [app.js](../../client/www/js/app.js#L255-L262) |
| Status bar | Style follows the theme | No theme-dependent call; the config block sets the background to `#111` once | [app.js](../../client/www/js/app.js#L286-L292), [config block](../../client/www/js/app.js#L1962-L1969) |
| S02 empty-list autofocus | None ("focus doesn't work on ios") | Input focused after 100 ms | [SearchCtrl](../../client/www/js/controller.searchctrl.js#L945-L957) |
| Purchase (S13) | `controller.purchase.alexdisler.js` with `cordova-plugin-inapppurchase`. TodayAir iOS only: a subscription disclosure (`LOC_CHARGED_TO_YOUR_ITUNES_ACCOUNT`, `LOC_AUTO_RENEWED_24_HOURS_BEFORE_EXPIRY_DATE`, `LOC_MANAGE_SUBSCRIPTIONS_FROM_ITUNES_ACCOUNT`) and a privacy/terms block, each shown only when a store product is loaded | `controller.purchase.j3k0.js` with `cc.fovea.cordova.purchase` | [gulpfile](../../client/gulpfile.js), [template](../../client/www/templates/purchase.html#L17-L49) |

Product-only differences, on both platforms:

- TodayAir themes are light/dark only, and its startup default is air.
- The TodayAir combined-weather expander uses template-local `ng-init` state and starts collapsed each time the view is created (`tab.weather` is not cached), while TodayWeather hourly persists `expandShortChart` ([TodayAir](../../client/www/templates/ta-tab-weather.html#L84-L89), [TodayWeather](../../client/www/js/controller.forecastctrl.js#L676-L679)).

The Ionic Android mode captures, [hourly](screenshots/tw-android-mode-hourly.png) and [menu](screenshots/tw-android-mode-menu.png), load `index.html?ionicplatform=android` inside the iOS WKWebView without Android plugins. They show the `tabs-android.html` icons, the Android header glyphs, the hidden chevrons and the Android back arrow. They do not show Android WebView rendering or fonts, hardware back, permission dialogs, plugins or the banner.

### Device classes and orientation

**Declared device families and orientations** (observed source; no release build was inspected):

- Both iOS app targets set `TARGETED_DEVICE_FAMILY = "1,2"` (iPhone and iPad) in Debug and Release, and so do the project-level configurations ([TodayWeather](../../tw.ios/TodayWeather.xcodeproj/project.pbxproj#L533), [TodayAir](../../ta.ios/TodayAir.xcodeproj/project.pbxproj#L537)). Gulp copies these native projects into `platforms/ios` ([native consumers §1](native-consumers-and-plugins.md#1-consumer-inventory)).
- Both app `Info.plist` files allow portrait and both landscape orientations on iPhone, add upside-down portrait on iPad (`~ipad`), and set `UIRequiresFullScreen` ([TodayWeather](../../tw.ios/TodayWeather/TodayWeather-Info.plist#L46-L60), [TodayAir](../../ta.ios/TodayAir/TodayAir-Info.plist#L46-L60)). Per Apple platform semantics (not verified here), the full-screen flag opts out of iPad Split View and Slide Over.
- No `config*.xml` variant sets an `Orientation` preference (`grep -i orientation client/*config*.xml` finds nothing). Whether a Cordova `prepare` rewrites the plist keys, and what the Android manifest declares, were not checked; the Android platform files are not in this checkout.

**Size rules.** `TabCtrl.initSize` ([L1352-L1398](../../client/www/js/controller.tabctrl.js#L1352-L1398)) computes the layout sizes. `ForecastCtrl.init` (S03, S04, S15) and `AirCtrl.init` (S05, S16) call it each time their controller initializes ([ForecastCtrl](../../client/www/js/controller.forecastctrl.js#L140-L149), [AirCtrl](../../client/www/js/controller.air.js#L338-L340)).

| Value | Rule |
| --- | --- |
| `bodyWidth`, `bodyHeight` | `window.screen.width`/`height`; fallbacks `innerWidth`/`innerHeight`, then `outerWidth`/`outerHeight`, then 360 × 640 |
| Header ratio | 2/5 below 600 px of height, 3/8 from 600 up to 840 px, 5/12 from 840 px |
| `headerHeight` | `max(bodyHeight × ratio, 192)`. It is the hero `min-height`: set on `[md-page-header]` by `ForecastCtrl.init` and bound in the templates ([tab-forecast.html](../../client/www/templates/tab-forecast.html#L37)) |
| `mainHeight` | `bodyHeight × (1 − ratio)`; nothing in `client/www` reads it |
| `bigFontSize` | `min(0.2 × bodyWidth, 0.9 × (headerHeight − 49 − 72, minus 20 more on iOS), 142.1)`. `bigImageSize` is 0.9 × that. The hero binds both once (`::`), so a later recomputation would not restyle an existing view ([tab-forecast.html](../../client/www/templates/tab-forecast.html#L44-L48); the same in the daily and TodayAir weather templates) |
| Chart column (`ForecastCtrl`) | `colWidth = min(bodyWidth / 7, 60)`. Hourly chart width is `colWidth × rows`. Daily chart width is `max(bodyWidth, colWidth × days)` ([L368-L369](../../client/www/js/controller.forecastctrl.js#L368-L369)). Chart heights add `2 × bigFontSize` (hourly) or `1.5 × bigFontSize` (daily) to the row-dependent height, capped at 300 ([L442-L457](../../client/www/js/controller.forecastctrl.js#L442-L457)) |

**Width and height branches.**

- **`tabletWidth` (640), daily chart.** When `bodyWidth >= 640`, the initial scroll is 0, so the chart starts at the first day. Narrower screens scroll so that today is the third column ([getTodayPosition](../../client/www/js/controller.forecastctrl.js#L533-L574)).
- **`tabletWidth`, hourly chart (anomaly).** The guard `$scope.timeChart[1].length*colWidth < $scope.tabletWidth` ([L518](../../client/www/js/controller.forecastctrl.js#L518)) is meant to skip scrolling when the chart fits. `timeChart[1]` is the `{name, values, currentIndex, displayItemCount}` object ([normalization](client-data-contracts.md#normalization-into-screen-state)) and has no `length`, so the comparison is `NaN < 640`, which is always false. Every device therefore scrolls the hourly chart to column `currentIndex − 1` (the expression was evaluated in Node against both normalized examples).
- **Below 360 px of width.** The daily AQI forecast is cut to four tiles on S03/S04 ([ForecastCtrl](../../client/www/js/controller.forecastctrl.js#L396-L402)) and S05/S16 ([AirCtrl](../../client/www/js/controller.air.js#L307-L313)).
- **S01 recommended cities.** A screen height of 568, 731 and 960 px or more extends the six-city base list to 11, 17 and 26 cities; the source comment calls the last step "tablet" ([StartCtrl](../../client/www/js/controller.start.js#L184-L198)). S14 derives its font sizes from the screen height in the same way ([GuideCtrl](../../client/www/js/controller.guidectrl.js#L38-L55)).

**Resize and rotation.** Nothing recomputes these values when the window resizes or the device rotates: `client/www/js` registers no `resize` listener. The only `orientationchange` handler destroys and recreates the ad banner while ads are enabled ([service.twads.js](../../client/www/js/service.twads.js#L175-L184)). A view therefore keeps the sizes of the orientation in which its controller initialized (source reading). Whether iOS WebKit reports rotated `window.screen` dimensions was not checked (platform behavior).

Computed with the extracted `initSize` for the `window.screen` sizes recorded in the capture diagnostics (synthetic execution in Node on 2026-09-25, iOS branch; not checked in as a probe):

| Capture device | `window.screen` | `headerHeight` | `bigFontSize` | `colWidth` | `>= tabletWidth` |
| --- | --- | --- | --- | --- | --- |
| iPhone 17 Pro ([diagnostic](../../reports/rewrite-verification/tw-hourly.json)) | 402 × 874 | 364.2 | 80.4 | 57.43 | No |
| iPad Pro 11-inch (M5), portrait ([diagnostic](../../reports/rewrite-verification/tw-ipad-hourly.json)) | 834 × 1210 | 504.2 | 142.1 (cap) | 60 | Yes |

The diagnostics agree with the column rule: the hourly chart scroll width is 1378 px on the iPhone and 1440 px on the iPad (24 columns), and the iPad daily chart is 900 px (15 columns).

**iPad captures** (2026-09-25, iPad Pro 11-inch (M5) / iOS 26.5, portrait, ko-KR, light theme, synthetic fixture): [hourly](screenshots/tw-ipad-hourly.png) and [daily](screenshots/tw-ipad-daily.png). They show a tall hero with the temperature at the 142.1 px cap, 60 px chart columns, an hourly chart scrolled past the earlier hours, a daily chart that starts at its first day with today in the eighth column, and 150 px tabs centred in the tab bar. Limits: portrait only, because the harness `Info.plist` allows only portrait, so landscape and rotation are not captured. The captures come from the WKWebView harness (safe-area hosting, hidden status bar), not from the app's own plist or multitasking settings. There is no banner, and no iPad capture of S05, S15, S16 or TodayAir. No Android tablet was captured.

## S01 — Initial location selection

**Purpose and entry.** Establish the first enabled city. `/start` is entered only by the startup gate, when saved `startVersion` is absent or older than `Util.startVersion` ([app.js](../../client/www/js/app.js#L352-L357)); no other code navigates to `/start`.

Later, if no city is enabled, the app does not return to `/start`. These paths open the zero-city start choice `startPopup` instead (O02 in [screen-overlays.md](screen-overlays.md)):

- `ForecastCtrl` screens: S03, S04, S15 ([ForecastCtrl](../../client/www/js/controller.forecastctrl.js#L168-L172)).
- Taps on a weather/air tab through `doTabForecast` ([TabCtrl](../../client/www/js/controller.tabctrl.js#L67-L77)).
- Share when the selected city has no location. Share needs the social-sharing plugin; without it, share returns silently.

The popup's two radio labels are bound to each other's actions. With the default `autoSearch=false`, the preselected "use current location" label leads to S02 ([probe](../../reports/rewrite-verification/probes/start-popup-choice.json), synthetic execution). `AirCtrl` returns without data or a prompt, so S05/S16 render empty when entered with no enabled city ([AirCtrl](../../client/www/js/controller.air.js#L362-L365)).

**Visible structure.** Product icon (`img/app_icon.png` or `img/ta_app_icon.png`), region search input, recommended-city chips and a current-location action. Recommended cities are a built-in list whose length (6, 11, 17 or 26 cities) depends on the screen height ([Device classes and orientation](#device-classes-and-orientation)).

- Every `StartCtrl` entry, on both platforms, first shows an access explanation popup (O01): title `LOC_NEEDS_ACCESS_TO`, body lines `LOC_STORAGE_SPACE`, `LOC_LOCATION_ACCESS` and `LOC_CALL_INFORMATION`, and a single `LOC_OK` button. Nothing is persisted ([StartCtrl](../../client/www/js/controller.start.js#L201-L236)).
- The ad banner is hidden while S01 is shown.

**Actions and data.** A chip supplies `{name,country,address,location:{lat,long}}` to `getWeatherByGeoInfo`. Search autocomplete is backed by Google Places, followed by location/geocode resolution and weather loading. Current-position uses the location service. Success converts weather, adds/updates the city, stores `startVersion`, selects the city and opens the product's primary weather/air page. Duplicate-city and request failures show alerts. No successful autocomplete or native permission result is implied by the capture.

**Rewrite checks.** Empty input, no predictions, unavailable Places SDK, duplicate city, location denied/disabled/timeout, weather failure, small-height chip layout, and a successful selected-city transition. Do not require live location merely to render the first screen.

Sources: [StartCtrl](../../client/www/js/controller.start.js), [template](../../client/www/templates/start.html), [startup](../../client/www/js/app.js).

## S02 — Saved locations and search

**Purpose and entry.** Select/manage favorites and add locations; first tab in both products.

**Visible structure.** Search field and edit action; saved-city cards; weather icon/current temperature and daily min/max for TodayWeather, air status/value for TodayAir; notification action; editing controls for disabling current location or deleting ordinary cities.

**Data and actions.** `WeatherInfo` cities become display rows with name/address, current-position/disabled state, weather/current temperature, daily extrema, air status and `hasPush`. The row's air values come from `airInfoList[0].last`, else `airInfo.last`, else `currentWeather.arpltn`. Selecting a row changes the selected city and opens the appropriate product page. Search and addition reuse geocode/weather paths; deleting a city must also preserve/reconcile notification-to-city associations. Editing is a distinct state from normal row navigation.

**States.** `isSearching` and `isEditing` never hold together. The header button reads `LOC_OK` while editing, `LOC_CANCEL` while searching, and `LOC_EDIT` otherwise ([template](../../client/www/templates/tab-search.html#L12-L13)). When the native keyboard is visible, the first tap on a row or result only closes the keyboard.

| State | Entry | Visible content | Actions and side effects |
| --- | --- | --- | --- |
| Normal | Default; Cancel from searching; OK from editing | Enabled rows only; rows with `city.disable` are hidden.<br>TodayWeather row: current-position pin, name or short address, weather icon, `t1h`, `tmn/tmx`, bell.<br>TodayAir row: name, AQI sentiment icon colored by `aqiGrade`, `LOC_AIR_STATUS` with `aqiStr (aqiValue)`, bell | A row tap calls `setCityIndex`, then `goPage()`.<br>The bell opens `/setting-push?fav=<index>`. On TodayAir the sentiment icon opens it too (quirk).<br>Edit enters editing |
| Searching | Focus on the input (`OnFocusInput`) | `LOC_FIND_BY_LOCATION` button.<br>Bundled `window.towns` matches (substring of the first/second/third name), appended 10 at a time as the list scrolls, then a hard-coded "powered by TodayWeather" divider.<br>Google Places `(regions)` predictions, then the `powered_by_google_on_white.png` divider.<br>The favorites list is hidden | Selecting a result shows the full-screen loading overlay, geocodes (Places results only), requests weather, adds and selects the city, then calls `goPage()`.<br>A duplicate shows `LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED`; a weather failure shows `LOC_FAIL_TO_GET_WEATHER_INFO`.<br>Find-by-location adds the resolved position to the Places section, above the Google divider, whichever geocoder produced it (source-level). A position failure opens the `search` retry confirm (O03 in [screen-overlays.md](screen-overlays.md)).<br>Cancel clears the word and results and closes the keyboard |
| Editing | Edit from normal | All rows, including a disabled current-position row. The bell is hidden; the current-position row shows a toggle, other rows a delete icon | The toggle calls `WeatherInfo.disableCity`. Disabling with `hasPush` also removes city 0's push list. The first enable (row `t1h === '-'`) runs a position update and weather load behind the loading overlay.<br>Delete has no confirmation. With `hasPush` it removes that index's push list, then splices the row and calls `WeatherInfo.removeCity`.<br>Row taps are ignored |
| Empty | No enabled city; new installs keep a disabled current-position slot at index 0 | Blank list with no empty-state message | `init` broadcasts `setInputFocus`. Non-iOS platforms focus the input after 100 ms, which enters searching; iOS does nothing |

- **Placeholders (anomaly).** `init` writes `currentWeather = {}`, `skyIcon = 'sun'` and `t1h = '-'` into the shared `WeatherInfo` city objects, because `getCityOfIndex` returns the stored reference ([SearchCtrl](../../client/www/js/controller.searchctrl.js#L128-L141), [WeatherInfo](../../client/www/js/service.weatherinfo.js#L56-L61)). The placeholders stay in the in-memory model, and a later `saveCities()` can persist them.
  - When `t1h` is `'-'`, the TodayWeather icon and temperature cells are hidden (`ng-if="city.t1h != '-'"`). The `sun` default is visible only when `t1h` exists but `skyIcon` is missing.
  - A missing `today` becomes a placeholder array, so `tmn`/`tmx` are undefined.
- **Current position.** With a null address, the current-position row is labelled `LOC_CURRENT`+`LOC_LOCATION`; see [Locale and region](#locale-and-region). Entering S02 with an enabled current-position city starts a position update and then reloads that row's weather.
- **Navigation.** `goPage()` maps `startupPage` `0/1/3/4` to hourly/daily/air/weather. `2` (favorites) and unknown values fall back to the product default, hourly or air. It then broadcasts `reloadEvent('search')`, which `TabCtrl` skips when the selected city is disabled or was loaded less than ten minutes ago ([goPage](../../client/www/js/controller.searchctrl.js#L67-L95), [TabCtrl](../../client/www/js/controller.tabctrl.js#L778-L782), [canLoadCity](../../client/www/js/service.weatherinfo.js#L137-L150)).
- **Anomalies (source-level, not reproduced).**
  - When a Places prediction's geocode lookup fails, the loading overlay is hidden without any alert ([SearchCtrl](../../client/www/js/controller.searchctrl.js#L483-L486)).
  - For a bundled town whose first name ends in `도` and whose second name ends in `구` and contains a space (for example `수원시 장안구`), the address is reassigned twice. It becomes `' ' + <district>` (plus any third name), without the `대한민국 <province>` prefix ([SearchCtrl](../../client/www/js/controller.searchctrl.js#L377-L391)). This branch is **dead code with the bundled `town.js`**: none of its 4,206 entries has a space in `second`, and all 566 entries that end in `도`/`구` use the concatenated form such as `고양시덕양구` (bundled data evaluated in Node on 2026-09-25; see [town-entry construction](client-data-contracts.md#geography-sources-and-precedence)). It matters only if the data file changes.

**Failure behavior and rewrite checks.** Search errors and duplicates show alerts; missing weather may leave a row without complete values. Verify zero-valued AQI, disabled location row, multiple cities, deletion/reindexing, long translated names, empty favorites, refresh and persistence after restart.

Captures:

- The [favorites](screenshots/tw-favorites.png) capture has one synthetic favorite.
- [Searching](screenshots/tw-favorites-search.png) shows bundled towns only; Places predictions were stubbed empty.
- In [editing](screenshots/tw-favorites-editing.png), the start-popup probe had enabled the current-position row. It has no weather, so its icon and temperature cells are hidden.
- [TodayAir](screenshots/ta-favorites.png) shows the sentiment icon, grade and AQI value.

Sources: [SearchCtrl](../../client/www/js/controller.searchctrl.js), [template](../../client/www/templates/tab-search.html), [WeatherInfo](../../client/www/js/service.weatherinfo.js). Element bindings: [screen-element-bindings.md](screen-element-bindings.md).

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

**Variants.** The dark, old and photo theme captures and the photo hero rules are in [Theme variants](#theme-variants). The Ionic Android mode capture is described in [Product and platform differences](#product-and-platform-differences). Size rules, the tablet branches and the iPad capture are in [Device classes and orientation](#device-classes-and-orientation).

**Rewrite checks.** Midnight and date labels, currentIndex edges, missing/sentinel values, C/F, mixed publication times, correct yesterday comparison, zero precipitation, short data arrays and compact-width scrolling.

Sources: [ForecastCtrl](../../client/www/js/controller.forecastctrl.js), [template](../../client/www/templates/tab-forecast.html), [chart directives](../../client/www/js/app.js), [normalizer](../../client/www/js/service.weatherutil.js). Element bindings: [screen-element-bindings.md](screen-element-bindings.md).

## S04 — Daily weather

**Purpose and entry.** Show historical/current/future daily min/max and weather; TodayWeather startup option `"1"`.

**Visible structure.** Shared hero and header; weekday/day labels; morning/afternoon icons, rain probability/amount, vertical min/max ranges with current marker; optional daily air outlook and detailed day cards.

**Data.** `dayChart[0]` carries `values`, current `temp`, and a display bitmask. Rows include `date`, `dayOfWeek`, `fromToday`, `tmn`, `tmx`, `skyAm`, `skyPm` and optional precipitation/air/life fields. `currentWeather.today.index` connects the hero/current day with detail rows. Unlike the hourly series, `values` contains day objects directly, not `{name,value}` wrappers.

**Actions/states and checks.** Horizontal scrolling, city switching, refresh, share and notification behavior follows the shared weather shell. Verify yesterday/today/tomorrow lookup, min/max order, missing morning/afternoon icons, day boundary labels and optional cards. A missing field must not silently become a meteorological zero. Since `bd6640f2` the server drops incomplete or unrecognised KMA daily rows, so `values` can skip dates, including today; index-based rules such as the legacy dust rows at fixed indexes 7/8 then name the wrong days (source reading, not captured; A15, D51, V38).

**Variants.** On screens at least 640 px wide the daily chart is not scrolled to today; the iPad capture and the size rules are in [Device classes and orientation](#device-classes-and-orientation).

Sources: [ForecastCtrl](../../client/www/js/controller.forecastctrl.js), [daily template](../../client/www/templates/tab-dailyforecast.html), [normalizer](../../client/www/js/service.weatherutil.js). Element bindings: [screen-element-bindings.md](screen-element-bindings.md).

## S05 — Air detail

**Purpose and entry.** Inspect a selected air-quality index/pollutant and station. `code` chooses the main pollutant; `fav` selects the city. Default is AQI. With no enabled city, `AirCtrl.init` returns before applying data and shows no prompt (see S01).

**Visible structure.** Large grade/value and action guide, current-weather shortcut, colored threshold ruler, hourly bar chart, daily outlook, pollutant selector cards, observation/forecast time/source, station alternatives when supplied.

**Data contract.** Prefer `city.airInfoList[stnIndex]`, then `city.airInfo`. `last` is the current station record, falling back to `currentWeather.arpltn`. It supplies `dataTime`, station name and `<code>Value/Grade/Str/ActionGuide`. `pollutants[code].hourly[]` uses `{date,val,grade,str}`; daily rows include date, relative day and grade/text. The controller builds a 24-slot series around the first hourly timestamp at or after `last.dataTime`. `WeatherUtil.aqiStandard[Units.airUnit]` supplies thresholds and colors.

**Actions/states and checks.** Change pollutant or station, open units, switch to weather, refresh. The header location glyph is inert here (see shared rules). Missing air data can fail inside a caught controller path rather than a polished empty state. Cover no station, no matching hourly timestamp, missing pollutant, true zero, multiple stations, incompatible air standards and stale station time. Grade text/color is distinct from numeric concentration.

Sources: [AirCtrl](../../client/www/js/controller.air.js), [template](../../client/www/templates/tab-air.html), [air standards](../../client/www/js/service.weatherutil.js). Element bindings: [screen-element-bindings.md](screen-element-bindings.md).

## S06 — Side menu and settings entry

**Purpose.** Navigate secondary features and global preferences. It lives in `index.html`, not a route of its own.

**Items.**

- **Region `KR` only:** weather warnings (S12), national air (S11) and the wind map. National weather (S10) also requires TodayWeather.
- **Wind map:** not a page. It opens `earth.nullschool.net` externally through `cordova.InAppBrowser.open(..., "_system")`, with a `window.open` fallback, and leaves the menu open ([SettingCtrl](../../client/www/js/controller.settingctrl.js#L39-L53)).
- **Always listed:** units, startup page, update interval, theme, feedback (mail), store review and version.
- **Remove ads:** shown when `Purchase.hasInAppPurchase` is true or a paid-app URL exists.
- **About:** shown only when `Util.language` contains `ko`. It opens an alert with the product title and three lines: weather information from the Korea Meteorological Administration, air information from the Korea Environment Corporation, and a note that the data is unverified real-time data (`LOC_WEATHER_INFORMATION`, `LOC_KOREA_METEOROLOGICAL_ADMINISTRATION`, `LOC_AQI_INFORMATION`, `LOC_KOREA_ENVIRONMENT_CORPORATION`, `LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS`; O10 in [screen-overlays.md](screen-overlays.md)).

Some items open native/external destinations; they are not additional Angular pages. The guide menu item is present but disabled with `ng-if="false"`. See [Locale and region](#locale-and-region) and [Product and platform differences](#product-and-platform-differences).

**State and checks.** Values come from `settingsInfo`, product/region, app version and purchase capability. Opening a generic settings page populates `radioList` before navigation. Verify product/region visibility and close/navigation behavior; test external actions separately with native adapters. Captures: [Korean](screenshots/tw-menu.png), [en-US region](screenshots/tw-menu-en-us.png), [Ionic Android mode](screenshots/tw-android-mode-menu.png).

Sources: [SettingCtrl](../../client/www/js/controller.settingctrl.js), [index template](../../client/www/index.html).

## S07 — Unit overview

**Purpose.** Display current temperature, wind, pressure, distance, precipitation and air-standard settings. Selecting a row opens S08.

**Data/actions.** `Units` exposes current values and supported choices. Labels and display text are translated independently from wire values such as `C`, `m/s`, `hPa`, `km`, `mm` and `airkorea`. Defaults depend on region; the [en-US capture](screenshots/tw-units-en-us.png) shows US defaults.

**Rewrite checks.** Current selection survives restart; every displayed setting affects the appropriate request/query and presentation exactly once. A new units model must retain raw/wire identity separately from translated labels. Changing settings also invalidates city freshness and may synchronize push-unit settings.

Sources: [UnitsCtrl and Units service](../../client/www/js/controller.units.js), [template](../../client/www/templates/units.html).

## S08 — Radio choices: units, startup, refresh, theme

**Purpose.** Reuse one screen for several preference families. It requires a populated `radioList` service; directly navigating to its URL is not a complete entry contract.

| Family | Existing choices and effect |
| --- | --- |
| Units | `Units.getSelectList(type)`; save units, update push settings; air-unit changes emit an event |
| Startup | TodayWeather `0/1/2/3` (hourly/daily/favorites/air); TodayAir `3/4/2` (air/weather/favorites) |
| Refresh interval | `0/30/60/180/360/720`; labels and scheduling logic use this stored value |
| Theme | TodayWeather photo/light/dark/old; TodayAir light/dark; updates image paths and native status-bar style if available ([Theme variants](#theme-variants)) |

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

**Actions/states and checks.** Switch among three modes (`changeWeatherType(0/1/2)`: weather/temperature, precipitation, wind). Loading is shown; errors are logged and loading is hidden, without a detailed page-specific recovery panel. Verify missing cities, long names, correct unit labels, small-height scrolling and every map mode. Map captures ([weather](screenshots/tw-nation.png), [precipitation](screenshots/tw-nation-rain.png), [wind](screenshots/tw-nation-wind.png)) are synthetic and carry no live forecast claim.

Sources: [NationCtrl](../../client/www/js/controller.nation.js), [template](../../client/www/templates/nation.html).

## S11 — Nationwide air

**Purpose.** Compare regional pollutant values. The top strip selects PM2.5, PM10, O3, NO2, SO2 or CO; overflow of the strip is intentional.

**Data/layout.** Reads the same nation endpoint's `air` array, matching `sidoName`. `<code>Value` and `<code>Grade` populate labels/colors; display selector `pm2.5` maps to field prefix `pm25`. Threshold colors depend on selected air unit. Map positions are fixed, not derived geographic coordinates.

**Rewrite checks.** Missing regional values, zero, pollutant field mapping, thresholds, label collisions, strip/map scrolling and request failure. The capture's identical values are deliberately synthetic.

Sources: [NationAirCtrl](../../client/www/js/controller.nation.air.js), [template](../../client/www/templates/nation-air.html).

## S12 — Weather warnings/bulletins

**Purpose.** Show published KMA bulletin content.

**Data/layout.** `GET /v000903/kma/special` with a 3-second timeout returns a list. Rows use `name`, `announcement`, optional `imageUrl`, `situationList[].weatherStr/levelStr/info[].timeStr/location`, `type` and `comment`. The client localizes announcement date/time and replaces comment newlines with `<br>` before `ng-bind-html` presentation.

| `type` | Meaning | Server-localized `name` key | Note block |
| --- | --- | --- | --- |
| `1` | Special weather report (warning/advisory) | `LOC_TYPE_SPECIAL_WEATHER` | Shown |
| `2` | Preliminary special report | `LOC_TYPE_PRELIMINARY_SPECIAL` | Shown |
| `3` | Weather information | `LOC_TYPE_WEATHER_INFORMATION` | Hidden |
| `4` | Weather flash | `LOC_TYPE_WEATHER_FLASH` | Hidden |

- **Type values.** The enum is defined in the [model](../../server/models/modelKmaSpecialWeatherSituation.js#L19), and the server sets `name` from `type` ([controller](../../server/controllers/kma.specialweather.controller.js#L49-L61)).
- **Note block.** The `LOC_SPECIAL_WEATHER_NOTE` heading is rendered only when `special.type === 1 || special.type === 2`. The strict comparison means a string type would hide the note ([template](../../client/www/templates/kma-special.html#L24-L27)).
- **Server assembly (source-level).** The server returns the latest record of each type in the order 4, 1, 2, 3. It drops a type-4 record once its stored announcement plus 10 hours has passed. If any type has no stored record, the whole request fails with HTTP 501 ([controller](../../server/controllers/kma.specialweather.controller.js#L64-L71), [assembly](../../server/controllers/kma.specialweather.controller.js#L97-L131), [route](../../server/routes/v000903/route.kma.v000903.js#L72-L83)).

**States/checks.** Empty list and request error differ; the controller sets `$scope.error`, but the current template has no dedicated error block. Preserve/decide content sanitization, timezone, long bulletin wrapping and image failure behavior. The screenshot explicitly says the warning is synthetic and omits the optional image.

Sources: [KmaSpecialCtrl](../../client/www/js/controller.kma.special.js), [template](../../client/www/templates/kma-special.html).

## S13 — Ad removal/purchase

**Purpose.** Present product entitlement, purchase/restore actions or premium expiration.

**Data/states.** Product title/description/price come from the platform purchase plugin; account level and receipt/expiration state interact with persisted purchase data and validation. Free, plugin-unavailable, product-loading, premium and renewal states are distinct. Product/platform builds select different purchase controllers and plugins. The TodayAir iOS disclosure block and the ad-banner hiding are described in [Product and platform differences](#product-and-platform-differences) and [Advertising surface](#advertising-surface).

**Capture and checks.** Captured plugin-unavailable presentation only: the normal menu may hide the entry, and direct route access does not establish a working purchase flow. No fabricated store price or transaction is shown. Rewriting needs real store sandbox tests for purchase, cancellation, restore, receipt failure, expiry and entitlement synchronization.

Sources: [current Purchase service/controller](../../client/www/js/controller.purchase.js), [template](../../client/www/templates/purchase.html), [variant build selection](../../client/gulpfile.js).

## S14 — Legacy guide

**Purpose.** Older slide-based onboarding/help with image pages and skip/back/close actions. The state still exists, while its current menu item is disabled.

**Data and checks.** Local guide images vary by platform/language. Some slides describe old UI behavior and must not be treated as the authoritative current design. Capture records the present route; decide whether to retain, update or remove it during rewrite.

Sources: [GuideCtrl](../../client/www/js/controller.guidectrl.js), [template](../../client/www/templates/guide.html), [disabled menu entry](../../client/www/index.html).

## S15–S16 — TodayAir product differences

TodayAir is selected through `clientConfig.package="todayAir"`; the same Angular application registers a different tab arrangement and `tab.weather`. Its combined weather template contains hourly and daily material, while the primary air screen reuses S05. Saved-city cards emphasize AQI, default startup is air, theme choices are light/dark, and purchase/plugin behavior differs by variant. TodayAir also has Android build tasks; those builds use `ta-tabs.html` with `ion-ios-*` tab icons and Android header glyphs (see [Product and platform differences](#product-and-platform-differences)). The combined-weather expander is not persisted.

The TodayAir captures switch only the staged product configuration, startup preference or theme, preserving the shared current source and synthetic fixture: [combined weather](screenshots/ta-weather.png), [air](screenshots/ta-air.png), [air in the dark theme](screenshots/ta-theme-dark-air.png) and [favorites](screenshots/ta-favorites.png). They do not prove TodayAir release resources, native bundle configuration or store integration.

Sources: [product registration](../../client/www/js/app.js), [TodayAir tabs](../../client/www/templates/ta-tabs.html), [combined weather](../../client/www/templates/ta-tab-weather.html), [product build](../../client/gulpfile.js). Element bindings: [screen-element-bindings.md](screen-element-bindings.md).

## Cross-screen states to implement and verify during rewrite

These are required review cases, not claims that all existing states are polished or captured. Dialog, alert and loading-indicator definitions (triggers, `LOC_` keys, buttons, results and captures) are in [screen-overlays.md](screen-overlays.md); this table does not repeat them.

| State | Existing mechanism / rewrite concern |
| --- | --- |
| First launch | Native preference restoration, settings defaults, disabled current-position slot, startVersion gate and the access explanation on every S01 entry |
| No enabled city | Zero-city start choice on ForecastCtrl screens and weather/air tab taps; S05/S16 render empty without a prompt (S01) |
| Loading/refresh | Weather/air tab screens use only the header spinner flag, which is invisible in the light theme ([Theme variants](#theme-variants)). Start, Search, national maps and iOS purchase/restore use the full-screen `$ionicLoading` overlay. The ten-minute memory gate and the overlapping HTTP timers are separate mechanisms. Indicator definitions: O17 in [screen-overlays.md](screen-overlays.md) |
| Failure/retry | Shared alert/confirm paths; retained cached city; not every secondary page visibly renders errors ([screen-overlays.md](screen-overlays.md)) |
| Missing/partial data | Truthy merge may retain old sections; absent, null, sentinel and zero must remain distinct |
| Permission/SDK unavailable | Location diagnostic, Google Places, Firebase, purchase and sharing have separate fallback paths; platform variants are in [Product and platform differences](#product-and-platform-differences) |
| Settings change | Unit/theme/startup/refresh changes persist and trigger different events; avoid stale unit/value combinations |
| Resume/rapid navigation | Refresh and location updates can overlap; bind responses to the initiating city in any intentional fix |
| Update/permission dialogs | Existing modal overlays may cover otherwise correct screens; defined and captured separately in [screen-overlays.md](screen-overlays.md) |
| Advertising | Free accounts reserve a bottom banner outside the web view; hidden on S01, S13 and S14 ([Advertising surface](#advertising-surface)) |
| Device class/orientation | iPhone and iPad are declared and landscape is allowed, but sizes are computed at controller init from `window.screen` and never on rotation; only S03/S04 are captured on iPad, in portrait. Decide whether to support tablets and landscape ([Device classes and orientation](#device-classes-and-orientation)) |
| Accessibility/keyboard | Not covered by these captures. Add Dynamic Type/text size, VoiceOver, keyboard, focus and long translations; Android currently disables system text zoom |

Use [verification matrix](verification-matrix.md) for proposed acceptance cases and [decision ledger](decisions-and-open-questions.md) for behavior changes that need an explicit migration decision.
