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
