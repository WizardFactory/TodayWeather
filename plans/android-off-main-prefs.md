# Plan: Android off-main preference writes and lock waits

Consumes [intent](../intent/android-off-main-prefs.md) and [spec](../specs/android-off-main-prefs.md) for issue #3238 (PERF-6).

| # | Change | Files | Check |
| --- | --- | --- | --- |
| 1 | TDD Red: add unit tests for all 4 sites (non-blocking `canLoad` during `reserveWidgetAttempt` + race re-check; off-main ordered hand-back listener; non-blocking `screen()` during `setCollectionEnabled` commit + async popup failure alert; single `recordCollection(true)` write on collecting cold start; `ForecastVisits.visible` using `apply()` while `reserve`/`displayed`/`failedBeforeDisplay` use `commit()`) | `WeatherRepositoryTest.kt`, `HandBackTest.kt`, `AnalyticsTest.kt`, `PrivacyMenuTest.kt`, `ForecastVisitsTest.kt` | Focused Gradle test run fails on behavioral assertions; output saved to `reports/sdlc/android-off-main-prefs/logs/tdd-red.log` |
| 2 | Implement Site 1 (`AnalyticsGuard` conditional skip, `Analytics.applyCollection` single commit when `value == true`) and Site 3 (`Analytics` two-lock split, `PrivacyActions` suspending `setAnalytics`, `TodayWeatherApp` `analyticsWriter` + `handBackExecutor`, `MainActivity` async popup await, comment updates in `TodayWeatherApp.kt`, `HandBack.kt`, `android/README.md`) | `AnalyticsGuard.kt`, `Analytics.kt`, `Handoff.kt`, `MainActivity.kt`, `TodayWeatherApp.kt`, `HandBack.kt`, `android/README.md` | `AnalyticsTest`, `HandBackTest`, `ListenerKeepTest`, `PrivacyMenuTest`, `PrivacyFitTest` pass |
| 3 | Implement Site 2 (`WeatherRepository.load` check-reserve-recheck outside `synchronized(this)`) and Site 4 (`ForecastVisits` `saveAsync` + `ForecastInterstitial` `apply()` for `visible()` only) | `WeatherRepository.kt`, `ForecastVisits.kt`, `ForecastInterstitial.kt` | `WeatherRepositoryTest`, `WidgetRefreshTest`, `ForecastVisitsTest` pass; output saved to `reports/sdlc/android-off-main-prefs/logs/tdd-green.log` |
| 4 | Run full bounded JVM build and test suite (`assembleDebug test`) and check artifact policy before committing | All touched modules | `reports/sdlc/android-off-main-prefs/logs/full-test.log` passes; `python3 scripts/check-artifact-policy.py --staged` passes |
| 5 | Round-2 review fixes (CODEX-1..5): generation-guarded widget reservation re-check (`locationStartGeneration`), synchronous suite hand-back on `analyticsWriter` (`onChoiceWritten`), immediate `beginChoice`/`commitChoice` supersession, app-scoped `AnalyticsChoiceController` failure state across recreation/popup reopen, `Analytics.collecting` StateFlow for `AdsDeviceTest` | `WeatherRepository.kt`, `Analytics.kt`, `TodayWeatherApp.kt`, `HandBack.kt`, `Handoff.kt`, `MainActivity.kt`, `AdsDeviceTest.kt`, `android/README.md`, unit tests | TDD Red (`tdd-r2-red.log`) fails on assertions; TDD Green (`tdd-r2-green.log`) and full JVM suite (`full-test-r2.log`) pass |
| 6 | Emulator device gates (`run-upgrade-test.sh`, `run-handback-test.sh`, `run-ads-check.sh`, `ForecastInterstitialDeviceTest`) | Coordinator | Executed by coordinator after JVM commit |

Rejected:
- Provisional in-flight marker in `WeatherRepository.inFlightLocations` while `reserveWidgetAttempt()` runs (a concurrent foreground load can overwrite `inFlightLocations[key]`).
- Moving `AnalyticsGuard.beforeFirebase` asynchronous (SDK persistence is asynchronous and process death before flush previously re-enabled collection and logged `app_update`).
- Using `apply()` for `ForecastVisits.reserve` / `displayed` / `failedBeforeDisplay` (process death after ad show must not reopen the daily cap).

Rollback: revert the commit on `perf/3238-off-main-prefs`; no preference file schema, key name, or R8 keep rule changes.

## User scenarios

| ID | User and goal | Steps | Expected | Failure |
| --- | --- | --- | --- | --- |
| S1 | User with home-screen widgets resumes app | Widget worker blocks in `reserveWidgetAttempt()` while `MainActivity.onResume` calls `canLoad()` | `canLoad()` returns immediately without waiting for the reservation fsync | Main thread stalls on `WeatherRepository` monitor |
| S2 | User toggles 이용 통계 in side menu | Open side menu, tap 이용 통계, choose 켜기/끄기 while navigating | Choice commits off Main without blocking `screen()`/`track()`; hand-back runs off Main in FIFO order; failed save shows `LOC_PRIVACY_SAVE_FAILED` | Main-thread fsync stall, monitor wait on `screen()`, or reordered hand-back |
| S3 | Returning user opens app in KR or with stored grant | Process cold-starts through `EarlyStartProvider` | Collection state is committed once (`true`), not `false` then `true`, before Firebase initializes | Extra synchronous startup fsync |
| S4 | User visits Hourly/Daily tabs and switches tabs | First visit records `visible()`; eligible repeat tap reserves and shows interstitial | `visible()` uses `apply()`; `reserve()`/`displayed()`/`failedBeforeDisplay()` still `commit()` | Synchronous commit on every first daily visit, or cap reopened after crash |
