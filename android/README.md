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
- **Side menu (S06):** full screen, sliding in over 200 ms, rows in Cordova order with the Korea-only rows for region KR, the analytics, ad privacy, policy and terms rows as blocks; AN-12, AN-13 and AN-15 connect the rows.
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

- **Requests and cache (`core-data`):** `WeatherRequests` builds the URL of `getWeatherByGeoInfo`: `/weather/v000903/coord/{lat},{long}` when the latitude is truthy, else for an address the KMA town route `/v000903/kma/addr/…` or the free-form `/weather/v000903/addr/{address}`, which the server answers with 501. The units query follows `Units` with `airForecastSource=kaq`, and `Accept-Language` is the device's languages in Chrome's form; `corpus/requests.json` pins the URLs from the Cordova code. Attempts follow `_retryGetHttp`: another 2 s later while none has answered, up to three, 10 s each; the first to settle decides and the others are cancelled. `WeatherRepository` keeps each place's weather by place (current position, coordinates or address) in memory and in `files/weather/`, so a cold start shows the last weather while it loads. A response applies to the place that asked for it (A01 fixed); only the latest request of a place counts (an older answer, a failure included, counts for nothing) and answers are stored one at a time; fields a response leaves out keep their value (A02); the ten-minute gate lives in memory. `AppStateHolder` is the store's only writer after the migration: the screens' changes show at once, PushSync's token updates go through it too (`dataStore`), and one writer saves everything in the order it was asked for; the screens see the last saved state with their unsaved changes on top.
- **Loading (`WeatherSession`):** TabCtrl's `loadWeatherData` and its reload senders. Opening the app, a tap on the selected Hourly, Daily or Air tab and the retry button load at once; a return to the foreground waits for the gate. Swipes on the header and its arrows move between places as WeatherInfo does (`PlaceIndex`, checked against the Cordova code) and load through the gate. The refresh interval restarts with every load. A failure opens the retry confirmation (O03: 오류, 날씨 정보를 가져오지 못하였습니다, 닫기/확인), which holds other reloads until it is answered. What a response changes in its place (the current position's name, country, address and location, a saved place's missing location, the source) and a photo chosen from the feed are saved; places without a photo get one when the feed arrives. The current position's own lookup comes with AN-10.
- **Pages:** `ForecastScope` (`core-domain`) is ForecastCtrl's scope for one visit: it opens when the tab opens and applies the selected place whenever it changes, with the controller's early returns and the values an apply leaves from an earlier place (the source only when the new place has one, as anomaly 2 of screen-element-bindings.md; the photo of the last place that had one). `corpus/forecast.json` runs the controller itself for 29 visits of both pages. `ForecastPage` renders the scope as the templates do: header, hourly and daily AQI tables, current air, detail weather and AQI rows (`toFixed`, the zero and undefined rules, HTML white space), the three days of S04, the legacy dust rows, the pollen popup and the attribution; `ForecastPageTest` compares it with the text, images and grade colors of the Cordova pages. `WeatherPage` (`app`) draws it. Its line boxes follow the WebView's font metrics (`CssMetrics`: Roboto and the Korean fallback font, ascent and descent rounded to device pixels) and its text uses unhinted advances (`TextMotion.Animated`), so the blocks have the Cordova heights and text ends where the WebView's does. Card and chart colors follow the theme: light, dark, old, and photo with the photo under the header and the bar darkening as the page scrolls.
- **Bar:** the place's name, the current position's location glyph (it opens the location settings when location is off) and, while the place loads, the spinner, white as in the Cordova app and so hidden by the light theme's white bar (A08, kept). The bell, share, air, units and source links reach their pages with AN-14, AN-16, AN-09 and AN-12; the source link shows its description.
- **Text size:** text follows the font scale. The charts are drawn to columns of a seventh of the screen, so they zoom as a whole: their text grows with the scale and keeps its room, and the chart scrolls further.

Tests: `ForecastScopeTest` and `ForecastPageTest` (core-domain), `WeatherRequestsTest`, `WeatherRepositoryTest` and `WeatherSessionTest` (core-data), `ForecastScreenshotTest` (every block of both pages for Seoul and London against captures of the Cordova build at 384×832, within recorded tolerances; see [`tools/forecast-reference`](tools/forecast-reference/README.md)), `WeatherTabTest` (places, swipes and arrows, tab reload, spinner, retry, pollen popup, expander, a late response) and `ForecastFitKoTest`/`ForecastFitEnTest` (phone, small window and tablet at font scale 1.3: no text cut). Against the production server on an emulator, with read-only weather requests and push requests recorded by the test app:

```sh
cd android && ./gradlew assembleDebug assembleDebugAndroidTest   # with TW_SERVER_URL
ANDROID_SERIAL=emulator-5554 tools/emulator/run-production-weather.sh [out-dir]
```

It needs a network, captures Seoul and London on both pages (`ProductionWeatherTest`), and uninstalls both packages on every exit; when that cannot be confirmed it takes the emulator offline and exits 5 (`tools/upgrade/test-cleanup.sh` checks this with an adb test double).

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
- AdMob application ID and ad unit IDs for release builds. Debug builds use Google's test units.
- Release signing inputs (AN-19).

The build and the unit tests run without them.

## Version

`versionCode` 200000 and `versionName` 2.0.0 keep the native debug build installable over the Cordova 1.1.1 build (100091). AN-19 sets the release value above every active Play track.
