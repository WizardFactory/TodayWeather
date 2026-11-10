# Plan: Android-native TodayWeather app (#2877)

Consumes the [intent](../intent/android-native.md) and [spec](../specs/android-native.md). One pull request per sub-issue, merged after a cross-provider review PASS and CI. Each PR updates this plan with its section.

## Task graph

| ID | Issue | Scope | Blocked by |
| --- | --- | --- | --- |
| AN-01 | #2880 | project skeleton, imported assets and CI | – |
| AN-02 | #2881 | golden corpus and Kotlin weather core (G3) | AN-01 |
| AN-03 | #2882 | Cordova data migration and upgrade test (G1, state) | AN-01 |
| AN-04 | #2883 | push re-registration after the update (G1, push) | AN-03 |
| AN-05 | #2884 | hourly and daily charts (G2) | AN-02 |
| AN-06 | #2885 | spike review, re-estimate and decisions | AN-02..AN-05 |
| AN-07 | #2886 | app shell, navigation, themes, languages, launch continuity | AN-06 |
| AN-08 | #2887 | weather data layer and S03/S04 | AN-07 |
| AN-09 | #2888 | air quality S05 | AN-08 |
| AN-10 | #2889 | start screen, location and place search | AN-08 |
| AN-11 | #2890 | saved places S02 | AN-10 |
| AN-12 | #2891 | settings and menu hand-offs | AN-08 |
| AN-13 | #2892 | nationwide weather, air and warnings | AN-08 |
| AN-14 | #2893 | notification settings and alarms | AN-11 |
| AN-15 | #2894 | ads, analytics consent and crash reporting | AN-07 |
| AN-16 | #2895 | sharing, entry links and backup | AN-08 |
| AN-17 | #2896 | rollback hand-back to the Cordova app | AN-14 |
| AN-18 | #2897 | parity verification and large screens | AN-09, AN-12..AN-16 |

