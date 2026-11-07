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

It copies `client/www/img/**/*.png` to `app/src/main/assets/img/`, converts `client/www/data/town.js` to `app/src/main/assets/data/towns.json` and converts `client/www/locales/*.json` to `app/src/main/res/values*/client_strings.xml` (English is the default, as in the Cordova app). Catalog keys that are not valid resource names, such as `LOC_TODAY_THAN_YESTERDAY?`, become `LOC_TODAY_THAN_YESTERDAY_`; the provenance record lists them. [`app/provenance/client-assets.json`](app/provenance/client-assets.json) records each output's source path, the last commit that changed the source, and both hashes. The tool needs the full Git history.

Do not edit the generated files. While iOS stays on Cordova, change translations in `client/www/locales/` (for example #2613) and re-run the tool, so both apps get the change.

## Private inputs

Private inputs stay out of Git, docs and logs, as in the Cordova build (`npm run release:fetch`). Later sub-issues add them by name only:

- `app/google-services.json`: Firebase configuration for the existing project (push, analytics, Crashlytics, Remote Config).
- AdMob application ID and ad unit IDs for release builds. Debug builds use Google's test units.
- Release signing inputs (AN-19).

The build and the unit tests run without them.

## Version

`versionCode` 200000 and `versionName` 2.0.0 keep the native debug build installable over the Cordova 1.1.1 build (100091). AN-19 sets the release value above every active Play track.
