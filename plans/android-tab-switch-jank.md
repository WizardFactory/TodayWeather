# Plan: Android tab-switch jank

Consumes [intent](../intent/android-tab-switch-jank.md) and [spec](../specs/android-tab-switch-jank.md).

| # | Change | Files | Check |
| --- | --- | --- | --- |
| 1 | `rememberChartImages()` reads through the shared `ForecastChartImages`; the provider moves to the app root; byte budget from the memory class | `ui/chart/ChartImages.kt`, `ui/chart/ForecastChartImages.kt`, `MainActivity.kt`, `ui/forecast/WeatherTab.kt` | JVM: two compositions (visits) of a screen using `ThemeImage` decode each path once; budget clamps; existing chart/detail-image and screenshot tests pass |
| 2 | Test tags as resource IDs at the root | `MainActivity.kt` | JVM semantics test; device journey finds `shell-tab-*` |
| 3 | `:baselineprofile` module (com.android.test, androidx.baselineprofile 1.5.0, benchmark-macro-junit4 1.5.0, uiautomator 2.4.1) with `BaselineProfileGenerator` (start, S01 notice/서울 when needed, the four tabs, scroll) and `TabSwitchBenchmark` (FrameTimingMetric, CompilationMode None vs BaselineProfile) | `android/baselineprofile/**`, `settings.gradle.kts`, `gradle/libs.versions.toml`, `app/build.gradle.kts` | `./gradlew assembleDebug test` builds it without a device; generation run on `tw_perf_review` |
| 4 | Commit the generated profile; document generation and measurement | `app/src/main/generated/baselineProfiles/` (or `src/release`), `android/README.md`, `docs/evidence/android/tab-switch-2026-11-27.md` | Release APK contains `assets/dexopt/baseline.prof` > 14 KB with app classes |
| 5 | Before/after measurement on the same emulator and R8 release setup | evidence doc | gfxinfo journey, several batches; simpleperf long-frame summary |

Rejected: keeping all four tabs composed (pager-style) — biggest win on recomposition/measure but changes visit semantics that the native ad slot (#3212), analytics screens and interstitial rules rely on; downsampling icons to their drawn size — changes filtering and risks screenshot parity; moving decode off the main thread — needs placeholder/late-fill states the Cordova parity does not have.

Rollback: revert the commit; the profile only affects compilation.

## User scenarios

| ID | User and goal | Steps | Expected | Failure |
| --- | --- | --- | --- | --- |
| S1 | Reader switching tabs | Open Hourly, tap Daily, AQI, Locations, Hourly repeatedly | Each image decodes once per session; fewer slow UI-thread frames, lower p90 than before | Repeated decode on each visit; more slow frames |
| S2 | New install | Install the release APK, cold start, switch tabs | Profile installed (`assets/dexopt/baseline.prof` with app methods); start and first switches compiled code | No app rules in the profile |
| S3 | Developer regenerating the profile | Follow android/README.md on an emulator | `./gradlew :app:generateBaselineProfile` (or the documented task) writes the rules file | Undocumented or device-bound step in PR CI |
| S4 | Any reader | Use every tab, theme and language | Pixel output unchanged (screenshot/parity tests) | Changed image or layout |
