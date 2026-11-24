# Plan: R8 shrinking and obfuscation of the Android release

Consumes [intent](../intent/android-r8.md) and [spec](../specs/android-r8.md).

## Work

| # | Change | Files | Check |
| --- | --- | --- | --- |
| 1 | Enable R8 and resource shrinking for `release` | `android/app/build.gradle.kts`, `android/app/proguard-rules.pro` | `assembleRelease` without private inputs (placeholder ad IDs): mapping written, dex markers |
| 2 | Keep the catalog strings read by name | `android/app/src/release/res/raw/keep.xml`, `ChartStrings.kt`, `ForecastStrings.kt`, `ResourceKeepTest.kt` | Test red with a narrower pattern, green with `LOC_*`; `aapt2 dump resources` of the APK has all 328 `LOC_*` strings |
| 3 | Mapping check in the release tools | `android/tools/release/check_r8.py`, `test_check_r8.py`, `check-apk.sh`, `.github/workflows/android.yml`, `scripts/release-notes.mjs` | Unit tests with made APKs; real minified and unminified APKs; `check-apk.sh` end to end on debug-signed APKs |
| 4 | Documents | runbook, `android/README.md`, `docs/operations/github-releases.md`, `specs/android-release.md` | Links and anchors |

## User scenarios

| ID | User and goal | Steps | Expected | Failure |
| --- | --- | --- | --- | --- |
| S1 | Existing user updates to the shrunk release | Unminified build with Busan, °C, dark theme; install the minified build with `install -r`; open | Same places, units and theme; weather, chart legends, daily and AQI pages load | A lost state, missing text or a crash ends the candidate |
| S2 | User searches and adds a place | Locations, type a name, pick a Google prediction | The place is added and its weather loads | Places SDK class or method missing |
| S3 | User opens menu pages | Units, theme, About, analytics popup, ad privacy, warnings, nationwide weather (Korean) | Pages show the catalog texts and server data | Missing `LOC_*` strings or a crash |
| S4 | User saves alarms and shares | Bell, save; share | Alarm records stored; system chooser opens | Serialization error |
| S5 | User adds a widget | Launcher widget picker, configure style and place, save | Widget shows weather; tapping opens the app; update broadcast works | Worker or Glance callback not found |
| S6 | Operator checks the release | `check-apk.sh <apk> <store> <mapping>` | `ok` lines for R8 and the mapping, SHA-256 printed | Unshrunk APK, other build's or truncated mapping fails |

## Verification mode

Behavior of the keep rule: TDD (`ResourceKeepTest` red, then green). Build configuration and release tool: alternative evidence (real R8 builds, APK inspection, emulator smoke on a task-owned `tw_` AVD, made-APK unit tests). JVM suites, `lintRelease` and the release-tool tests run unchanged.

## Risks, rollback

- A reflective path not exercised on the emulator may fail only on devices: the device gate (runbook step 5) is the first run of shrunk code on a phone and reads the crash buffer.
- FCM could not be exercised: the emulator's Play services are older than the SDK requires. `MessagingService` keeps its name through the manifest rule.
- Rollback: set `isMinifyEnabled`/`isShrinkResources` back to false; Play's DEX optimization warning returns.

## Blast radius

Release APK only. Debug builds, CI builds and the instrumented suites are unchanged.
