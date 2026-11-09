# TodayWeather for Android (native)

Kotlin and Jetpack Compose replacement of the Cordova app in `client/`, tracked in #2877. It ships as an update of `net.wizardfactory.todayweather` and uses the legacy server API as it is. The work is split into sub-issues AN-01 to AN-19 (#2880–#2898); see the [plan](../plans/android-native.md).

The Android build never reads `client/`. Images, translations and the town list are copied into `android/` by an import tool, with a provenance record.

## Layout

| Module | Contents |
| --- | --- |
| `core-model` | Response and state models. Plain Kotlin/JVM, no Android types, so a later iOS app can reuse it. |
| `core-domain` | Conversion, units, comparisons and chart data. Plain Kotlin/JVM. |
| `core-data` | API client, repositories and caches (Android library). |
| `core-storage` | DataStore and the migration from the Cordova app (Android library). |
| `app` | Compose UI and the application. Feature modules are added by later sub-issues. |
| `tools/` | Development tools that may read `client/`; the Gradle build does not. |

Versions live in [`gradle/libs.versions.toml`](gradle/libs.versions.toml). The app targets API 36 (minSdk 24) and compiles against API 37, which current Compose libraries require.

## Prerequisites

- JDK 17.
- Android SDK with platform 37 and build tools (the Android Gradle plugin installs missing platforms when the SDK licences are accepted). Point `local.properties` (`sdk.dir=…`) or `ANDROID_HOME` at the SDK.
- An API 36 emulator for device checks.

The Gradle wrapper downloads Gradle 9.9.0 and checks its SHA-256.

## Build and test

From `android/`:

```sh
./gradlew assembleDebug test          # debug APK and all JVM unit tests
./gradlew installDebug                # install on the device selected by ANDROID_SERIAL
```

Set `ANDROID_SERIAL` to an emulator serial before any install or device test; a connected phone must not be the target by accident.

CI (`.github/workflows/android.yml`) runs the same build and tests twice: once after re-running the import tool and checking that it changes nothing, and once in a checkout whose `client/` directory has been deleted.

## Imported client assets

```sh
python3 android/tools/import_client_assets.py
```

It copies `client/www/img/**/*.png` to `app/src/main/assets/img/`, converts `client/www/data/town.js` to `app/src/main/assets/data/towns.json` and converts `client/www/locales/*.json` to `app/src/main/res/values*/client_strings.xml` (English is the default, as in the Cordova app). It also copies the Material Icons font (`client/www/fonts`), the launcher icon (`client/tw.resources/android/icon`, as `mipmap-*/ic_launcher.png`) and the Android 12+ splash icon (`client/tw.resources/android-launcher-icon.png`), which `client/config.xml` names; the Cordova APK carries the same files. `tools/import_cordova_fonts.py` copies the Ionicons font from a Cordova debug APK, since Bower installs it outside Git (`app/provenance/cordova-fonts.json`). It reads the image list from Git, so case-insensitive file systems give the same result; `client/www/img/KR.png`, a same-content duplicate of the `kr.png` the app uses, is skipped and listed. Catalog keys that are not valid resource names, such as `LOC_TODAY_THAN_YESTERDAY?`, become `LOC_TODAY_THAN_YESTERDAY_`; the provenance record lists them. [`app/provenance/client-assets.json`](app/provenance/client-assets.json) records each output's source path, the last commit that changed the source, and both hashes. The tool needs the full Git history.

