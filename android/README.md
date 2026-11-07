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

It copies `client/www/img/**/*.png` to `app/src/main/assets/img/`, converts `client/www/data/town.js` to `app/src/main/assets/data/towns.json` and converts `client/www/locales/*.json` to `app/src/main/res/values*/client_strings.xml` (English is the default, as in the Cordova app). It reads the image list from Git, so case-insensitive file systems give the same result; `client/www/img/KR.png`, a same-content duplicate of the `kr.png` the app uses, is skipped and listed. Catalog keys that are not valid resource names, such as `LOC_TODAY_THAN_YESTERDAY?`, become `LOC_TODAY_THAN_YESTERDAY_`; the provenance record lists them. [`app/provenance/client-assets.json`](app/provenance/client-assets.json) records each output's source path, the last commit that changed the source, and both hashes. The tool needs the full Git history.

Do not edit the generated files. While iOS stays on Cordova, change translations in `client/www/locales/` (for example #2613) and re-run the tool, so both apps get the change.

## Golden corpus

`core-domain` is checked against outputs of the Cordova code itself: [`tools/corpus/generate.mjs`](tools/corpus/README.md) runs the client's conversion and display functions under Node and writes `core-domain/src/test/resources/corpus/`; `GoldenCorpusTest` must match every case. CI regenerates the corpus and fails on a diff, so a change in the Cordova code shows up as a corpus change. Known behavior differences are listed in [`tools/corpus/differences.md`](tools/corpus/differences.md).

## Data migration from the Cordova app

On every start the app runs `CordovaMigrator` (core-storage); after the first successful run it does nothing. It builds `files/app_state.json` (DataStore, `AppState`) from the Cordova app's storage and leaves that storage unchanged, because the rollback hand-back (AN-17) reads it.

- **Sources, per key:** the WebView's `localStorage` first, then the native suite `group.net.wizardfactory.todayweather`, then for units the old suite `net.wizardfactory.todayweather_preferences`. `localStorage` holds the newest values: the Cordova app writes it first and mirrors it to the suite asynchronously, and on an emulator the suite lost the second of two quick `cities` writes. `localStorage` is read without opening the database: Chromium's LevelDB (`app_webview/Default/Local Storage/leveldb`) by `LevelDbReader`, which follows `CURRENT` and the MANIFEST to the live tables and current logs (so a table left over after a compaction cannot bring back a deleted key) and reads Snappy blocks, or the SQLite file of WebViews before Chromium 61 (`app_webview/Local Storage/https_localhost_0.localstorage`). A key whose value does not parse falls back to the next source.
- **Rules:** those of the Cordova code. `cities` keep their geography, flags and photo (weather caches are dropped; an entry that is not an object keeps its slot as a disabled place so indexes stay aligned; coordinates must be finite and within ±90/±180, otherwise the place is address-only); `cityIndex` follows `loadCities` (out of range or missing: first enabled place); `units` follow `Units.loadUnits` (missing members and `aircn` take the device region's defaults; unknown values too); `settingsInfo` falls back to the standalone `startupPage`/`refreshInterval` keys and then to `0`/`0`/`light`; `pushData2` records are kept as stored (ISO times, `dayOfWeek`, city info) for re-registration (AN-04) when they have integer `cityIndex`/`id`, boolean `enable` and the category's ISO times (real dates and times) and seven-day array, otherwise dropped and counted; records naming no place are kept (anomaly A24); legacy `pushData` alarms convert like `loadOldPushInfo` (local wall time 07:00–22:00 on the migration day, also on daylight-saving days) and set `needsAlertIntro` (O06). `MigrationRunner` never replaces a stored migration. `MigrationInfo` records the source and outcome of every key.
- **Device-Id:** `Settings.Secure.ANDROID_ID`, the value cordova-plugin-device reported, unchanged for the same signing key.
- **Analytics:** off until the user opts in (AN-15). `EarlyStartProvider` runs before `FirebaseInitProvider`, writes the SDK's persisted collection flags off synchronously and then calls `setAnalyticsCollectionEnabled(false)` with every consent type denied; a Cordova opt-in therefore does not carry over. The manifest repeats the Cordova build's analytics defaults.

`tools/leveldb-fixtures` writes the LevelDB test directories with the real LevelDB library (`npm ci && node generate.mjs`).

### Upgrade test (emulator)

```sh
cd android && ./gradlew assembleDebug assembleDebugAndroidTest
ANDROID_SERIAL=emulator-5554 tools/upgrade/run-upgrade-test.sh <cordova-1.1.1-debug.apk> [out-dir]
```

The Cordova debug APK must be signed with the same debug key (`client/`: `npx cordova prepare android && npx cordova compile android --debug`, with the private inputs). The script takes the emulator offline, installs the Cordova APK, seeds places, units, settings, alarms and an analytics opt-in through the app's own services over WebView DevTools (`seed-cordova.mjs`), installs this build over it and runs `CordovaUpgradeTest` twice (first start, restart). It fails if any analytics event is logged after the update, and, so that this cannot pass vacuously, if the Cordova opt-in or the SDK's enabled flag is missing before the update or the native APK has no Firebase configuration. It refuses a non-emulator `ANDROID_SERIAL` and a device that still has a network.

## Private inputs

Private inputs stay out of Git, docs and logs, as in the Cordova build (`npm run release:fetch`). Later sub-issues add them by name only:

- `app/google-services.json`: Firebase configuration for the existing project (push, analytics, Crashlytics, Remote Config). The build applies the Google services plugin only when the file exists; without it Firebase stays uninitialized and the app runs with analytics off.
- AdMob application ID and ad unit IDs for release builds. Debug builds use Google's test units.
- Release signing inputs (AN-19).

The build and the unit tests run without them.

## Version

`versionCode` 200000 and `versionName` 2.0.0 keep the native debug build installable over the Cordova 1.1.1 build (100091). AN-19 sets the release value above every active Play track.
