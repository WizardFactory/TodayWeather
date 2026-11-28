# Intent: move synchronous preference writes and lock waits off the main thread

- Task: `android-off-main-prefs` (issue #3238, sub-issue of #2877). Mode: implementation. Change kind: behavior (performance / ANR risk reduction, preserving every durability, ordering, and R8 keep contract). Endpoint: **pre-merge** (no merge, push, PR creation, release, store, or emulator action in this pass).
- Source and authority: AK, 2026-11-27: PERF-6 from the 2026-11-27 Android ANR audit (findings A1, A3, A4, A5), following PERF-5 (#3233) on `WeatherRepository.load`.

## Problem

Several synchronous `SharedPreferences.commit()` calls run on the Android main thread, and in two places the main thread waits for a monitor held across a `commit()` fsync:

1. **Startup (`EarlyStartProvider` -> `Analytics`):** `Analytics.start()` calls `applyCollection()`, which always writes `recordCollection(false)` and then `recordCollection(true)` when collecting — performing an extra synchronous `commit()` even when the stored state and final decision are both "collecting".
2. **Widget reservation (`WeatherRepository.load`):** `loadFromWidget` invokes `reserveWidgetAttempt()` (which calls `@Synchronized WidgetRefresh.reserveAttempt` -> `commit()`) inside `synchronized(this)` on `WeatherRepository`. Main-thread callers (`canLoad`, `invalidate`, `invalidateAll`, `latest`, foreground `load` bookkeeping) block on that fsync, notably on `MainActivity.onResume`.
3. **Usage analytics choice & Cordova hand-back (`MainActivity`, `Analytics`, `TodayWeatherApp`, `HandBack`):**
   - `AnalyticsPopup` invokes `Analytics.setCollectionEnabled` synchronously on Main.
   - `Analytics.setCollectionEnabled` holds `@Synchronized` on `Analytics` across `store.write` and `store.recordCollection` commits, blocking Main-thread `screen()` and `track()` calls even if `setCollectionEnabled` moves off Main.
   - `TodayWeatherApp` registers `HandBackWriter.watchConsent` with `{ it() }`. Because Android dispatches `SharedPreferences` listeners on the main thread regardless of writer thread, `HandBackWriter.rewrite()` commits on Main and can also wait on `AppStateHolder`'s background `handBack.write`. Comments in `TodayWeatherApp.kt` and `android/README.md` inaccurately claim `"on the writer's thread"`.
4. **Interstitial allowance (`ForecastInterstitial` / `ForecastVisits`):** `ForecastVisits.visible()` performs a synchronous `commit()` on Main even though losing the "seen" flag only delays an ad and preserves first-visit protection.

## Outcome

All four sites move synchronous preference commits off the main thread or out from under locks that the main thread acquires, while preserving every durability guarantee, startup ordering invariant, consent state transition order, and R8 keep contract.

## Scope and exclusions

In scope:
- `android/app`: `AnalyticsGuard.kt`, `analytics/Analytics.kt`, `Handoff.kt`, `MainActivity.kt`, `TodayWeatherApp.kt`, `HandBack.kt`, `ads/ForecastVisits.kt`, `ads/ForecastInterstitial.kt`.
- `android/core-data`: `WeatherRepository.kt`.
- Documentation: `android/README.md` listener-thread description, plus canonical `intent/`, `specs/`, and `plans/` files.
- JVM unit and Robolectric tests in `android/core-data` and `android/app`.

Out of scope:
- Retiring the Cordova hand-back (AN-17; product decision separate from this issue).
- Moving `AnalyticsGuard.beforeFirebase` asynchronous or after `FirebaseInitProvider`.
- Moving `ForecastVisits.reserve`, `displayed`, or `failedBeforeDisplay` off `commit()`.
- Emulator device gates (executed by the coordinator after JVM verification).

## Acceptance criteria

- **AC1** `WeatherRepository` does not call `reserveWidgetAttempt()` while holding its monitor; it checks in-flight state under the lock, calls `reserveWidgetAttempt()` outside the lock, and re-checks under the lock (returning `LoadResult.Skipped` if a request started meanwhile). A JVM test proves `canLoad` returns while a blocking `reserveWidgetAttempt` holds a latch.
- **AC2** Changing 이용 통계 runs `Analytics.setCollectionEnabled` off the main thread, awaits the result in the popup, and shows `LOC_PRIVACY_SAVE_FAILED` on `false`. `Analytics` does not hold the monitor used by `track()`/`screen()`/`onOpened()` across `SharedPreferences.commit()` calls; a JVM test proves `setCollectionEnabled` on a background thread does not block a concurrent `screen()` call.
- **AC3** `TodayWeatherApp` schedules the `HandBackWriter` consent listener onto a single-thread background executor, keeping `@field:Keep consentListener` intact (`ListenerKeepTest` and `check_r8.py`). JVM tests prove the listener runs off the main looper and preserves write order. Comments in `TodayWeatherApp.kt` and `android/README.md` accurately describe listener threading.
- **AC4** Cold start with a stored "collecting" state performs a single `recordCollection(true)` commit with no intermediate `recordCollection(false)` write, while keeping `EarlyStartProvider` 3-step ordering and synchronous `AnalyticsGuard.beforeFirebase` (skipping its commit only when both measurement keys are present and `false`). All `AnalyticsTest` cases pass.
- **AC5** `ForecastVisits.visible` persists via `apply()`, while `reserve`, `displayed`, and `failedBeforeDisplay` continue to persist via `commit()`. `ForecastVisitsTest` passes with explicit `apply()` vs `commit()` assertions.
- **AC6** `./gradlew assembleDebug test` passes cleanly on the JVM.