Do not edit the generated files. While iOS stays on Cordova, change translations in `client/www/locales/` (for example #2613) and re-run the tool, so both apps get the change.

## Golden corpus

`core-domain` is checked against outputs of the Cordova code itself: [`tools/corpus/generate.mjs`](tools/corpus/README.md) runs the client's conversion and display functions under Node and writes `core-domain/src/test/resources/corpus/`; `GoldenCorpusTest` must match every case. CI regenerates the corpus and fails on a diff, so a change in the Cordova code shows up as a corpus change. Known behavior differences are listed in [`tools/corpus/differences.md`](tools/corpus/differences.md).

## Charts

The hourly and daily forecast charts (gate G2, AN-05) are ported from the Cordova D3 directives (`ngShortChart`, `ngShortDetailChart`, `ngMidChart`). `core-domain` (`chart/`) builds each chart as the SVG the directive draws, element by element: D3 v3 bands and `.nice()` scales, the inserted current point, labels, icons and the opening scroll offset. Sizes come from the screen size as in the Cordova forecast screen (`ChartMetrics`). `app` (`ui/chart/`) draws it with Compose: `HourlyChartView` (header, chart, pinned legend, detail rows behind the expander) and `DailyChartView`, with the theme's colors of the Cordova SCSS (`ChartColors`), the imported images and header rows on the WebView's line metrics (`CssMetrics`, see below). The charts are compared with captures of the Cordova build on the emulator at 384×832, 360×780 and 412×892 dp, at the opening position and both scroll ends; see [`tools/chart-reference`](tools/chart-reference/README.md).

## App shell (AN-07)

The frame every screen shares (`app` `ui/shell/`, rules in `core-domain` `shell/`), from the Cordova templates, controllers and SCSS:

- **Tabs and header:** the bottom tab bar (Locations, Hourly, Daily, Air; the selected weather or air tab shows the refresh glyph and a tap asks for a refresh, a second tap within 700 ms does nothing) and the header bar with the menu button, the title and the page's buttons. Sizes follow Ionic: a 44 dp header and a 49 dp tab bar with half-pixel hairlines, items up to 150 dp centered on wide windows, icon buttons at 0.87 opacity, the title centered clear of the wider group of buttons. Text sits on the baseline of a line in its own font, as in Chrome, also when Noto Sans CJK draws Korean.
- **Side menu (S06):** full screen, sliding in over 200 ms, rows in Cordova order with the Korea-only rows for region KR (전국날씨 also needs the TodayWeather product, which this app is), the analytics, ad privacy, policy and terms rows as blocks; AN-12, AN-13 and AN-15 connect the rows.
- **Back:** closes the menu, then a dialog; on a main tab it asks 종료하시겠습니까?.
- **Themes:** light, dark, photo and old with the colors of the Cordova SCSS per tab (the old theme colors Hourly and Daily; the photo theme's Hourly and Daily headers are clear with outlined text over the photo) and the icon and image folders of `theme.js`. The photo feed (`TW_WEATHER_PHOTOS_URL`, a private input) loads like `loadWeatherPhotos`: when the app opens and when a network comes back, attempts 2 s apart while none has answered (up to three, 20 s each; the first answer cancels the others), once per process after a success (`WeatherPhotoFeed`, core-data); `WeatherPhotos` groups and chooses photos as `findWeatherPhoto`, checked against `corpus/photos.json` from the Cordova code. AN-08 shows the photo.
- **Languages and text size:** the first system language picks one of the six catalogs as angular-translate does; the region (last part of the first language tag with one, default KR) shows the Korea-only rows. Text follows the system font scale (AN-06) while glyphs and the bars' fixed lines keep their size; the tab bar and menu rows grow, a tab label too long for its item wraps onto a second line (balanced, hyphenated), and a menu value that no longer fits beside its label moves under it.
- **Layout:** edge-to-edge with the Cordova status bar (#111111, light icons); side insets (a navigation bar or a cutout at the side) stay clear; a slot under the tab bar for the AN-15 banner.
- **Launch:** the launcher activity keeps the Cordova component name `net.wizardfactory.todayweather/.MainActivity`, the Cordova launcher icon and splash icon; the splash screen stays until the data migration finishes, and entry intents (launcher, notification taps) wait for it (`EntryIntents`).

Tests: `ShellLogicTest` (core-domain: languages, region, themes, startup page, photo goldens), `WeatherPhotoFeedTest` (core-data), `ShellTest` (tabs, startup page, menu rows, back, exit), `EntryIntentsTest` (entry intents wait for the migration, in order), `ShellScreenshotKoTest`/`ShellScreenshotEnTest` (tab bar, header and menu in four themes against screen captures of the Cordova build; see [`tools/shell-reference`](tools/shell-reference/README.md)) and `ShellFitKoTest`/`ShellFitEnTest` (tablet, foldable, split-screen and small windows, three of them at font scale 1.3: no text cut, bars inside the safe area) with the Japanese, German and Chinese catalogs in the narrowest of them. On emulators, `ShellFitDeviceTest` keeps the app open while the display rotates, shrinks to a split-screen half and folds, with gesture and three-button navigation:

```sh
cd android && ./gradlew assembleDebug assembleDebugAndroidTest
ANDROID_SERIAL=emulator-5570 tools/large-screen/run-shell-fit.sh [out-dir]   # a tablet, then a foldable emulator
```

It takes the emulator offline while the app is installed and resets the display size, rotation, device state and navigation mode on every exit. The upgrade test below covers the launch continuity.

## Weather pages (AN-08)

Hourly (S03) and Daily (S04), from `tab-forecast.html`, `tab-dailyforecast.html`, ForecastCtrl, TabCtrl, WeatherUtil and WeatherInfo (#2887):

- **Requests and cache (`core-data`):** `WeatherRequests` builds the URL of `getWeatherByGeoInfo`: `/weather/v000903/coord/{lat},{long}` when the latitude is truthy, else for an address the KMA town route `/v000903/kma/addr/…` or the free-form `/weather/v000903/addr/{address}`, which the server answers with 501. The units query follows `Units` with `airForecastSource=kaq`, and `Accept-Language` is the device's languages in Chrome's form; `corpus/requests.json` pins the URLs from the Cordova code. Attempts follow `_retryGetHttp`: another 2 s later while none has answered, up to three, 10 s each; the first to settle decides and the others are cancelled. `WeatherRepository` keeps each place's weather by place (current position, coordinates or address) in memory and in `files/weather/`, so a cold start shows the last weather while it loads. A response applies to the place that asked for it (A01 fixed); only the latest request of a place counts (an older answer, a failure included, counts for nothing) and answers are stored one at a time; fields a response leaves out keep their value (A02); the ten-minute gate lives in memory. `AppStateHolder` is the store's only writer after the migration: the screens' changes show at once, PushSync's token updates go through it too (`dataStore`), and one writer saves everything in the order it was asked for; the screens see the last saved state with their unsaved changes on top, and a change whose save fails stays shown and is saved again with the next write.
- **Loading (`WeatherSession`):** TabCtrl's `loadWeatherData` and its reload senders. Opening the app, a tap on the selected Hourly, Daily or Air tab and the retry button load at once; a return to the foreground waits for the gate. Swipes on the header and its arrows move between places as WeatherInfo does (`PlaceIndex`, checked against the Cordova code) and load through the gate. The refresh interval restarts with every load. A failure opens the retry confirmation (O03: 오류, 날씨 정보를 가져오지 못하였습니다, 닫기/확인), which holds other reloads until it is answered. What a response changes in its place (the current position's name, country, address and location, a saved place's missing location, the source) and a photo chosen from the feed are saved; places without a photo get one when the feed arrives. The current position's own lookup comes with AN-10.
- **Pages:** `ForecastScope` (`core-domain`) is ForecastCtrl's scope for one visit: it opens when the tab opens and applies the selected place whenever it changes, with the controller's early returns and the values an apply leaves from an earlier place (the source only when the new place has one, as anomaly 2 of screen-element-bindings.md; the photo of the last place that had one). `corpus/forecast.json` runs the controller itself for 29 visits of both pages. `ForecastPage` renders the scope as the templates do: header, hourly and daily AQI tables, current air, detail weather and AQI rows (`toFixed`, the zero and undefined rules, HTML white space), the three days of S04, the legacy dust rows, the pollen popup and the attribution; `ForecastPageTest` compares it with the text, images and grade colors of the Cordova pages. `WeatherPage` (`app`) draws it. Its line boxes follow the WebView's font metrics (`CssMetrics`: Roboto and the Korean fallback font, ascent and descent rounded to device pixels) and its text uses unhinted advances (`TextMotion.Animated`), so the blocks have the Cordova heights and text ends where the WebView's does. Card and chart colors follow the theme: light, dark, old, and photo with the photo under the header and the bar darkening as the page scrolls.
- **Bar:** the place's name, the current position's location glyph (it opens the location settings when location is off) and, while the place loads, the spinner, white as in the Cordova app and so hidden by the light theme's white bar (A08, kept). The air links open S05 on their pollutant (below); the bell, share and units links reach their pages with AN-14, AN-16 and AN-12; the source link shows its description.
- **Text size:** text follows the font scale. The charts are drawn to columns of a seventh of the screen, so they zoom as a whole: their text grows with the scale and keeps its room, and the chart scrolls further.

Tests: `ForecastScopeTest` and `ForecastPageTest` (core-domain), `WeatherRequestsTest`, `WeatherRepositoryTest` and `WeatherSessionTest` (core-data), `ForecastScreenshotTest` (every block of both pages for Seoul and London against captures of the Cordova build at 384×832, within recorded tolerances; see [`tools/forecast-reference`](tools/forecast-reference/README.md)), `WeatherTabTest` (places, swipes and arrows, tab reload, spinner, retry, pollen popup, expander, a late response) and `ForecastFitKoTest`/`ForecastFitEnTest` (phone, small window and tablet at font scale 1.3: no text cut). Against the production server on an emulator, with read-only weather requests and push requests recorded by the test app:

```sh
cd android && ./gradlew assembleDebug assembleDebugAndroidTest   # with TW_SERVER_URL
ANDROID_SERIAL=emulator-5554 tools/emulator/run-production-weather.sh [out-dir]
```

It needs a network, captures Seoul and London on both pages (`ProductionWeatherTest`) and Seoul's measuring stations on S05 (`ProductionAirTest`), and uninstalls both packages on every exit; when that cannot be confirmed it takes the emulator offline and exits 5 (`tools/upgrade/test-cleanup.sh` checks this with an adb test double).

## Air quality (AN-09)

The Air tab, S05, from `tab-air.html`, AirCtrl, the `ngAirChart` directive and TabCtrl's air helpers (#2888):

- **Scope and page (`core-domain` `air/`):** `AirScope` is AirCtrl's scope for one visit: it opens on the pollutant of the link (`?code=`, else the overall index), applies the selected place whenever it changes, and returns to the first station on TabCtrl's `applyEvent`. The apply runs in AirCtrl's order and stops where AirCtrl's `try` stops, so values it does not reach keep what an earlier place set: a swipe to a place without air keeps the previous place's air (only a fresh visit shows the scale alone), and the forecast rows stay for a place without air keys (A16). `corpus/air.json` runs the controller itself for 32 visits (stations, pollutants, standards, fallbacks, missing data, a daylight-saving day). `AirPage` renders the template: the main box (the grade, or a pollutant's value with ㎍/㎥ or ppm), the gauge's bands and value label (`getLabelPosition` with the label's and the bands' widths in whole dp), the chart title, and the daily, detail, info and station cells, with values as sent (no rounding; a station value of 0 shows as `-`). `AirChart` is the directive's scene: 24 hourly slots (a missing one dated in the device's zone), bars in the grade colors on D3's `nice` scale, a tick per date with a label every three hours and the date under 0시, and the current hour's line through the chart. `AirPageTest` and `AirChartTest` compare them with the Cordova build's page and SVG.
- **Loading:** `WeatherSession.applies` counts the `applyEvent`s: each load starting (also when the ten-minute gate stops it) and each response applied. A tap on the selected Air tab loads at once like the weather tabs.
- **Screen (`app` `ui/air/`):** `AirScreen` draws the page with S03's header block, cards and info rows, its own gauge, chart and sideways-scrolling detail and station cells (a tap selects the pollutant or station and brings the page to the top). The gauge and the cells set their text with Chrome's rounding of a descent that rounds down (measured on the Cordova screen), and the grade line puts its text on the baseline Chrome gives a 24 px line. The chart zooms with the font scale like the weather charts and follows the card's width when the window changes (the Cordova chart kept its first width). Colors: the dark theme has its own; the photo and old themes show the light page.
- **Navigation:** S03 and S04's air cells and summary open S05 on their pollutant (`goAirInfoPage`). As on the Cordova build, the pollutant stays in the URL across the weather tabs, so the Air tab opens on it again until the Locations tab clears it; a detail cell changes only the page (`tools/air-reference/navigation.json`). The current weather opens Hourly; the standard opens the units page (S07); the forecast source opens its description (O08). The location glyph does nothing on S05 (A10).

Tests: `AirScopeTest`, `AirPageTest` and `AirChartTest` (core-domain), `WeatherSessionTest` (the apply events), `AirScreenshotTest` (every block of seven states, including the states of manual pages 10–12, against captures of the Cordova build at 384×832 within recorded tolerances; see [`tools/air-reference`](tools/air-reference/README.md)), `AirTabTest` (stations, pollutants, the link's pollutant across the tabs, a reload back to the first station, O08, the weather link) and `AirFitKoTest`/`AirFitEnTest` (font scale 1.3). On an emulator against production, `run-production-weather.sh` above also runs `ProductionAirTest`: Seoul's stations, and the second station's name and value after its tap (checked on API 36 and API 24; both production tests set Korean units). The app runs from API 24 without core library desugaring, so time uses `java.util`; `MinSdkApiTest` fails when a shipped module uses `java.time` (API 26).

## Settings and the menu's hand-offs (AN-12)

The units page S07, the choice lists S08 and the menu rows that open other apps or information (#2891), from `units.html`, `setting-radio.html`, UnitsCtrl, `radioList`, RadioCtrl and SettingCtrl:

- **Lists and labels (`core-domain` `settings/`):** `SettingLists` has S07's rows (`getUnitNameStr`, `getUnitValueStr`), each list's title and choices (`Units.getSelectList`, `settingRadio`) and the values the menu shows (`getStartupPageValueStr` and the others, `N/A` for a value a list does not have). `Handoffs` has the targets: the wind map, the store page of the app's package and the feedback mail (`Util.sendMail`: the translated subject as it is, a body with the app version, the device UUID and the WebView's user agent through `encodeURIComponent`). `About` is the O10 popup's text. `corpus/settings.json` runs the Cordova controllers with recorders for every unit set, list, choice, menu value, hand-off and the About popup in Korean and English.
- **Changes (`core-data` `SettingsActions`):** as `radioList.setValue` and RadioCtrl do it: a unit chosen on S08 is saved and, when it changed, the push list is posted again with it (`PushSync.updateUnits`, `Push.updateUnits`, with the list as `loadPushInfo` repaired it and only with a token); a startup page, refresh interval or theme is saved, and the refresh interval restarts the timer. Then every place may load again and the selected one loads at once (`WeatherSession.settingChanged`: `reloadCity` for every place, `reloadEvent` "resume", skipped while the retry confirmation is open). Opening the refresh interval's list restarts the timer too, since it sets the list's value. The weather pages read the temperature unit and the theme as they apply and S05 takes a new air standard as it is (`changeAirUnitEvent`), so a change shows under the settings pages without a new visit.
- **Pages (`app` `ui/settings/`, `ui/shell/Popup.kt`):** `SettingsScreen` draws S07 and S08 over the tab page and the tab bar (the tab stays as it was, as the Cordova tabs stayed cached), in the theme's plain colors (the menu's), with the menu's header and Ionic's item rows; S08 shows the check mark on the saved value and a tap on it does nothing. Back and Android back leave a page. S07 scrolls when its rows do not fit larger text (the Cordova page did not scroll; its fixed text size always fit). `IonicAlert` is an Ionic alert (backdrop, 250 dp popup, title, lines, `button-positive`), used for About.
- **Menu:** 단위설정 and the three lists close the menu and open their page; S03's and S05's standard row open S07 (`goUnitsPage`). 널스쿨 풍향 (region KR) opens the wind map in the browser and keeps the menu open; 의견보내기 and 응원리뷰쓰기 close the menu and open the mail app and the store; About opens over the menu, and 확인 or Android back closes it. The intents are those the Cordova build sent: `VIEW` with the app's package as `Browser.EXTRA_APPLICATION_ID` (InAppBrowser `_system`) and `VIEW` `BROWSABLE` for the `mailto:` link the WebView handed on. Without an app for one, nothing opens. The feedback address is a private input (`TW_MAIL_TO`); without it the mail has no recipient.
- **Photo theme:** the photo now covers the header block from its top left (`background-size: cover` at the default position), found by the page 31 comparison.

Tests: `SettingListsTest` (core-domain), `PushRegistrationTest` (core-storage: the list after a unit change), `SettingsActionsTest` (core-data: every choice of every list against the Cordova trace, the weather request against the one the Cordova build sent, the timer, the retry confirmation), `SettingsTest` (the pages and menu rows in the app, the hand-off intents), `SettingsScreenshotTest` (S07, every S08 list, S03 in °F, dark and photo themes, About; manual pages 25–31 and 36 against captures of the Cordova build; see [`tools/settings-reference`](tools/settings-reference/README.md)), `SettingsGeometryTest` (the rows, the check mark and the popup's parts against the captured rects) and `SettingsFitKoTest`/`SettingsFitEnTest` (font scale 1.3). On an emulator, `tools/emulator/run-settings-handoffs.sh` runs `SettingsHandoffTest` offline: each hand-off sends the Cordova intent and the app the system resolves for it comes to the front (Chrome, Gmail and the Play Store on images that have them; pass `store` on a Play Store image), and About opens in Korean and English (per-app locale, API 33+).

```sh
cd android
TW_MAIL_TO=<feedback address> ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
ANDROID_SERIAL=emulator-5554 tools/emulator/run-settings-handoffs.sh [out-dir] [store]
```

## Nationwide pages and warnings (AN-13)

The menu's 기상특보 (S12), 전국날씨 (S10) and 전국미세먼지 (S11) (#2892), from `kma-special.html`, `nation.html` and `nation-air.html` with KmaSpecialCtrl, NationCtrl and NationAirCtrl:

- **Requests (`core-data` `NationSource`):**
  - S10 and S11 share `getNationWeather`: `/v000903/nation/KR` with the units query and the device's `Accept-Language`. Up to three attempts 2 s apart, 20 s each; the first to settle decides.
  - S12 sends one `/v000903/kma/special` with `$http`'s 3 s timeout and no retry.
  - Each page sends its request every time it opens (the Cordova states have `cache: false`). The answer stays while the page is open, across configuration changes (`NationLoads`).
  - A failure leaves S10 and S11 with the names only and S12 empty. A body that is not JSON is no answer, as `JSON.parse` finds: kotlinx alone would read a bare word.
- **Pages (`core-domain` `nation/`):**
  - `NationPages` gives each map label its name, icon and values in the mode or pollutant chosen, from the AN-02 `Nationwide` rules.
  - `WarningCards` gives each card its heading (`name announcement`), situations (bold hazard and level, then `timeStr location` lines), the note heading for numeric type 1 or 2, and the comment through `ng-bind-html` (`BoundHtml`).
  - In `BoundHtml`, `<br>` breaks lines, other tags go with `script` and `style` content, and white space collapses. Entities are decoded, numeric ones as the HTML parser reads them: U+FFFD outside Unicode, and windows-1252 for 0x80–0x9F.
- **Screens (`app` `ui/nation/`):** `NationScreen` draws the pages over the tabs, like the settings pages, with the theme's plain header and #F5F5F5 in every theme.
  - S10: the three outline mode buttons, at Chrome's pixel-snapped widths, with an ellipsis for text that does not fit. The map is 330×485 dp with 20 sp labels on `line-height: normal` lines. A label is CSS shrink-to-fit, so 울산's 북북서 wraps at the map's edge.
  - S11: the 480 dp strip of tabs, which scrolls sideways on narrow windows, and the labels in the grade colors of the chosen air standard.
  - S12: the cards with Chrome's line boxes:
    - the h2's 19.2 dp lines on Roboto's baseline;
    - the image's line, when blocks follow it;
    - Korean lines of 23 dp with Chrome's borrowed pixel;
    - empty lines of 19 dp.
  - Text is broken as Chrome breaks it, between Korean syllables too (`chromeBreaks`; Samsung's Android otherwise keeps Korean words whole). Characters Roboto has stay in Roboto between Korean letters (`chromeRuns`).
  - While S10 or S11 loads, `$ionicLoading` shows (backdrop, 68×72 dp box, the bubbles spinner), and Android back does nothing until it ends, as in Ionic.
  - Larger text: the labels grow at their fixed positions and may overlap, as the map leaves no room. A label that would reach past the window's right edge moves left to stay whole. The h2's lines grow with the text (`line-height: 1.2`).
- **Not drawn:** S12's `imageUrl`. Only scraper-era documents have it, and the collector since 5a38aad4 omits it; the production answer in the corpus has none.

Tests:
- `NationPagesTest` (core-domain): every label of the captured pages, the cards in Korean and English, the note rule, `ng-bind-html` and the empty and failed answers.
- `NationSourceTest` (core-data): the URLs the Cordova build sent, the retries of a late answer, the 3 s timeout, and empty, failed and non-JSON answers.
- `NationLoadsTest`.
- `NationTest`: the menu rows, back while loading, modes and tabs, a failed answer, restoring the saved state.
- `NationScreenshotTest`: 30 comparisons with `tools/nation-reference` (manual pages 32–35, the other modes and tabs, the loading, empty and failed states, dark and old themes, km/h and AirNow, English).
- `NationGeometryTest`: labels, buttons, tabs, cards and the loading box within 0.5 dp.
- `NationFitKoTest` and `NationFitEnTest`: font scale 1.3 on a phone, a small window and a tablet.
- `ChromeTextTest`: the break opportunities, lines and runs.

The production test is `ProductionNationTest` (`tools/emulator/run-production-weather.sh` on API 33 or later, with the app's language set to ko-KR so the rows show).

## Ads, usage analytics and crash reports (AN-15)

The bottom banner, the usage analytics opt-in and Crashlytics (#2894), from `service.twads.js`, `service.admobemi.js`, `service.monetization.js`, SettingCtrl's privacy rows and the plugin settings of the Cordova build:

- **Banner (`app` `ads/`):**
  - `AdsConsent` runs UMP as the AdMob plugin does when the app opens: update, the consent form when required, then the Ads SDK in the same session as soon as ads may be requested (#2871). A consent stored from an earlier session starts it at once. When UMP fails, release builds show no ads; debug builds, which use Google's test units as the Cordova test-unit builds did, start the SDK without UMP once, unless the failure is a consent decision.
  - `TwAds` loads the banner once the SDK has started and shows it as `BannerGate` (core-domain) allows: after the Remote Config policy has finished, `tw_banner_delay_seconds` after the app opened, not when `tw_banner_enabled` is false. It counts one `ad_policy_exposure` per app open and keeps loads 5 s apart. AN-10's start page will hide it with `setShowAds(false)`.
  - The banner belongs to the activity (`AdMobBanner`): the anchored adaptive size for the window's width without the side insets. A configuration change loads a new one at the new width, as the orientation change did.
  - It sits under the tab bar and above the navigation bar, where the plugin put it. The menu, the pages and the in-app popups end at its top edge, as they ended at the WebView's; the strip appears with the banner (B15).
  - `RemoteBannerConfig`: defaults `true` and `0`, fetch timeout 10 s, minimum interval 3600 s. The activated values are read first, so an offline start keeps the kill switch; then a fetch. A pair applies only whole (`"true"`/`"false"`, ASCII digits up to 120). The policy is final after the fetch applied or failed, or after 12 s; later answers are ignored. Without Firebase the defaults apply.
- **Usage analytics (`app` `analytics/`):**
  - Off until the user opts in on 선택적 이용 통계 (동의함 or 꺼짐): the Ionic popup with 거부 / 철회 and 동의; Android back closes it without a choice (B17). A grant sets analytics storage granted and ad storage, ad user data and ad personalization denied, then enables collection; a withdrawal stops it at once.
  - `ConsentStore` keeps the choice and the SDK's collection state in two private preference files written with `commit()`. A failed write removes the choice, so an old grant cannot survive, and shows `LOC_PRIVACY_SAVE_FAILED`. At the start a grant is restored only when both records hold it, as the plugin's persisted flag corroborated WebView storage.
  - `EarlyStartProvider` turns collection off before Firebase starts, then applies the stored choice. A Cordova opt-in does not carry over: it was only in WebView storage.
  - Events follow `AnalyticsSchema` (core-domain), with `measurement_version` 1 and `traffic_type` (`development` for debug builds, `production` for release builds): `weather_fetch` and `weather_load` from `WeatherRepository` and `WeatherSession` (an answer a newer request replaced reports only its request), the ad events, and `screen_view` with the Cordova state names (`tab.forecast`, `units`, `setting-radio`, `nation` …) and `screen_class` `Cordova` (B16). `favorite_change` and `location_permission` come with AN-10 and AN-11, which add those actions.
  - Automatic screen reporting is off, as in `config.xml`.
- **Menu rows:** 광고 개인정보 선택 shows UMP's privacy options form where one is required, else `LOC_AD_PRIVACY_UNAVAILABLE` (B14). 개인정보처리방침 and 이용약관 open `todayweather.ai/mobile/{privacy|terms}.html` with `.ja` or `.en` for the app's language in the browser (B13). The menu stays open.
- **Crashlytics:** collects crash reports independent of the analytics choice, as the Cordova build did. The Crashlytics Gradle plugin is applied with the Google services plugin when `app/google-services.json` exists (it writes the build ID Crashlytics needs). The app has no native code, so the NDK library of the Cordova build is not included.
- **Popups:** `IonicPopup` is AN-12's Ionic alert with its buttons side by side (5 dp apart, at 0.87 opacity) and the text broken as Chrome breaks it (`chromeLines`); screen readers get the text without those breaks.

Tests:
- `BannerGateTest` and `AnalyticsSchemaTest` (core-domain): the gate with the delay, the kill switch, a page's hiding and the exposure; the Remote Config pair; the event schema.
- `WeatherTelemetryTest` (core-data): the outcomes and durations of `weather_fetch` and `weather_load`.
- `AnalyticsTest`: grant, withdrawal, failed writes, an SDK failure, the start's corroboration, screens and a broken bridge.
- `TwAdsTest` and `AdsConsentTest`: the banner's loads and visibility, a new activity, the Remote Config timeout; the SDK start after consent, with a stored consent, against a decision, and after a UMP failure in release and debug builds; the ad privacy row.
- `PrivacyMenuTest`: the rows, the popup, back, the failure alert, the policy pages per language, the screens reported, and the menu and popups above a banner.
- `PrivacyScreenshotTest`: the menu with 꺼짐 and 동의함 and the popup against `tools/privacy-reference` in Korean and English, and the popup's lines against the capture's line boxes.

The emulator check is `tools/emulator/run-ads-check.sh` (#2894 AC2): online, a banner of Google's test unit loads and shows in its place while the Analytics debug log shows no event; offline, an opt-in through the popup logs `screen_view`, so the first check cannot pass vacuously.

## Data migration from the Cordova app

On every start the app runs `CordovaMigrator` (core-storage); after the first successful run it does nothing. It builds `files/app_state.json` (DataStore, `AppState`) from the Cordova app's storage and leaves that storage unchanged, because the rollback hand-back (AN-17) reads it.

- **Sources, per key:** the WebView's `localStorage` first, then the native suite `group.net.wizardfactory.todayweather`, then for units the old suite `net.wizardfactory.todayweather_preferences`. `localStorage` holds the newest values: the Cordova app writes it first and mirrors it to the suite asynchronously, and on an emulator the suite lost the second of two quick `cities` writes. `localStorage` is read without opening the database: Chromium's LevelDB (`app_webview/Default/Local Storage/leveldb`) by `LevelDbReader`, which follows `CURRENT` and the MANIFEST to the live tables and current logs (so a table left over after a compaction cannot bring back a deleted key) and reads Snappy blocks, or the SQLite file of WebViews before Chromium 61 (`app_webview/Local Storage/https_localhost_0.localstorage`). A key whose value does not parse falls back to the next source.
- **Rules:** those of the Cordova code. `cities` keep their geography, flags and photo (weather caches are dropped; an entry that is not an object keeps its slot as a disabled place so indexes stay aligned; coordinates must be finite and within ±90/±180, otherwise the place is address-only); `cityIndex` follows `loadCities` (out of range or missing: first enabled place); `units` follow `Units.loadUnits` (missing members and `aircn` take the device region's defaults; unknown values too); `settingsInfo` falls back to the standalone `startupPage`/`refreshInterval` keys and then to `0`/`0`/`light`; `pushData2` records are kept as stored (ISO times, `dayOfWeek`, city info) for re-registration (AN-04) when they have integer `cityIndex`/`id`, boolean `enable` and the category's ISO times (real dates and times) and seven-day array, otherwise dropped and counted; records naming no place are kept (anomaly A24); legacy `pushData` alarms convert like `loadOldPushInfo` (local wall time 07:00–22:00 on the migration day, also on daylight-saving days) and set `needsAlertIntro` (O06). `MigrationRunner` never replaces a stored migration. `MigrationInfo` records the source and outcome of every key.
- **Device-Id:** `Settings.Secure.ANDROID_ID`, the value cordova-plugin-device reported, unchanged for the same signing key.
- **Analytics:** off until the user opts in (AN-15). `EarlyStartProvider` runs before `FirebaseInitProvider`, writes the SDK's persisted collection flags off synchronously and then calls `setAnalyticsCollectionEnabled(false)` with every consent type denied; a Cordova opt-in therefore does not carry over. The manifest repeats the Cordova build's analytics defaults.

`tools/leveldb-fixtures` writes the LevelDB test directories with the real LevelDB library (`npm ci && node generate.mjs`).

### Push re-registration

When the app is opened (`MainActivity`; once per open like the Cordova web page, not again for a rotation, and not when the process starts in the background for FCM or WorkManager), it does what the Cordova `Push.init` does (gate G1, push part) after the migration: repair the current-position records and records with a broken location from the place list, replace a changed FCM token on the server (`PUT /v000903/push` with `newToken`/`oldToken`; a first token also posts the list), then post the whole list again (`POST /v000903/push-list`) when a token exists. `PushRegistration` (core-storage) builds the requests like `_makePostObj` (same `Device-Id`, `cityIndex`, `id`, category, times as UTC seconds of day, units, `timezoneOffset`; an alert whose start equals its end ends one local minute earlier, with V8's daylight-saving rules); `corpus/push.json`, generated from the Cordova `Push` service, pins them for a first, an unchanged and a changed token and for New York daylight-saving alerts. `MessagingService.onNewToken` hands a token that changes while the app runs to WorkManager (`PushTokenWorker`), which keeps it until it runs, in a later process if this one ends; tokens queue in order of arrival. `PushSync` (core-data) runs registrations one at a time (read the stored state, send, store the token), so tokens B then C are replaced A→B, B→C. As in the Cordova app, failed requests are not retried and the token is stored anyway; the next open posts the list with it. Requests go to `TW_SERVER_URL` (a private input: environment variable or `android/private.properties`); without it the app sends nothing. Device tests run with `TestRunner`, whose application records push requests instead of sending them.

### Upgrade test (emulator)

```sh
cd android && ./gradlew assembleDebug assembleDebugAndroidTest
ANDROID_SERIAL=emulator-5554 tools/upgrade/run-upgrade-test.sh <cordova-1.1.1-debug.apk> [out-dir] [token-a|token-b]
```

The Cordova debug APK must be signed with the same debug key (`client/`: `npx cordova prepare android && npx cordova compile android --debug`, with the private inputs). The script takes the emulator offline, installs the Cordova APK, seeds places, units, settings, alarms and an analytics opt-in through the app's own services over WebView DevTools (`seed-cordova.mjs`), installs this build over it and runs `CordovaUpgradeTest` twice (first start with an app open, restart). The seed stores the FCM token `token-a`; the native app gets `token-a` (unchanged: only the list is posted) or `token-b` (changed: replacement, then the list), and every migrated record must be registered once with the same `Device-Id`. `PushTokenWorkTest` then runs in two instrumentations without opening the app: a token `token-c` arrives and its `PUT` stays in flight (`transport hold`) until the end of the instrumentation kills the process; the next process completes the stored work (`PUT` with the previous token as `oldToken`, token stored). `EntryIntentTest` (`migration hold`) opens the app with the launcher intent and a notification tap while the migration is held and checks that both are handled after it, in order. Last, the launcher intent of the Cordova home-screen shortcut (`MAIN`/`LAUNCHER` for `.MainActivity`) must resolve to and open the native activity. It fails if any analytics event is logged after the update, and, so that this cannot pass vacuously, if the Cordova opt-in or the SDK's enabled flag is missing before the update or the native APK has no Firebase configuration. It refuses a non-emulator `ANDROID_SERIAL` and a device that still has a network. On every exit (pass, failure, interruption) it uninstalls both packages before it restores the network; if they cannot be removed, or the package query fails or answers with anything but a package list, the emulator stays offline (exit 5). `tools/upgrade/test-cleanup.sh` checks that cleanup with an adb test double (no device; also run in CI).

## Private inputs

Private inputs stay out of Git, docs and logs, as in the Cordova build (`npm run release:fetch`). Later sub-issues add them by name only:

- `app/google-services.json`: Firebase configuration for the existing project (push, analytics, Crashlytics, Remote Config). The build applies the Google services plugin only when the file exists; without it Firebase stays uninitialized and the app runs with analytics off.
- `TW_SERVER_URL` and `TW_WEATHER_PHOTOS_URL` (environment or `android/private.properties`): the legacy server and the weather photo feed. Without them the app makes no requests to them; without the feed the photo theme shows no photo, as Cordova builds from the template configuration.
- `TW_MAIL_TO` (environment or `android/private.properties`): the feedback address of 의견보내기, `mailTo` of the Cordova build's `client.config.js`. Without it the mail opens without a recipient.
- `TW_ADMOB_APP_ID_ANDROID` and `TW_ADMOB_BANNER_ANDROID` (environment or `android/private.properties`): the AdMob application ID and banner unit of release builds, as the Cordova release build reads them from `client/.env`. Packaging a release (`packageRelease`, `bundleRelease`) fails without them or with Google's sample IDs. Debug builds always use Google's sample application ID and test banner unit.
- Release signing inputs (AN-19).

The build and the unit tests run without them.

## Version

`versionCode` 200000 and `versionName` 2.0.0 keep the native debug build installable over the Cordova 1.1.1 build (100091). AN-19 sets the release value above every active Play track.