AN-19 (#2898) is out of scope for this run.

AN-18 also delivers the native app's user manual with screenshots of the implemented screens: `docs/user/android-app/` (`manual.json`, `manual.pdf`, `screenshots/`, provenance), with the sections of `docs/user/cordova-app` ([decision on #2897](https://github.com/WizardFactory/TodayWeather/issues/2897#issuecomment-6716907228)).

## AN-01 — project skeleton, imported assets and CI (#2880)

Design skipped: no system flow; the module layout is fixed by #2877. Archify not applicable (no structure diagram changes; the service overview gains the Android client in AN-19).

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN01-US1 | Developer builds and tests the app | JDK 17, Android SDK | `cd android && ./gradlew assembleDebug test` | Debug APK and passing tests | Missing SDK platform: AGP installs it or the README names it | AC1 |
| AN01-US2 | Maintainer refreshes translations after a `client/` change | Full Git history | Run the import tool; commit | Changed catalogs and updated provenance; unchanged inputs give no diff | Unsupported catalog key or `town.js` format: the tool stops with the key | AC2 |
| AN01-US3 | Reviewer confirms the build does not read `client/` | CI | CI job deletes `client/` and builds | Build and tests pass | A reference into `client/` fails the job | AC1 |
| AN01-US4 | Tester starts the app on an emulator | API 36 emulator | Install the debug APK, open it | The app opens without a crash | – | AC3 |

### Acceptance (from #2880)

- AC1: `./gradlew assembleDebug test` passes locally and in both CI jobs, including the job without `client/`.
- AC2: Re-running the import tool produces no diff; provenance lists every copied file with source path, commit and SHA-256.
- AC3: The debug APK installs and starts on an API 36 emulator.
- AC4: README, artifact checker, review PASS and CI before merge.

### Files

`android/` (Gradle wrapper, version catalog, modules, `tools/import_client_assets.py`, imported assets, provenance, README), `.github/workflows/android.yml`, these intent/spec/plan documents.

### Checks

Test-first: `ImportedClientAssetsTest` failed before the import (missing catalogs and provenance) and passed after it. Smoke: install and launch on an API 36 emulator; build and test in a copy without `client/`; import tool run twice with no diff.

## AN-02 — golden corpus and Kotlin weather core (#2881)

Design: the response passes through as `kotlinx.serialization` JSON trees, as the Cordova code passes objects through; `Js` reproduces JavaScript truthiness, comparison and number formatting so decisions match exactly. The comparison is exact on the whole converted object. Archify not applicable (no system structure change).

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN02-US1 | Maintainer regenerates the corpus | Node 22, checkout with `client/` | `node android/tools/corpus/generate.mjs`; `git diff` | No diff without source changes | A Cordova change shows as a corpus diff in CI | AC1 |
| AN02-US2 | Developer checks the Kotlin core | JDK 17 | `./gradlew :core-domain:test` | Every conversion and function case matches | A mismatch names the case and JSON path | AC2 |
| AN02-US3 | Reviewer checks coverage | – | Read `tools/corpus/README.md` | Each client verification-matrix row maps to cases | A missing row is visible | AC3 |
| AN02-US4 | AK decides at AN-06 | – | Read `tools/corpus/differences.md` | Each difference has evidence and a status | – | AC4 |
| AN02-US5 | Maintainer delivers | PR | Checker, CI, review, merge | Green and PASS | Findings corrected | AC5 |

### Acceptance (from #2881)

AC1 regeneration without diff; AC2 JVM corpus tests pass in both CI jobs; AC3 coverage table; AC4 `differences.md` with evidence; AC5 delivery.

### Checks

Test-first: `GoldenCorpusTest` against `TODO()` stubs failed (3/3), then passed. Smoke: regeneration twice with no diff; `client/`-free build from a `git archive`.

Review round 1 (F1–F5) added the air display rules, the nationwide and warning functions, the real TabCtrl completion for A01, null-row handling (Red: removing it fails `kma-null-daily-row`) and the `core-model` views; `GoldenCorpusDisplayTest` and `ModelsTest` cover them. Round 2 (F2, F6, F7) added unit-variant value cases, time-boundary and invalid-date cases, `UpdateTime`, `java.util`-based warning formatting, and `CoreOnDeviceTest` run on API 24 and API 36 emulators. Round 3 (F2, F7) added pressure and distance fields to the value cases and V8's ISO date range rules.

## AN-03 — Cordova data migration and upgrade test (#2882)

Design decision: read the WebView `localStorage` as the first source, because the suite mirror lost a write on the emulator (two quick `cities` writes; the suite kept the first). Reading is file-based and read-only (LevelDB logs/tables with Snappy, or the pre-Chromium-61 SQLite file), so the Cordova data stays intact for AN-17. Analytics: SDK collection flags are written off before `FirebaseInitProvider`; calling only `setAnalyticsCollectionEnabled(false)` left the persisted flag on (the process ended before the asynchronous write) and the SDK logged `app_update`. Archify not applicable (no system flow change beyond the app's own start).

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN03-US1 | Cordova user updates to the native app | Cordova 1.1.1 with places, units, settings, alarms, analytics opt-in | Install the native update; open it; reopen it | Same places, selection, units, settings and alarms; `Device-Id` unchanged; no analytics event; Cordova data still present | A missing or broken key takes the Cordova default, recorded in `MigrationInfo` | AC1, AC2 |
| AN03-US2 | Cordova user whose suite missed a write | Suite older than localStorage | Update | Newest localStorage values win | Unparsable localStorage value falls back to the suite | AC1 |
| AN03-US3 | User of a pre-`pushData2` version | Legacy `pushData` only | Update | Alarms converted as the Cordova app does; alert introduction pending | – | AC1 |
| AN03-US4 | Maintainer runs the upgrade test | Emulator, Cordova and native debug APKs | `tools/upgrade/run-upgrade-test.sh` | Both instrumentation runs pass; 0 analytics events | Online emulator or physical device: the script refuses | AC2 |

### Acceptance (from #2882)

- AC1: JVM tests cover valid, partial, malformed, legacy-suite and legacy-`pushData` inputs; a second migration run changes nothing.
- AC2: the emulator upgrade test passes (places, `cityIndex`, units, settings, alarms, `Device-Id`, analytics off after restart, sources kept).
- AC3: delivery (README, review PASS, CI, merge).

### Checks

JVM: `CordovaMigrationTest` (10), `LevelDbReaderTest` (5, files written by a test writer). Device: `run-upgrade-test.sh` on API 36 (LevelDB) and API 24 (SQLite localStorage) emulators. Smoke: debug build without the Firebase configuration starts with analytics off.

Review round 1 (F1–F8): slots kept for broken city entries, coordinate validation and serialization, MANIFEST-based LevelDB reading with real-LevelDB fixtures, wall-time `secs2date`, locale-independent number formatting (also in AN-02's warning times), push record validation, the upgrade test's preconditions (negative run exits 4 without the Firebase configuration), and `MigrationRunner` with a JVM re-run test. Round 2: record times must be real dates (non-lenient check); the LevelDB fixtures keep a non-empty write-ahead log.

## AN-04 — push re-registration after the update (#2883)

Design: `PushRegistration` reproduces `Push.init`/`loadPushInfo`/`_makePostObj` as pure Kotlin. `PushSync` (`core-data`) runs registrations one at a time: read the stored state, send, store the token. The app runs the start registration after the migration when it is opened (`MainActivity`, once per open as the Cordova web page; not for a process started in the background), with an FCM token (`FirebaseTokenSource`) and an HTTP transport. `MessagingService.onNewToken` hands a token to WorkManager (`PushTokenWorker`, one unique chain), so the replacement completes after the process ends. The server URL is a private build input. Device tests swap token and transport in `TestTodayWeatherApp` (androidTest), so no test sends anything and the app has no test mode. Path version `v000903` (decision 2, AN-06 confirms).

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN04-US1 | Cordova user with alarms updates; token unchanged | Migrated records, stored token | Open the native app | One `POST /v000903/push-list` with every record once, same `Device-Id` | Server unreachable: no retry until the next start (as Cordova) | AC1, AC2 |
| AN04-US2 | Same user; FCM token changed | Stored token differs | Open the app | `PUT /v000903/push` (new/old token), then the list; stored token updated | – | AC1, AC2 |
| AN04-US3 | Maintainer | Emulator, APKs | `run-upgrade-test.sh … token-a` and `… token-b` | Both pass; requests recorded, none sent; both packages removed before the network returns | Preconditions missing: exit 4; interrupted or failed run: packages removed, then network restored | AC2, AC3 |
| AN04-US4 | User whose FCM token changes twice while the app runs | Stored token A | FCM delivers B, then C | `PUT` A→B, then B→C; stored token C | The process ends before the work runs: a later process completes it | AC1, AC2 |
| AN04-US5 | User in a daylight-saving zone with an alert whose start equals its end | New York, record at a transition | Open the app | End time one local minute earlier, as `setMinutes` in V8 | – | AC1 |

### Acceptance (from #2883)

- AC1: unit tests compare the native requests (path, headers, body) with the Cordova app's for first, unchanged and changed tokens.
- AC2: the emulator upgrade test passes for both token cases; every migrated record registered once with the same `Device-Id`; no request reaches the production push server.
- AC3: delivery.

### Checks

JVM: `PushRegistrationTest` (Cordova goldens: first, unchanged, changed token, air unit, no token, New York daylight-saving alerts), `PushSyncTest` (B then C with a held transport; a token during the start registration), `HttpPushTransportTest`. Device: `run-upgrade-test.sh` for `token-a` and `token-b` on API 36 and `token-b` on API 24, including `PushTokenWorkTest` (token work interrupted with its `PUT` in flight by the end of the process, completed by the next process without an app open). Script cleanup: success, interrupted (TERM) and failed runs leave neither package installed and restore the network; `test-cleanup.sh` (adb test double, CI) keeps the device offline with exit 5 when the package query fails (also after partial output), answers with anything but a package list, or still lists a package.

Review round 1 (F1–F5): cleanup before the network returns on every exit; registrations serialized; token work in WorkManager; local-time end-minute decrement with V8's daylight-saving rules; `service.push.js` in the CI path filters. Also corrected: the start registration ran on every process start, including background starts for FCM; it now runs when the app is opened. Round 2 (F1): a failed or unreadable package query no longer counts as removed. Round 3 (F1): the query's exit status and the whole answer are checked.

## AN-05 — hourly and daily charts (#2884)

Design: `core-domain` `chart/` builds each chart as the SVG its Cordova directive draws (`Svg`, D3 v3 arithmetic, `ChartMetrics` from the screen size, header labels, legend texts and the opening offset from `ChartPosition`). `app` `ui/chart/` draws the scenes with Compose (`HourlyChartView`, `DailyChartView`), light theme only (themes are AN-07); the expander reports to the caller, and the screen (AN-08) keeps `expandShortChart`. References come from the Cordova debug build on the emulator (`tools/chart-reference/capture.sh`, sharing the offline guard with the upgrade test in `tools/emulator/offline.sh`) and live under `core-domain/src/test/resources/chart-reference/` with provenance and per-comparison tolerances. Robolectric renders the screenshots (SDK 34; SDK 36 needs Java 21). Archify not applicable (app-internal component, no service structure or flow change).

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN05-US1 | User checks the hourly forecast | Weather loaded | Open the forecast | The chart opens with the current hour in the second column. Day and hour labels, lines for today and yesterday, value circles, the current-temperature dots, icons, rain chance and amount and the pinned legend appear as in Cordova | Missing values are drawn as Cordova draws them (empty text, no image) | AC1, AC2 |
| AN05-US2 | Same user looks back and ahead | Hourly chart shown | Scroll to both ends | The first and last columns are as in Cordova | – | AC2 |
| AN05-US3 | User reads wind and humidity | Hourly chart shown | Tap the expander | Wind direction and speed rows and humidity rows appear; tapping again hides them | – | AC1, AC2 |
| AN05-US4 | User checks the coming days | Weather loaded | Open the daily forecast and scroll | Today is in the third column. Weekday and date, morning and afternoon icons, rain chance and amount, bars on one scale and today's dot appear as in Cordova | – | AC1, AC2 |
| AN05-US5 | Maintainer refreshes the references after a Cordova chart change | Emulator, Cordova debug APK | `check-sources.mjs` fails; run `capture.sh`, `device-smoke.sh`, `./gradlew test` | New references and provenance. The emulator is offline while the build is installed, and the network and display are restored afterwards | Non-emulator serial or a network that stays up: refused | AC2, AC3 |

### Acceptance (from #2884)

- AC1: the scenes match the Cordova SVG, labels, legend and opening offsets for every captured fixture and size (`ChartSceneTest`).
- AC2: screenshot comparisons pass at 384×832, 360×780 and 412×892 within recorded tolerances at the opening position and both scroll ends (`ChartScreenshotTest`). References and provenance are under `android/`, and the tests run in both CI jobs.
- AC3: delivery (README, review PASS, CI, merge).

### Checks

JVM: `ChartSceneTest` (15 fixture-size captures, element by element), `ChartScreenshotTest` (18 comparisons), `ChartBehaviorTest`. Device: `device-smoke.sh` on API 36 (18 comparisons with the emulator's fonts). CI: `check-sources.mjs` in the job with `client/`.

## AN-06 — spike review, estimate and decisions (#2885)

Decision record, no code. Gates G1 (AN-03, AN-04), G2 (AN-05) and G3 (AN-02) pass; evidence on #2885 (https://github.com/WizardFactory/TodayWeather/issues/2885#issuecomment-6718290519). AK's decisions, the estimate for AN-07 to AN-18 (about 42–64 agent hours) and the open place-search decision are in #2877: https://github.com/WizardFactory/TodayWeather/issues/2877#issuecomment-6718290258.

- Go for AN-07 to AN-18 now, in task-graph order; no budget set; AN-19 excluded.
- `v000903` for every call. Cordova anomalies are kept unless AK approves a fix; A01 is the fix (AN-08). A24, the 12:00 AM picker deleting the alarm, the weather-address 501 and D37 are kept.
- Text follows the system font scale, verified up to 1.3 (AN-18). Cordova Android receives fixes only.
- Open, blocking AN-10 only: Places SDK for Android or Places web service (key restriction, billing, usage measured in the Google Cloud console). Recommended: the Places SDK for Android with an Android-restricted key in the same project.

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN06-US1 | AK decides whether to continue | Gates merged | Read #2885 and #2877 | Gate evidence linked; decisions, estimate and the open item with the sub-issue it blocks | A failed gate keeps #2885 open | AC1, AC2 |
| AN06-US2 | Implementer of a later sub-issue | #2877 decision comment | Look up a decision | Each decision has a value or names the sub-issue it blocks | – | AC2, AC3 |

### Acceptance (from #2885)

- AC1: the gates pass, with their evidence linked from #2885.
- AC2: #2877 has the decision comment (go, priority, budget, estimate, each decision; an open decision names the sub-issue it blocks).
- AC3: delivery (plan and intent updated, review PASS, CI, merge).

## AN-07 — app shell, navigation, themes and languages (#2886)

Design (survey: `reports/sdlc/android-an-07/shell-survey.md`, from the Cordova templates, controllers and SCSS):

- `core-domain` `shell/`: `AppLanguage` (the first system locale picks one of the six catalogs as angular-translate does: en, de, ko, ja, zh-CN, zh-TW; zh-HK and zh-TW to zh-TW, other zh to zh-CN, else en) and the region (last part of the first locale with a region, default KR) that shows the Korea-only menu rows; `Theme` (light, dark, photo, old) with the icon and weather image folders of `theme.js`; `StartupPage` ("0" hourly, "1" daily, "2" locations, "3" air, others hourly); `WeatherPhotos` (the photo feed grouped by tags and chosen per sky icon as `service.weatherutil.js` does, checked against goldens from the Cordova code).
- `app` `ui/shell/`: the bottom tab bar (Locations, Hourly, Daily, Air; the selected weather or air tab shows the refresh glyph and reports a refresh, a second tap within 700 ms does nothing; items up to 150 dp, centered on wide windows), the header bar (44 dp, menu button, title centered clear of the wider button group as Ionic's `calcWidths` places it, actions), the full-screen side menu (200 ms slide; rows in Cordova order, rows 1–4 only for region KR; AN-12, AN-13 and AN-15 connect the rows), dialogs, and the exit confirmation on a main tab (`LOC_DO_YOU_WANT_TO_EXIT`). Geometry follows Ionic as measured on the Cordova screen: half-pixel bar hairlines, icon buttons with a transparent 1 dp border at 0.87 opacity, menu row edges on device pixels, and text on the baseline of its own font as Chrome places it when a fallback font draws Korean. Theme colors come from the Cordova SCSS per theme and page (the old theme colors Hourly and Daily; the photo theme's weather headers are clear with outlined text). Edge-to-edge with the Cordova status bar color and light icons, side insets kept clear, a reserved slot under the tab bar for the AN-15 banner, and the content width following the window (600 dp and wider included).
- Glyphs and icons: Ionicons 2.0.1 (from the Cordova build's Ionic 1.3.5, MIT) and Material Icons (`client/www/fonts`, Apache 2.0) as fonts, and the Cordova launcher and splash icons (`client/tw.resources`), all with provenance.
- Language: the activity applies the AppLanguage locale to its resources. Text follows the system font scale (AN-06); glyphs and the bars' fixed lines (44 dp title, 42 dp blocks) keep their size, the tab bar and menu rows grow, a tab label too long for its item wraps onto a second line, and a menu value that no longer fits beside its label moves under it.
- Launch: the launcher keeps the Cordova component name `net.wizardfactory.todayweather/.MainActivity` (so home-screen shortcuts keep working without an alias), `singleTop`; the splash screen stays until the migration finishes, and entry intents (launcher, notification taps) wait for it.
- Photo theme: `TW_WEATHER_PHOTOS_URL` (private input, like the server URL; without it no photo, as in Cordova builds from the template config). `WeatherPhotoFeed` (core-data) loads it when the app opens and when a network comes back, with `_retryGetHttp`'s attempts (another 2 s later while none has answered, up to three, 20 s each; the first to answer decides and the others are cancelled), shared while it runs and kept once per process after a success. Hourly and Daily show the chosen photo behind the header block (AN-08 fills the block and chooses each place's photo on its weather updates).

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN07-US1 | User moves between tabs | App open | Tap each tab; tap the selected Hourly tab | Tab content switches; the selected weather or air tab shows the refresh glyph and a tap asks for a refresh | Second tap within 700 ms does nothing | AC1 |
| AN07-US2 | User starts on the chosen page | Startup page set to daily | Open the app | The Daily tab is selected | Unknown value: Hourly | AC1 |
| AN07-US3 | User opens the menu and leaves | App open | Tap the menu button; press back | Menu slides in with the Cordova rows (KR rows for region KR); back closes it | – | AC1, AC2 |
| AN07-US4 | User leaves the app | Main tab, no dialog | Press back; Cancel; back; OK | Exit question; Cancel keeps the app; OK closes it | Back on a dialog closes only the dialog | AC1 |
| AN07-US5 | User switches theme and language | Theme set; system language English | Open the app | Colors and images of the theme; English texts | Unsupported language: English | AC2 |
| AN07-US6 | Tablet or foldable user resizes and rotates | Large screen emulator | Resize, rotate, multi-window | Nothing clipped; tab bar and header adapt | – | AC3 |
| AN07-US7 | Cordova user updates | Home-screen shortcut to the Cordova app | Update; tap the shortcut; a notification tap during the migration | The native app opens; the entry intent is handled after the migration | – | AC4 |
| AN07-US8 | Maintainer refreshes the shell references after a Cordova shell change | Emulator, Cordova debug APK | `check-sources.mjs` fails for the shell; run `tools/shell-reference/capture.sh`, `./gradlew test`, `tools/large-screen/run-shell-fit.sh` | New references and provenance; tests pass within the recorded tolerances. The emulator is offline while an app is installed; network, display, rotation and navigation are restored | Non-emulator serial or a network that stays up: refused | AC2, AC5 |

### Acceptance (from #2886)

- AC1: UI tests pass for tab switching, the startup-page setting, opening and closing the menu, back on a dialog and the exit confirmation.
- AC2: screenshot tests cover the shell in each theme, in Korean and English (with Cordova comparisons of the tab bar, header bar and menu).
- AC3: on tablet and foldable emulators, resizing and rotating leave no clipped content.
- AC4: after an update from the Cordova build on an emulator, the existing home-screen shortcut opens the native app, and an instrumented test shows an entry intent arriving during the migration is handled after it finishes.
- AC5: delivery (README, review PASS, CI, merge).

### Checks

JVM: `ShellLogicTest` (languages, region, themes, startup page; `corpus/photos.json` from the Cordova code: two feeds' groups and 195 choices), `WeatherPhotoFeedTest`, `ShellTest`, `EntryIntentsTest`, `ShellScreenshotKoTest`/`ShellScreenshotEnTest` (24 comparisons: tab bar, header and menu in four themes against screen captures of the Cordova build, `tools/shell-reference`; recorded tolerances and measured sensitivity), `ShellFitKoTest`/`ShellFitEnTest` (22 cases: eight windows from 320×480 to 1280×800 dp and three of them at font scale 1.3, in Korean and English) and `ShellFitJaTest`/`DeTest`/`ZhCnTest`/`ZhTwTest` (the three narrowest cases each). The references are cut from the screen: DevTools screenshots drew the English menu's rows 2.5 dp shorter than the layout and the screen. CI: `tools/emulator/check-sources.mjs` covers the chart and shell sources. Emulators: `tools/large-screen/run-shell-fit.sh` (`ShellFitDeviceTest` while the display rotates, shrinks to a split-screen half and folds; gesture and three-button navigation) on a Pixel Tablet and a Pixel Fold API 36 image; `tools/upgrade/run-upgrade-test.sh` with `EntryIntentTest` and the launcher-shortcut check on API 36 and API 24. Archify not applicable (app-internal UI, no service structure or flow change).

## AN-08 — weather data layer and weather screens S03, S04 (#2887)

Design (survey: `reports/sdlc/android-an-08/forecast-survey.md`, from `service.weatherutil.js`, `service.weatherinfo.js`, `controller.tabctrl.js`, `controller.forecastctrl.js`, the two templates and the SCSS):

- `core-data` requests: the route of `getWeatherByGeoInfo` (coordinates when `location.lat` is truthy, A05 kept; else the address with `대한민국 ` added, split into the KMA town route `/v000903/kma/addr/{first}[/{second}][/{third}]`, or the free-form `/weather/v000903/addr/{address}`, which answers 501), `/weather/v000903/coord/{lat},{long}`, the units query in `Units.getAllUnits()` order plus `airForecastSource=kaq`, and `Accept-Language` from the app's languages in Chrome's form (`ko-KR,ko;q=0.9,…`), since the WebView sent its default header and the gateway reads it. Attempts follow `_getHttp`/`_retryGetHttp` (another 2 s later while none has answered, up to three, 10 s each, the first to settle decides; the others are cancelled); one HTTP client serves the weather and the photo feed.
- `core-data` `WeatherRepository`: each place's weather in memory and in a file cache, so a cold start shows the last data while it loads (Cordova saved the weather with the city). A response applies to the place that requested it (A01 fix): it is keyed by the place (current position, coordinates or address), and only the latest request of a key applies. The rest is Cordova's: `updateCity` keeps old fields a response omits (A02), the current-position slot takes the response's name, country, address and location, the ten-minute gate lives in memory only, and a failure keeps the cached data. Loads: app open, re-tapping the selected weather tab and the retry button bypass the gate; resume and switching places are gated; the refresh-interval timer restarts with every load.
- `core-domain` `Forecast`: the values of ForecastCtrl for S03 and S04 from the converted place (hero temperature with `getTemp`, summary, yesterday text, update time, the S03 hourly and daily AQI lists, the detail weather and air rows with the Cordova formatting, the three-day details of S04, the pollen popup rows, attribution), checked against goldens generated from the Cordova controller code.
- `app` screens: S03 and S04 as the shell's Hourly and Daily pages: the header block (photo box in the photo theme, arrows with more than one place, temperature, sky icon, summary and air summary), the hourly chart with the expander (`expandShortChart`) and the daily chart (AN-05), the air and detail cards, the pollen popup, attribution; the title with the place name, the current-position glyph and the loading spinner, the bell and share buttons (AN-14 and AN-16 open their pages); swiping or the arrows switch places; the retry confirmation (O03: 오류, 날씨 정보를 가져오지 못하였습니다, 닫기/확인). Card and chart colors per theme from the SCSS.
- Kept for later sub-issues: the current position's own lookup (AN-10), the pages behind the bell, share, air summary and units links (AN-14, AN-16, AN-09, AN-12), and S08's reload of all places (AN-12 calls the repository).
- Screenshot references: "manual pages 3–9" are the states those pages show (S03 at the top and in its details, S04, and both charts at their ends). The manual's images are live data at 411 dp, so the comparison uses captures of the same states from the Cordova build at 384×832 with corpus fixtures (`tools/forecast-reference`, like the chart and shell references); the charts' ends are covered by the AN-05 references.
- As built: `ForecastScope` is ForecastCtrl's scope per visit (checked against the controller run under Node, `corpus/forecast.json`), `ForecastPage` the templates, `WeatherSession` TabCtrl's loading, `PlaceIndex` WeatherInfo's place selection. The spinner follows the selected place's request (with A01 fixed, a request for another place no longer shows on this one); it stays white, hidden by the light bar (A08 kept). The stale attribution of a place without a source is kept (screen-element-bindings.md anomaly 2). Line boxes follow the WebView's font metrics rounded to device pixels (`CssMetrics`), which also corrects the AN-05 chart header rows (their tolerances re-recorded lower); text uses unhinted advances. The charts zoom with the font scale as a whole (their columns come from the screen width), so their text follows the scale and keeps its room. The repository stores one answer at a time and an older answer, a failure included, counts for nothing; `AppStateHolder` is the store's only writer after the migration (PushSync writes through it) and shows the last saved state with the unsaved changes on top; a change whose save fails stays and is saved with the next write (review rounds 1 to 4). The refresh timer lives with the app open (`OpenedModel`), as TabCtrl did; a return to the foreground is any resume after the first. Dialogs use the shell's Material dialog, as the exit question does.

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN08-US1 | User checks a Korean place's weather | Seoul saved, network | Open the app | S03 shows temperature, sky, summary, comparison with yesterday, the hourly chart, air and detail cards as Cordova | Server fails: cached data stays and the retry confirmation offers 확인 to load again | AC1, AC2, AC3 |
| AN08-US2 | User checks the coming days | Weather loaded | Open the Daily tab | S04 shows the daily chart, air forecast and the three-day details | – | AC2, AC3 |
| AN08-US3 | User checks an overseas place | London saved | Open the app, switch to London | S03 and S04 show London's data without Korean-only cards; Visual Crossing attribution | – | AC2 |
| AN08-US4 | User switches places while one is loading | Two places, slow network | Swipe to the other place before the response arrives | Each place shows its own weather (A01 fixed) | – | AC1 |
| AN08-US5 | User refreshes | Weather shown | Tap the selected Hourly tab; wait for the refresh interval; reopen within ten minutes | A tap and the timer load again; reopening within ten minutes does not | – | AC1 |
| AN08-US6 | User with an old address-only place | Place without coordinates | Open the app | The KMA town route loads it; a free-form address gets the server's 501 and the retry confirmation | – | AC1 |
| AN08-US7 | Maintainer refreshes the forecast references after a Cordova change | Emulator, Cordova debug APK | `check-sources.mjs` fails; run `tools/forecast-reference/capture.sh`, `./gradlew test` | New references and provenance; the emulator is offline while an app is installed and restored afterwards | Non-emulator serial: refused | AC3, AC4 |

### Acceptance (from #2887)

- AC1: unit tests cover request paths and versions, unit parameters, `Accept-Language`, attempts and timeouts, late responses per the A01 decision and the refresh gate.
- AC2: on an emulator against production, S03 and S04 render for Seoul and London.
- AC3: screenshot comparisons of the states on manual pages 3–9 pass at 384×832 against the Cordova build with the same data.
- AC4: delivery (README, review PASS, CI, merge).

### Checks

JVM: `ForecastScopeTest` (58 visits against ForecastCtrl, TabCtrl helpers, place selection), `ForecastPageTest` (every captured element of both pages for Seoul and London, template rules, link arrows), `WeatherRequestsTest`, `WeatherRepositoryTest`, `WeatherSessionTest` (senders, gate, timer, swipes, retry, saved place updates, photos), `ForecastScreenshotTest` (19 blocks within recorded tolerances; sensitivity in `tolerances.json`), `WeatherTabTest`, `ForecastFitKoTest`/`ForecastFitEnTest` (font scale 1.3), and the AN-05 and AN-07 suites. Mutation checks: four changes to `ForecastScope` and `ForecastPage` each fail the goldens; of nine page changes the screenshots catch seven (for the other two, `ForecastPageTest` checks the link arrows and the icon size is not checked). Device: `run-production-weather.sh` (Seoul and London on both pages from production, API 36; its cleanup takes the emulator offline unless the removal is confirmed, `test-cleanup.sh`), `device-smoke.sh` (AN-05 charts) and `run-upgrade-test.sh` (G1) on API 36. CI: `check-sources.mjs` covers the forecast references.

## AN-09 — air quality screen S05 (#2888)

Design (survey: `reports/sdlc/android-an-09/air-survey.md`, from `controller.air.js`, `tab-air.html`, `ngAirChart` in `app.js`, TabCtrl's air helpers and the SCSS; behavior checked on the Cordova debug build with `tools/air-reference`):

- `core-domain` `air/`: `AirScope` is AirCtrl's scope for one visit of S05: `init` with the pollutant of the link, `_applyWeatherData` with its order of assignment and the points where it stops, `setMainAqiCode`, `setStation` and `applyEvent`, which returns to the first station. `AirPage` renders tab-air.html from it: the main box (the overall index's grade, or a pollutant's value and unit, the face, the advice and the current weather), the gauge's bands and value label, the chart title, and the daily, detail, info and station cards, with values as AngularJS prints them (no rounding). `AirChart` is ngAirChart's scene: 24 slots (12 past, the current one, 11 to come, a missing slot dated in the device's time zone), bars in the grade colors on a D3 `nice` scale, a tick per date with an hour label every three hours and the date under 0시, and the current slot's line through the chart. Checked against AirCtrl run under Node (`corpus/air.json` visits) and the Cordova captures.
- `core-data`: `WeatherSession.applies` counts TabCtrl's `applyEvent`: each `loadWeatherData` (also when the ten-minute gate stops the load) and each applied response. S05 returns to the first station on each; a resume within the gate keeps it.
- `app` `ui/air/`: S05 as the shell's Air tab. The header block (arrows with more than one place; the current weather opens Hourly), the gauge with the value label placed by `getLabelPosition` from the measured label and gauge widths, the chart card (zoomed with the font scale like AN-08's charts, and drawn at the card's width when the window changes, where the Cordova chart kept its first width), the daily card, the detail and station cards scrolling sideways (a tap selects the pollutant or the station and scrolls to the top), and the info card (the standard opens AN-12's units page; the forecast source opens O08). The title, location glyph (inert on S05, A10), spinner, bell and share are S03's. Colors: the dark theme has its own; the photo and old themes show the light page.
- Navigation: S03 and S04's air elements open S05 on their pollutant (`goAirInfoPage`). As on the Cordova build (`air-reference/navigation.json`), the pollutant stays in the URL across the weather tabs, so the Air tab opens on it again until the Locations tab clears it; a detail cell tap changes only the page.
- Kept (AN-06): A02, A10, A16, and the wider stale page after an apply stops at missing air (a swipe to a place without air keeps the previous place's air until S05 opens afresh; added to `differences.md`); A17; a station value of 0 shown as `-`; raw numbers and the raw °F temperature; a response without air data shows only the grade scale.
- As built: S03's tab host lost its air link to a parameter of the weather tabs; the shell's selected tab is hoisted (`ShellNavigation`) so pages can select a tab. The gauge and the cells set their text with Chrome's rounding of a descent that rounds down (`CssText(borrow = true)`, measured on the Cordova gauge); the weather pages keep the plain rounding their middle-aligned rows were measured with. `CssText` measures its text with an unbounded height, so a row sized to its CSS lines no longer squeezes it. The grade line's face keeps 24 dp through the font scale's nonlinear conversion. `AirScope` dates a missing chart slot with `java.util` time and V8's date reading (`Warnings.jsDate`): `java.time` needs API 26 and the app runs from API 24 without desugaring (review round 1, F1); `MinSdkApiTest` keeps `java.time` out of the shipped modules.

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN09-US1 | User checks a Korean place's air | Seoul saved, network | Open the Air tab | The overall grade with face, advice and the current weather; the gauge with the value over its band; the hourly chart; the daily, detail, info and station cards, as Cordova | No air in the response: only the grade scale; the server fails: the retry confirmation | AC1, AC2, AC3 |
| AN09-US2 | User checks one pollutant | S05 shown | Tap 초미세먼지 in the detail card | Its value with ㎍/㎥, its grade, its gauge bounds, its chart and stations; the cell is selected and the page is at the top | Pollutant without a value: `-` | AC1, AC3 |
| AN09-US3 | User compares measuring stations | Seoul with three stations | Tap the second station; refresh | Every value of that station; the selection moves; a refresh, swipe or load returns to the nearest station | – | AC2, AC3 |
| AN09-US4 | User comes from the weather page | S03 shown | Tap the air summary or a PM cell; go to Hourly and back to Air; then Locations and back to Air | S05 opens on that pollutant; again after the weather tabs; the overall index after Locations | – | AC1 |
| AN09-US5 | User checks an overseas place | London saved | Switch to London on S05 | The grade, gauge and detail cells; no chart, daily or station card | – | AC2, AC3 |
| AN09-US6 | User looks up the forecast source | Seoul shown | Tap 예보자료 AIRKOREA; tap 대기환경기준 | The source popup with the AirKorea text and 닫기; the units page (AN-12) | – | AC1 |
| AN09-US7 | Maintainer refreshes the air references after a Cordova change | Emulator, Cordova debug APK | `check-sources.mjs` fails; run `tools/air-reference/capture.sh`, `./gradlew test` | New references and provenance; the emulator is offline while the Cordova build is installed and restored afterwards | Non-emulator serial: refused | AC3, AC4 |

### Acceptance (from #2888)

- AC1: unit tests cover the grade and scale mapping for every air standard and pollutant (V32), and S05's values against AirCtrl.
- AC2: on an emulator against production, Seoul shows its stations, and selecting another station changes the values.
- AC3: screenshot comparisons of the states on manual pages 10–12 (the overall index at the top and at the end, a pollutant) and of a second station, an overseas place, a place without air and the dark theme pass at 384×832 against the Cordova build with the same data.
- AC4: delivery (README, review PASS, CI, merge).

### Checks

JVM: `AirScopeTest` (32 visits against AirCtrl run under Node, 97 steps: stations, pollutants, the four standards, fallbacks, missing data, stale values, a daylight-saving day), `AirPageTest` (every captured element of the seven states, the label's position at the captured widths, template rules), `AirChartTest` (every tick, label, date and bar of five captured charts within 0.02 dp; D3's ordinal and `nice` rules), `GoldenCorpusDisplayTest` (V32: every standard's grades, colors, faces and gauge positions, now at the captured label widths), `WeatherSessionTest` (the apply events), `AirScreenshotTest` (40 blocks within recorded tolerances; sensitivity in `tolerances.json`), `AirTabTest` and `AirFitKoTest`/`AirFitEnTest` (font scale 1.3). Mutation checks: eleven changes to `AirScope`, `AirChart` and `AirPage` each fail the goldens; of nine screen changes the screenshots catch seven (half a dp of gauge text, and the empty label, white on the light card). Device: `run-production-weather.sh` with `ProductionAirTest` (Seoul's stations from production, the second station's name and value after its tap) on API 36 and API 24; both production tests pin Korean units, so a device in another region gives the same pages. CI: `check-sources.mjs` covers the air references; the forecast references, recaptured with the shared block cutter, are byte-identical.

## AN-10 — start screen, current location and place search (#2889)

Design. Sources: `controller.start.js`, `start.html`, `controller.searchctrl.js` (the town search and the result kinds), `controller.tabctrl.js` (`startPopup`, `updateCurrentPosition` and its retry variants), `service.util.js`, `service.weatherinfo.js`, `service.weatherutil.js`, `service.storage.js` (`_setBackwardCompatibility`), `service.push.js` (`updateCityInfo`), `client/test/location-permission.test.cjs`, V13, V17, #2871 and manual pages 1–2. Investigation and surveys: `reports/sdlc/android-an-10/`.

- `core-domain` `start/`:
  - `StartGate`: S01 shows while the stored `startVersion` is missing or below 1, read as JavaScript's `Number`; closing S01 stores 1.
  - `CityShortcuts`: the 26 cities of `_makeFavoriteList` verbatim, 6/11/17/26 by the screen height (568/731/960).
  - `PredictionName`: the full-text term that starts at the first match, else the typed word.
  - `TownSearch`: S02's substring search on `first`/`second`/`third`, 10 results at a time, and the town's address and name.
  - `LocationAccess`: the permission classes (granted, requestable, denied), S01's decision table, StartCtrl's O04 variants and TabCtrl's O03 position variants; `getIndexOfCity` for duplicates.
- `core-storage`: the migration takes `guideVersion` as `startVersion` when only it exists; `PushRegistration.onCityChanged` (`updateCityInfo`: the records of one place updated, and posted when anything changed).
- `core-data`:
  - `GeocodeClient`: `/geocode/v000903/coord/{lat},{long}` and `/addr/{address}` with the weather requests' attempts and `Accept-Language`.
  - `StartFlow`: S01's chip, search-result and current-position adds (weather by coordinates, duplicates, slot 0 named from the geocode, `favorite_change`, `location_permission`), ending in the add, an O09 alert or an O04 confirmation; a grant re-runs at once.
  - `WeatherSession`: the current position's own lookup on each load of slot 0 (a new fix updates slot 0 and loads again; location off uses the saved location, or without one asks for high accuracy; failures open O03's position variants); `startPopup` (O02) with zero enabled places and its `autoSearch` value kept for the app open, A07 kept; the `locationOn` reload.
  - `PushSync.updateCity`.
- `app`:
  - S01 (`StartScreen`): icon, search box with Cancel, chips, predictions with the "powered by Google" divider (bundled towns when the build has no Places key), 현재위치 날씨보기, the loading overlay; O01 on every entry, O04 and O09. Back leaves the app.
  - `MainActivity`: S01 while the gate holds, then the shell on Hourly with the selected place reloaded; UMP and the Ads SDK start after S01, the banner hidden on it; entry links held until S01 closes. Over the tabs: O02 from a weather page opened, a weather or Air tab tapped (the shell's `onTabTap`) or a share without a location; O03's position variants with Search to the Locations tab.
  - Platform: fused location (high accuracy; a fix up to 60 s old; up to 60 s), the platform provider without Google Play services; precise and approximate requested together; Settings openers and the Play-services high-accuracy dialog; Places SDK 6 (Places API (New), `(regions)` predictions, requests 300 ms after the last keystroke, the latest answer only) with `TW_PLACES_API_KEY_ANDROID`.
  - Build: location permissions, `play-services-location`, Places, core library desugaring (Places 6 requires it; `MinSdkApiTest` keeps the `java.time` ban).
- Differences (`tools/corpus/differences.md` B20–B26): approximate-only gives a position (Cordova: a denial); predictions wait 300 ms and only the latest answer shows; bundled towns on S01 without a Places key; entry links wait for S01 to close; only a refusal without the rationale is final (an expired one-time grant asks again; an interrupted request records nothing); O02's current-position answer always opens Hourly and loads; the current position's spinner turns while the load or the lookup runs.
- Device tests of the tabs start past S01 (`StateRule` in androidTest); without an enabled place they answer O02 first.
- Archify not applicable: an app-internal client flow on the legacy API, no service structure change.

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN10-US1 | New user sees the weather where they are | Fresh install, location on | Close O01; tap 현재위치 날씨보기; allow | S03 for the position, slot 0 named from the geocode | Position or geocode failure: O04 with the matching message; weather failure: O09 | AC1, AC2 |
| AN10-US2 | New user denies location | Fresh install | Tap 현재위치 날씨보기; deny; OK; deny again | O04 "access denied" (Close, OK); OK asks again; after a permanent denial O04 adds the app-info hint and Settings | – | AC1 |
| AN10-US3 | New user grants approximate location only | Android 12+ | Tap 현재위치 날씨보기; choose Approximate | S03 for the approximate position | – | AC1 |
| AN10-US4 | New user with location services off | Location off | Tap 현재위치 날씨보기 | O04 "turn on location services" with Settings to the device location settings | – | AC1 |
| AN10-US5 | New user picks a place by name | Location denied | Type a place; pick a prediction | S03 for that place | Geocode failure: nothing; weather failure or an existing place: O09 | AC2 |
| AN10-US6 | New user taps a city shortcut | Fresh install | Tap 서울 | S03 for 서울 | Weather failure: O09 | AC1 |
| AN10-US7 | Returning user of the current position | Slot 0 selected | Open the app elsewhere | S03 loads the saved place, then the new position | Location off with no saved location: the high-accuracy dialog; failures: O03 position variants | AC1 |
| AN10-US8 | User left without places | No enabled place | Open S03 | O02: OK enables the current position or opens the Locations tab (A07 kept) | – | AC1 |

### Acceptance (from #2889)

- AC1: UI tests pass for location granted, denied once, denied permanently, approximate only and location services off.
- AC2: on a fresh install the app reaches S03 for the emulator's position, and with location denied, for a searched place.
- AC3: the screenshot comparison with manual pages 1–2 passes; delivery (README, plan, review PASS, CI, merge).

### Checks

- JVM: the `start/` domain tests; `PlaceListTest`, `PushRegistrationTest` and the migration test (core-storage); `GeocodeClientTest`, `StartFlowTest` (each permission state with in-test doubles), `CurrentPositionTest` (the slot-0 lookup, O02, `locationOn`) and `PushSyncTest` (core-data); `AndroidLocationAccessTest` (the platform status with an approximate grant, a final refusal, an expired one-time grant, an interrupted request; positions without Play services; the location switch); `StartScreenTest` (Robolectric UI: O01, chips, search, each permission state's popup, O09, back, the hand-off to S03; O02 and O03 over the tabs); `ShareTest` (O02 from share, links held while S01 shows); `StartScreenshotTest` against `tools/start-reference` captures of the Cordova build (manual pages 1–2).
- Device: `ProductionStartTest` through `tools/emulator/run-production-start.sh`: a fresh install on the API 36 emulator with a geo fix reaches S03 through 현재위치 날씨보기, and with location denied through a Places search (production server, read-only).
- Mutations: `reports/sdlc/android-an-10/probe/mutations.py`.

## AN-11 — saved places S02 (#2890)

Design. Sources: `tab-search.html`, SearchCtrl, WeatherInfo (`addCity`, `removeCity`, `disableCity`, `setFirstCityIndex`, `canLoadCity`), `service.push.js` (`removePushListByCityIndex`, `_deletePushInfo`, `updateCityInfo`), TabCtrl (`goPage` routing, `reloadEvent 'search'`, the O03 `search` variants, swipes), `.search` styles, V18, A24 and manual pages 13–20. Surveys: `reports/sdlc/android-an-11/`.

- `core-domain` `places/`: the row (`[name]`, else the shortened address split on `,`, else blank; 현재위치 / Current Location for slot 0 without an address, without a space for ko, ja, zh-CN and the `zh-TU` typo; `t1h`, `tmn`, `tmx` by `toFixed(0)`, shown only when `t1h` is not `-`); `goPage` (startupPage 0/1/3 → Hourly/Daily/Air, anything else Hourly); the S02 Places query (terms joined by `,`); `SearchLocation.retry` (O03 `search`: Close first; permanent denial → hint and Settings to the app's page; unrecorded → OK; location off → Settings to the location settings and OK; else OK).
- `core-storage`: `PlaceList.remove` (splice; the selection resets to the first enabled place only when it equals the new count, A24's neighbours kept); `PushRegistration.onCityRemoved` (`DELETE /v000903/push` with `Content-Type` and `Device-Id`, body `{cityIndex, fcmToken | registrationId}`, nothing without either; the place's records dropped, no other record renumbered, A24 kept), with corpus cases from the Cordova `Push` service.
- `core-data`: `PushSync.removeCity`; `StartFlow` shared by S01 and S02 (the position lookup returns the geocode or the failure; S02's prediction query; the find-by-location result added as an ordinary place); `PlacesPage` (SearchCtrl for one visit: rows and their init-time bells, the sequential row reload through the ten-minute gate with silent failures, the entry lookup of an enabled slot 0 that only reloads it, delete, the slot-0 switch with its first enable, find-by-location, adds that select the new place).
- `app` `ui/places/`: S02 in the Locations tab: the search header (☰, the input, 편집/취소/확인), the list (rows, bells, the location glyph), edit mode (switch, ⊗), search mode (현재위치로 지역찾기, towns with "powered by TodayWeather", predictions with Google's logo), the overlay, O09 and O03 `search`; a row tap selects the place and opens the startup page with `reloadEvent 'search'`; with no enabled place the input takes focus. The shell gains a custom header slot for this tab. The bell's alarm page is AN-14's.
- Swipes stay on the header block of S03, S04 and S05; a test pins that a chart drag scrolls the chart and keeps the place.
- Differences (`tools/corpus/differences.md` B27, B28): the S02 Places query from the prediction's full text (Places API (New) has no terms); a visit's row loads stop when the tab closes.
- Device tests: `closeStartChoice` also closes the keyboard that S02's empty state opens.
- Anomalies kept (AN-06): A24 (no renumbering; disabled-only records survive), the init-time bells, the selection after a delete, the silent row and first-enable weather failures, the entry lookup that discards its position, O03 Retry always finding by location, back opening the exit confirmation in search and edit mode.
- Archify not applicable: an app-internal client flow on the legacy API, no service structure change.

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN11-US1 | User opens saved places | Places saved, one with an alarm | Tap 즐겨찾기 | Rows in saved order with temperature, min/max and bells; rows reload through the gate | Load failure: the row keeps its values | AC1, AC4 |
| AN11-US2 | User adds 부산 and London | Online | Search 부산, pick the town; search London, pick the prediction | Each opens Hourly for the new place, selected | Duplicate or weather failure: O09; geocode failure: nothing | AC2, AC4 |
| AN11-US3 | User switches places | Two or more enabled | Swipe the header, or tap the arrows; drag a chart | Header swipes and arrows switch; a chart drag scrolls only the chart | — | AC2, AC3 |
| AN11-US4 | User deletes a place | Edit mode | Tap ⊗ | The row goes without confirmation; with an alarm, `DELETE /push` for its index | No token: nothing sent | AC1, AC2 |
| AN11-US5 | User turns the current position off and on | Edit mode | Switch off, then on | Off: disabled, its alarms deleted; first on: position, geocode and weather | Position failure: O03 `search`; weather failure silent | AC1 |
| AN11-US6 | User finds the place they are in | Location allowed | Focus the input, tap 현재위치로 지역찾기, tap the row | The geocoded place is added as an ordinary place and opens | Denied or off: O03 `search` | AC1, AC4 |
| AN11-US7 | User restarts the app | Places changed | Kill and open | Places, selection and records as left | — | AC1 |

### Acceptance (from #2890)

- AC1: unit tests cover adding, deleting, the slot-0 switch and persistence across restarts, and compare the push requests for deleting a place and turning off the current position with the Cordova app's requests.
- AC2: on an emulator, search for 부산 and London, add both, switch between them by swiping, and delete one.
- AC3: a UI test shows that dragging a chart sideways does not switch places.
- AC4: the screenshot comparison with manual pages 13–20 passes (the S02 pages 13, 14, 18 and 19 against Cordova captures; 15–17 and 20 are S03 states that AN-08's comparisons cover); delivery (README, plan, review PASS, CI, merge).

### Checks

- JVM: the `places/` domain tests; `PlaceListTest` and `PushRegistrationTest` (corpus removal cases from the Cordova `Push` service); `PlacesPageTest`, `PushSyncTest` (the removal; a store that cannot be written fails nothing) and `StartFlowTest` (core-data); `PlacesScreenTest` (Robolectric UI: rows, edit, delete, switch, search, find-by-location with the keyboard up replacing the results, O09, O03, row taps); a chart-drag test; `PlacesScreenshotTest` against `tools/places-reference` captures of the Cordova build.
- Device: `ProductionPlacesTest` through a run script: 부산 and London added, a header swipe between them, one deleted (production server, read-only GETs; push requests recorded).
- Mutations: `reports/sdlc/android-an-11/probe/mutations.py`.

## AN-12 — settings and menu hand-offs S07, S08, O10 (#2891)

Design (sources: `units.html`, `setting-radio.html`, `controller.units.js`, `controller.setting.radio.js`, `controller.settingctrl.js` and the menu in `index.html`, `service.util.js`, `service.push.js` `updateUnits`; behavior checked on the Cordova debug build with `tools/settings-reference`, which drives it with real taps against a stand-in server and records every request). AN-10 is next in the task graph but waits for AK's place-search decision (AN-06), which blocks AN-10 only, so AN-12 comes first.

- `core-domain` `settings/`: `SettingLists` (S07's rows, every S08 list's title and choices, the menu's values with `N/A`), `Handoffs` (the wind map, the store page of the app's package, the feedback mail with `encodeURIComponent`) and `About` (O10's text). `corpus/settings.json` runs the Cordova controllers with recorders.
- `core-data`: `SettingsActions` does what `radioList.setValue` and `RadioCtrl.valueChanged` do: a changed unit is saved and the push list posted with it (`PushSync.updateUnits`; `PushRegistration.onUnitsChanged` repairs the list as `loadPushInfo` did and sends only with records and a token); a startup page, refresh interval or theme is saved, the refresh interval restarting the timer; then `WeatherSession.settingChanged` resets every place's load time and reloads the selected place (`resume`, skipped while the retry confirmation is open). Opening the refresh interval's list restarts the timer (B5). The push update reads the state through the store's writer, after the unit's save.
- `app`: `SettingsScreen` (S07, S08) over the tab page and the tab bar in the theme's plain colors, with the menu's header and Ionic's item rows; `IonicAlert` for About (backdrop, 250 dp popup, the body on the WebView's `line-height: normal`, the title and button lines on Roboto's baseline); the menu rows (`ShellNavigation.menuOpen` hoisted so rows close the menu as `toggleLeft` does); `Handoff` sends the Cordova intents (InAppBrowser `_system`: `VIEW` with `Browser.EXTRA_APPLICATION_ID`; the WebView's `mailto:`: `VIEW` `BROWSABLE`). The feedback address is a private input (`TW_MAIL_TO`, from `client.config.js`); the store URL is the package's own page, the Cordova build's value (compared by hash). The units link of S03 and S05 opens S07.
- Kept (AN-06): B5–B8 (`tools/corpus/differences.md`): the timer restart on opening, the reload after every choice, `N/A` for an unknown value, the unencoded mail subject. The analytics, ad privacy, policy and terms rows stay AN-15's, the warnings and nationwide rows AN-13's.
- As built: the weather pages read the temperature unit and the theme as they apply, and S05 takes a new air standard as it is (`changeAirUnitEvent`), since the settings pages now change them under a visit. The photo theme's photo covers the header block from its top left (`background-size: cover` at the default position; AN-08 centered it), found by the page 31 comparison. A `FixedLine` text taller than its line overflows it instead of being squeezed (the popup's 18 dp title line with a Korean fallback font). S07 scrolls when larger text needs it (the Cordova page did not scroll; its fixed text size always fit). The settings rows and the popup use unhinted advances (`TextMotion.Animated`), which brought them closer to the WebView's text.

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN12-US1 | User switches to Fahrenheit | Seoul saved, an alarm set | Menu, 단위설정, 온도단위, F; back twice | The menu closes; S07 lists the six units; S08 checks C, then F; the push list is posted with F and the weather loads in °F at once; S03 shows °F | Server fails: the retry confirmation; the unit stays saved and the push list was posted | AC1, AC3 |
| AN12-US2 | User picks the start screen, refresh interval and theme | Weather shown | Menu, 시작 페이지 (or 업데이트 주기, 테마 설정), a value; back | The value is saved and shown in the menu; the weather reloads; a refresh interval restarts the timer; a theme recolors the pages at once | Opening 업데이트 주기 alone restarts the timer (B5) | AC1, AC3 |
| AN12-US3 | User opens the units from a weather page | S03 or S05 shown | Tap 대기환경기준 | S07 opens over the tab; back returns to the tab as it was | – | AC1 |
| AN12-US4 | User sends feedback or rates the app | Mail app, store | Menu, 의견보내기 (or 응원리뷰쓰기) | The menu closes; the mail app opens a mail to the feedback address with the version, UUID and user agent (or the store opens the app's page) | No app for it: nothing opens, the app stays | AC2 |
| AN12-US5 | User checks the wind map | Region KR, a browser | Menu, 널스쿨 풍향 | The browser opens the wind map; the menu stays open | Other regions: no row | AC2 |
| AN12-US6 | User reads the data sources | Any language | Menu, 정보; 확인 or back | The About popup over the menu in the app's language; 확인 or back closes it and the menu stays | – | AC2, AC3 |
| AN12-US7 | Maintainer refreshes the settings references after a Cordova change | Emulator, Cordova debug APK | `check-sources.mjs` fails; run `tools/settings-reference/capture.sh`, `./gradlew test` | New references, requests and provenance; offline while the Cordova build is installed | Non-emulator serial: refused | AC3, AC4 |

### Acceptance (from #2891)

- AC1: unit tests cover settings persistence, the new weather request after a unit change and the push request, compared with the Cordova app's request.
- AC2: on an emulator, each hand-off opens the browser, mail app or store with the Cordova app's target, and About opens in Korean and English.
- AC3: screenshot comparison with manual pages 25–31 and 36 passes.
- AC4: delivery (README, review PASS, CI, merge).

### Checks

JVM: `SettingListsTest` (core-domain: S07's rows for seven regions' defaults and rarer units in Korean and English, every list, the menu's values, the hand-off targets and About against `settings.json`), `PushRegistrationTest` (core-storage: the list after a unit change, with and without a token or list, against `push.json`), `SettingsActionsTest` (core-data: the save, push and load of all 24 choices against the Cordova traces, the weather request against the one the Cordova build sent, the timer when the list opens and on a choice, the retry confirmation), `SettingsTest` (app: the pages and menu rows, back, the S03 and S05 links, About in both languages, the hand-off intents), `SettingsScreenshotTest` (36 comparisons: S07 in each theme and in °F, every S08 list and the theme list in each theme, S03 in °F, dark and photo themes block by block, About in Korean and English; manual pages 25–31 and 36) `SettingsGeometryTest` (the rows, the check mark and the popup's parts against the captured rects within 0.5 dp) and `SettingsFitKoTest`/`SettingsFitEnTest` (font scale 1.3). Mutation checks: twelve changes to the lists, targets, actions and push update each fail the goldens; of eight screen changes the comparisons catch six, and the geometry test the other two (`checks/mutations-*.log`). Device: `run-settings-handoffs.sh` (`SettingsHandoffTest`, offline) in ko-KR and en-US: the browser (Chrome) and the mail app (Gmail) open with the Cordova intents on API 36, the store (Play Store) on an API 34 Play image; About in both languages.

## AN-13 — nationwide weather, nationwide air and warnings S10–S12 (#2892)

Design. Sources: `nation.html`, `nation-air.html`, `kma-special.html`, `controller.nation.js`, `controller.nation.air.js`, `controller.kma.special.js`, `getNationWeather` in `service.weatherutil.js`, `clickMenu` and the menu in `index.html`, and the `$ionicLoading` template in `app.js`. Behavior and layout were checked on the Cordova debug build with `tools/nation-reference`.

- `core-data` `NationSource`:
  - `getNationWeather` (`/v000903/nation/KR`, units query, three attempts 2 s apart, 20 s each);
  - KmaSpecialCtrl's request (`/v000903/kma/special`, 3 s, one attempt);
  - strict JSON as `JSON.parse` reads it.
- `core-domain` `nation/`: `NationPages` (the labels of S10's three modes and S11's six pollutants from the AN-02 `Nationwide` rules), `WarningCards` (S12's cards) and `BoundHtml` (`ng-bind-html` after `$sanitize`).
- `app` `ui/nation/`:
  - `NationLoads` sends a page's request when it opens and keeps the answer while the page is open.
  - `NationScreen` draws the pages over the tabs with the menu's header colors on #F5F5F5, with `$ionicLoading` and Android back blocked while S10 or S11 loads.
  - The menu's three rows close the menu and open their page (`clickMenu`).
  - Text follows Chrome:
    - line boxes from `CssMetrics`, with the borrowed pixel on 16 px Korean lines;
    - the h2 on Roboto's baseline in its 19.2 dp lines;
    - characters Roboto has drawn in Roboto between Korean letters (`chromeRuns`);
    - breaks between Korean syllables on every device (`chromeBreaks`; Samsung's Android keeps Korean words whole).
- Labels are CSS shrink-to-fit at their fixed positions. The mode buttons have Chrome's pixel-snapped widths, and the strip's tabs are painted in DOM order.
- Kept (AN-06): B9, back blocked while loading (`tools/corpus/differences.md`), and B10, Chrome's line breaking.
- Differ: B11, S12's `imageUrl` is not drawn (only scraper-era documents have one). B12, an answer that is not a list shows no card.
- AK 2026-11-09: the build is also checked on the attached phone (Galaxy S21+, Android 15), installed in place. That check found the Samsung line breaking (B10).

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN13-US1 | User reads the current warnings | Region KR | Menu, 기상특보; scroll; back | The menu closes; each bulletin shows its name and time, its hazards and areas, the note for warnings and preliminary warnings, and its comment; back returns to the tab | Request fails or times out (3 s): no card | AC1, AC2, AC3 |
| AN13-US2 | User compares the weather across the country | Region KR, TodayWeather | Menu, 전국날씨; 강수량; 풍향/풍속; back | A loading box, then 15 cities with sky icon and temperature; precipitation with its unit; wind direction and speed with its unit | Request fails: the names only | AC1, AC2, AC3 |
| AN13-US3 | User compares fine dust by province | Region KR | Menu, 전국미세먼지; tap PM10 … SO2; swipe the strip; CO; back | 17 provinces with the pollutant's value on its grade color in the chosen air standard; the strip scrolls to CO | Request fails: names on translucent black | AC1, AC2, AC3 |
| AN13-US4 | User leaves while the map loads | Slow network | Open 전국날씨; press back during loading | Back does nothing until the answer or the failure (Ionic), then works | – | AC1 |
| AN13-US5 | User turns the phone while a page is open | A page shown | Rotate | The page keeps its answer, mode and tab; no new request | – | AC1 |
| AN13-US6 | Maintainer refreshes the nationwide references after a Cordova change | Emulator, Cordova debug APK | `check-sources.mjs` fails; run `tools/nation-reference/capture.sh`, `./gradlew test` | New references, requests and provenance; offline while the Cordova build is installed | Recorded tolerances exceeded: explain or fix | AC3 |

### Acceptance (from #2892)

- AC1: unit tests cover the parsing of the nationwide and warning responses, including empty and failed responses.
- AC2: on an emulator against production, nationwide weather in all three modes, nationwide air in all six tabs and the warnings render.
- AC3: screenshot comparison with manual pages 32–35 passes.
- AC4: delivery (README, review PASS, CI, merge).

### Checks

JVM:
- `NationPagesTest` (core-domain): every label of the captured S10 and S11 states, both card sets, the note rule, missing fields, `ng-bind-html`, and empty and failed answers.
- `NationSourceTest` (core-data): the URLs and headers against `nation-reference/ko-KR/requests.json`, the late answer's three attempts, the 3 s timeout against a server, and empty, failed, non-JSON and non-object answers.
- `NationLoadsTest`.
- `NationTest`: menu rows, requests per opening, back while loading, modes and tabs, a failed answer, saved-state restore.
- `NationScreenshotTest`: 30 comparisons within `tolerances.json`.
- `NationGeometryTest`: labels, buttons, tabs, cards and the loading box within 0.5 dp.

Mutation checks are in `reports/sdlc/android-an-13/checks/mutations-*.log`.

Device:
- `ProductionNationTest` in `run-production-weather.sh` (API 36, ko-KR): three modes, six tabs, the warnings' cards against the answer.
- The attached phone: the three pages from production, installed in place.

CI: `check-sources.mjs` covers the nation references; the workflow paths include the three templates.

## AN-14 — notification settings and alarms S09 (#2893)

Design. Sources: `setting-push.html`, PushCtrl (`controller.push.js`), `service.push.js` (`newPushAlert`, `newPushAlarm`, `updatePushListByCityIndex`, `enableAlertForOldAlarm`, `date2localSecs`, `secs2date`, the notification callback), `service.firebase.js`, the firebasex messaging plugin 2.0.3 (channel, foreground decision, tap extras, permission), TabCtrl (`goPushPage`, O06, O07, `reloadEvent 'push'`), ionic-timepicker 0.5.1 (`WizardFactory/ionic-timepicker#e2d5cd3`, app configuration 12-hour, 5-minute step, three buttons), ion.rangeSlider 2.2.0 with the flat skin, the `.push` styles, V14, V15, D34, A20–A24 and manual pages 21–23. Surveys: `reports/sdlc/android-an-14/`.

- `core-domain` `alarms/`: the time picker O14 (`TimePicker`: the input's hours, minutes and meridian as the library sets them, so noon opens as 12 AM; hours 1–12 and minutes by 5 with wrap-around; Set gives seconds of the day with 12 AM as 0; the heading); the alarm row's `H:MM`.
- `core-storage`: `AlarmSettings` (PushCtrl for one place: the place's records, the last alert winning and the weekdays of the first alarm; the defaults with their edit mark, an enabled 07–22 alert, Mon–Fri, 07:40 and 20:20; `_generateId`; fewer than five enabled alarms for the add row; the hour bar with the end of 0 read as 24 only when the end's date is later, A23; a weekday, the alert switch, the bar and the picker's Set, Delete and Close; the equal-hours check that ignores the switch; the list to save, nothing without an edit). `PushRecords` (`newPushAlert`, `newPushAlarm` with the city info, `date2localSecs`). `PushRegistration.onPlaceSaved` (`updatePushListByCityIndex`: the place's records replaced and only that list posted, `POST /v000903/push-list`, nothing without a token) and `onAlertIntro` (`enableAlertForOldAlarm`: OK enables every alert and posts the whole list with a token; both answers clear `needsAlertIntro`). Corpus cases are generated by running PushCtrl and the `Push` service in Node with the picker, the bar and the popups as doubles.
- `core-data`: the S09 save and O06's answer change the state at once (`AlarmPage`, `answerAlertIntro`), and `PushSync.postPlace` and `postList` post the stored list in turn with the other registrations; nothing is sent when the store cannot be written (#2915, #2925 precedent; Cordova posts and saves without waiting). `PushSync.updateCity` applies its change to the records as stored when it writes. `WeatherSession.openPlace` takes the sender, `PUSH` for a tap.
- `app` `ui/alarms/`: S09 as an overlay page (`setting-push?fav`, `screen_view setting-push`): the header with the back arrow and the place's name or shortened address, the alert card (switch, description, the hour bar drawn from the flat skin's sprite, MIT, copied with provenance), the alarm card (description, weekday buttons, enabled alarm rows with the gear, the add row `HH:MM` with the plus), Cancel and Save; the popups O11 (English title "Permission", Close and Settings to the app's page), O12 (English title "Save", Close and Save), O13 (no title, Close), O14 (no head, the time boxes and arrows, Set, Delete, Close). The weather header's bell opens S09 for the selected place and the S02 row bell for its row (`fav`: `setCityIndex`, except slot 0 while disabled). Popups gain the `button-dark` style and a headless frame. Closing an overlay page starts a new S02 visit, as `tab.search` is not cached, so the bells follow a save.
- Notifications (`app` `notify/`): `POST_NOTIFICATIONS` asked on each S09 entry on Android 13+ and checked before a save (below 13 `areNotificationsEnabled`), as firebasex `grantPermission`/`hasPermission`; the Cordova channel `fcm_default_channel` "Default" (importance high, sound, lights, vibration, badge, public) created when missing and named in the manifest with the color #FFFFFF, so the channel and its user settings carry over; `MessagingService.onMessageReceived` hands a message to the open tabs as O07 (title `LOC_WEATHER`, the title and body joined by a break and read as HTML, OK in `button-dark`, one at a time) and otherwise posts it as firebasex does (big text, high priority, auto-cancel, the app icon, a tap opening the app with the data); a tap (FCM's launcher intent with `google.message_id`, or the app's own) parses `cityIndex` like `parseInt`, selects the place within range and reloads (`reloadEvent 'push'`), with no page change, after the migration and S01; trampolines named like firebasex's `OnNotificationReceiverActivity` and `OnNotificationOpenReceiver` take taps on notifications the Cordova build posted itself before the update.
- O06: over the tabs after the start when `needsAlertIntro` is set (500 ms, not on S01): Close keeps the migrated alerts off, OK enables them and posts the list, Android back answers nothing so O06 returns at the next open (A22 kept).
- Anomalies kept (AN-06): the defaults counted as edits (D34), Android back leaving S09 without O12 (D34), the English "Permission" and "Save" titles, the equal-hours check ignoring the switch, 12:00 AM as Delete, noon opening as 12 AM in the picker (12:00 PM set again becomes Delete, 12:30 PM becomes 00:30; found in the AN-14 survey, not in the rewrite docs), Delete keeping the record disabled, the month-end 24 h detection (A23), index identity (A20, A24), O06 repeating after back (A22), O07 read as HTML (A21), taps never changing the page.
- Differences (`tools/corpus/differences.md`): the S09 save writes before it sends; the channel is created once instead of deleted and recreated at each start.
- Archify not applicable: an app-internal client flow on the legacy push API, no service structure or route change.

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN14-US1 | User sets alarms for a place for the first time | A saved place without records; token | Tap the bell; allow notifications; Save | S09 shows the defaults; Save posts the place's alert and two alarms once and the bell lights | Notifications off: O11, nothing saved | AC1, AC4 |
| AN14-US2 | User changes an alarm | Records for the place | Tap a time; set 9:15 PM; Save | The row shows 21:15; `POST /push-list` with the new `pushTime` | Close: unchanged; Set at 12:00 AM: the alarm is off | AC1, AC4 |
| AN14-US3 | User turns an alarm and the alert off | Records | Tap a time; Delete; switch the alert off; Save | The row hides; both posted with `enable: false` | Equal hours: O13, nothing saved | AC1 |
| AN14-US4 | User leaves with changes | S09 changed | Tap Cancel or the back arrow | O12; Close discards, Save saves | Android back leaves without O12 (D34) | AC1, AC4 |
| AN14-US5 | User receives an alarm | Saved alarm, app in the background | Wait; tap the notification (process alive, then ended) | The app opens with that place selected | Index out of range: the current place reloads | AC3 |
| AN14-US6 | User has the app open when an alarm arrives | App on the weather tabs | Wait | O07 with the title and body; OK closes it | — | AC3 |
| AN14-US7 | Cordova user with pre-alert alarms updates | Legacy `pushData` | Open the app | O06; OK turns the alerts on and posts them, Close keeps them off | Back: O06 again at the next open (A22) | AC1, AC2 |
| AN14-US8 | Cordova user with a notification in the tray updates | Notification delivered before the update | Update; tap it | The native app opens that place | — | AC3 |

### Acceptance (from #2893)

- AC1: unit tests with test doubles cover the registration requests for saving, changing and removing alarms and alerts (V14, V15).
- AC2: the AN-04 upgrade test still passes.
- AC3: on a physical device, saving an alarm registers it on the server, and tapping the delivered notification opens that place.
- AC4: the screenshot comparison with manual pages 21–23 passes; delivery (README, plan, review PASS, CI, merge).

### Checks

- JVM: `AlarmsDomainTest` (the picker, rows); `AlarmSettingsTest` and `PushRegistrationTest` against corpus cases from PushCtrl and the `Push` service (first save, changes, Delete, the alert off, hours, weekdays, slot 0, no token, end 24, O06 answers, removals); `PushSyncTest`; Robolectric `AlarmsScreenTest` (bells, S09, O11–O14, back), `NotificationsTest` (O07, taps, the channel, the permission), `AlarmsScreenshotTest` against `tools/push-reference` captures of the Cordova build.
- Device: `run-upgrade-test.sh` (AC2: `token-a` and `token-b` on API 36, `token-b` on API 24); `run-notification-check.sh` with FCM messages delivered to the emulator by a root broadcast to FCM's receiver (offline, API 24 and API 36: background, foreground, cold and warm taps, a notification the Cordova build received before the update); the phone against production (AC3).
- Mutations: `reports/sdlc/android-an-14/probe/mutations.py`.

## AN-15 — ads, analytics consent and crash reporting (#2894)

Design. Sources: `service.twads.js`, `service.admobemi.js`, `service.monetization.js`, `service.util.js` (`Util.ga`), `controller.settingctrl.js` (L60–L99, `showAlert`), `controller.start.js`, `controller.tabctrl.js`, `getWeatherByGeoInfo`, the `app.js` run block, `index.html` L129–L139, the plugin variables in `client/package.json` and `config.xml`, the emi AdMob plugin's Android sources, `client/test/monetization.test.cjs` and `privacy-consent.test.cjs`, and verification-matrix V21 and V22. Investigation: `reports/sdlc/android-an-15/investigation.md`.

- `core-domain` (plain Kotlin):
  - `ads/BannerGate`: TwAds's `applyVisibility` as a decision (show, the time left before a recheck, the one exposure), and `RemoteBannerPolicy`, which reads the Remote Config pair atomically (`"true"`/`"false"`, digits up to 120).
  - `analytics/AnalyticsSchema`: the events and fields of `Monetization.track`, the screen names and the added `measurement_version`.
- `app` `ads/`:
  - `AdsConsent`: UMP as the plugin runs it — update, the consent form when required, then the Ads SDK in the same session when ads may be requested (#2871), at once with a cached consent. On a UMP failure release builds show no ads; debug builds, which use Google's test units, start the SDK without UMP once unless consent is required (the Cordova test-unit builds).
  - `TwAds`: the banner of an app open: Remote Config, the gate, the 5 s spacing between loads, `ad_lifecycle`, `ad_load_error` and `ad_policy_exposure`. The AdView belongs to the activity, so a configuration change recreates it (the orientation refresh).
  - `BannerSlot`: the anchored adaptive banner for the window width without the side insets, under the tab bar and above the navigation bar while shown. The menu, the in-app popups and the pages end at its top edge, as they ended at the WebView's.
- `app` `analytics/`:
  - `ConsentStore`: the choice and the SDK state in two private preference files written with `commit()`. A failed write removes the choice, and a grant restores at start only if both records still hold it, as the plugin's persisted flag corroborated localStorage.
  - `Analytics`: `setCollectionEnabled`, `track`, `screen`, the consent mode (analytics storage only on a grant) and `traffic_type` from the build type.
  - `EarlyStartProvider` applies the stored choice before Firebase starts.
  - `RemoteBannerConfig`: defaults, a 10 s fetch timeout and 3600 s minimum interval, the activated values first, then fetch-and-activate, bounded by 12 s.
- Menu rows:
  - 선택적 이용 통계 shows 동의함 or 꺼짐 and opens the Ionic popup (거부 / 철회, 동의). Back changes nothing, and a failed save shows `LOC_PRIVACY_SAVE_FAILED`.
  - 광고 개인정보 선택 shows the UMP privacy options form when it is required, else `LOC_AD_PRIVACY_UNAVAILABLE`.
  - 개인정보처리방침 and 이용약관 open `todayweather.ai/mobile/{privacy|terms}{'' | .ja | .en}.html` for the app's language in the system browser.
  - The menu stays open.
- Events: `weather_fetch` and `weather_load` from `WeatherRepository` and `WeatherSession`, `screen_view` with the Cordova route names on page and tab changes, and the ad events. `favorite_change` and `location_permission` come with AN-10 and AN-11 (`remove`), which add those actions. AN-10 also hides the banner while S01 shows and starts the ads after it, as TabCtrl did.
- Firebase:
  - Remote Config and Crashlytics come through the Firebase BOM, with the Crashlytics Gradle plugin when `google-services.json` exists. Crashlytics collects, independent of the analytics choice, as in the Cordova build.
  - Automatic screen reporting is off (`config.xml`).
- Private inputs: `TW_ADMOB_APP_ID_ANDROID` and `TW_ADMOB_BANNER_ANDROID` for release builds. Packaging a release refuses missing values or Google's sample IDs. Debug builds always use the sample app ID and the test banner unit.
- Differences (`tools/corpus/differences.md`):
  - B13: the policy pages follow the app's language. The Cordova build compared `navigator.language` (`ko-KR`) with `ko`, so it always opened the English pages.
  - B14: the ad privacy row shows the cannot-open message when no form is required. The 1.1.1 plugin answered success and showed nothing.
  - B15: a loaded banner waiting for its Remote Config delay reserves no empty strip.
  - B16: `screen_class` stays `Cordova`.
  - B17: Android back on the popup closes the popup only. cordova-android 15 delivered one back press as two `backbutton` events, so the Cordova build usually closed the menu too.
- Archify not applicable: an app-internal flow with no service structure change.

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN15-US1 | User sees the app with its banner | Debug build, network | Open the app (first time: answer the consent form if one is required) | The Ads SDK starts in this session; a test banner loads and shows under the tab bar, above the navigation bar; the pages, menu and popups end above it | No fill or offline: no banner and no empty strip; UMP fails in a release build: no ads | AC1, AC2 |
| AN15-US2 | Operator switches the banner off or delays it | Remote Config `tw_banner_enabled` false or `tw_banner_delay_seconds` 30 | Open the app (also offline after a fetch) | Off: no banner; delayed: the banner shows 30 s after the app opened; an invalid pair keeps the defaults | Fetch fails or takes over 12 s: the activated or default policy applies | AC1 |
| AN15-US3 | User opts in to usage analytics | Fresh install | Menu, 선택적 이용 통계, 동의; change tabs | The row shows 동의함; analytics collects from now on with analytics storage granted and advertising denied; the next screens are sent | Saving fails: 꺼짐, collection off and `LOC_PRIVACY_SAVE_FAILED` | AC1, AC2 |
| AN15-US4 | User withdraws | Opted in | Menu, 선택적 이용 통계, 거부 / 철회; restart the app | 꺼짐; no event from now on, also after the restart | Saving fails: collection stops, the old grant is removed, the message shows | AC1 |
| AN15-US5 | User closes the dialog without choosing | Any choice | Open the dialog; press back | The dialog closes and the menu stays; the choice is unchanged | – | AC1 |
| AN15-US6 | User reviews ad privacy, the policy and the terms | App open | Menu, 광고 개인정보 선택; 개인정보처리방침; 이용약관 | The UMP form where one is required, else the cannot-open message; the browser opens the page in the app's language | No browser: nothing opens | AC1, AC3 |
| AN15-US7 | Cordova user updates | Cordova 1.1.1 with an analytics opt-in | Update; open the app twice | No analytics event until the user opts in again; ads behave as on a fresh start | – | AC2 |
| AN15-US8 | Maintainer refreshes the privacy references after a Cordova change | Emulator, Cordova debug APK | `check-sources.mjs` fails; run `tools/privacy-reference/capture.sh`, `./gradlew test` | New references and provenance; offline while the Cordova build is installed | Recorded tolerances exceeded: explain or fix | AC3 |

### Acceptance (from #2894)

- AC1: unit tests cover the banner policy and the consent transitions: grant, withdrawal and a failed write (V21, V22).
- AC2: a debug build loads test ads, and the Analytics debug log shows no analytics event before opt-in.
- AC3: delivery (README, review PASS, CI, merge), with the analytics popup and the rows compared with the Cordova build (manual page 37).

### Checks

JVM:
- `BannerGateTest`, `RemoteBannerPolicyTest` and `AnalyticsSchemaTest` (core-domain).
- `WeatherTelemetryTest` (core-data): the outcomes and durations of `weather_fetch` and `weather_load`.
- `AnalyticsTest` (app): grant, withdrawal, failed writes, compensation for an SDK failure, the start's corroboration, screens.
- `TwAdsTest` (with Remote Config) and `AdsConsentTest`: the SDK start after consent and with a cached consent, the debug and release UMP failures, the delay, the kill switch, the one exposure, the spacing and the recreation.
- `PrivacyMenuTest`: the row value, the dialog, back, the failure alert, the ad privacy form and message, the policy URLs per language, the screens reported, and the menu and popups ending at a banner's top.
- `PrivacyScreenshotTest`: the popup and the rows against `privacy-reference` within recorded tolerances, and the popup's lines against the capture's line boxes; `PrivacyGeometryTest`; `PrivacyFitTest` (320×480 dp, font scale 1.3, a banner).

Device:
- `tools/emulator/run-ads-check.sh` (API 36):
  - online, `AdsDeviceTest` waits until a test banner loads and shows, and the FA verbose log shows no "Logging event" without an opt-in;
  - offline, an opt-in through the dialog logs `screen_view`, so the check cannot pass vacuously. The app is uninstalled before the network returns.
- The upgrade test still finds no event after the update.
- The attached phone: installed in place; the banner and the four rows, without opting in.

CI: `check-sources.mjs` covers the privacy references; the workflow paths include the Cordova sources read here.

## AN-16 — sharing, entry links and backup (#2895)

Design. Sources: `doTabShare` and `_makeMessageForTodayWeather` in `controller.tabctrl.js`, `getWeatherEmoji`, `branchInit` in `service.branch.js`, `setCityIndex`, the `reloadEvent` handler, the socialsharing plugin's Android code, and the shipped 1.1.1 APK's manifest. Investigation: `reports/sdlc/android-an-16/investigation.md`.

- `core-domain` `share/`:
  - `ShareMessage`: the message of `_makeMessageForTodayWeather` with the city line and the Branch link per language. Values are joined as JavaScript does, and a missing `currentWeather` or `skyIcon` leaves the city line only (V20).
  - `EntryLink`: the place index of `todayweather://N`, with the first scheme removed and JavaScript's `parseInt`; empty or NaN gives none.
- `core-data` `WeatherSession.openPlace(index)`: `setCityIndex` (only within the list) then `reloadEvent 'deeplink'`, which loads at once unless the retry confirmation is open.
- `app`:
  - the share buttons of S03, S04 and S05 send the message through the system chooser (`ACTION_SEND`, `text/plain`, no title), as the plugin did; without a location they do nothing until AN-10 opens O02;
  - `MainActivity` registers `todayweather` (`VIEW`, `DEFAULT`, `BROWSABLE`), and `TodayWeatherApp` hands a link from `EntryIntents` to the open app's session after the migration, on cold and warm starts. The link that Recents delivers again when it opens a finished task (`FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY`) selects nothing.
- Backup (`res/xml/backup_rules.xml` for API 24–30, `data_extraction_rules.xml` for API 31+):
  - included: `files/app_state.json`, and the Cordova sources the migration reads (WebView Local Storage and the group suite), so a backup or device transfer from Cordova 1.1.1 restores and migrates;
  - excluded: the weather cache, the analytics consent (off again), Firebase's token and installation (a new FCM token; PushSync replaces the restored token and posts the list, as after a 1.1.1 restore), the measurement, AdMob and UMP state (UMP asks again where required), and the default preference suite with UMP's IAB consent strings (review F2; the Cordova app's start moves its old units out of that suite into localStorage and the group suite).
  - The policy is recorded in `android/README.md`.
- Differences (`tools/corpus/differences.md`): B18, `todayweather://N` opens place N; 1.1.1 Android registered no scheme and opened nothing. B19, the backup policy above; 1.1.1 backed up everything.
- Archify not applicable: no service structure change.

### User scenarios

| ID | User and goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- |
| AN16-US1 | User shares the weather | A place with weather | Tap share on S03, S04 or S05; pick an app | The chooser shows the Cordova message: place, current temperature and emoji, high and low, summary, app name and the Branch link of the language | No weather yet: the city line only; no location: nothing (O02 with AN-10) | AC1 |
| AN16-US2 | User opens a place from a link | Places saved | Open `todayweather://2` with the app closed, then with it open | Place 2 is selected and loads, on cold and warm starts, after the migration | Out of range: the selected place reloads; not a number or empty: nothing; the task opened again from Recents: nothing | AC1 |
| AN16-US3 | User moves to a new phone | Places, alarms and an analytics opt-in | Back up; restore on another device | Places, settings and alarms come back; analytics is off; a new FCM token replaces the old one on the server; the weather loads afresh | – | AC2 |
| AN16-US4 | Cordova user moves to a new phone that installs the native app | Cordova 1.1.1 with places | Back up; restore into the native app | The Cordova data restores and migrates | – | AC2 |

### Acceptance (from #2895)

- AC1: UI tests cover the share text and the routing of `todayweather://N`.
- AC2: an emulator backup and restore follows the recorded policy.
- AC3: delivery (README with the policy, review PASS, CI, merge).

### Checks

- JVM: `ShareMessageTest` and `EntryLinkTest` (core-domain), `WeatherSessionTest` for `openPlace`, `ShareTest` (app): the chooser intent from each tab and the links' queue, and `BackupRulesTest`: the rule files against the policy.
- Device: `tools/backup/run-backup-test.sh` (offline): `EntryLinkDeviceTest` on cold and warm starts and for a link delivered again from Recents; with `bmgr` and the local transport, a native backup restored into the native app and a Cordova 1.1.1 backup restored into the native app, with `BackupRestoreTest` checking what came back.
- Mutations: `reports/sdlc/android-an-16/probe/mutations.py` (one rule at a time; the named test class must fail).
