# Spec: Android off-main preference writes and lock waits

Consumes [intent](../intent/android-off-main-prefs.md) and PERF-6 (#3238).

## Site 1: Startup (`EarlyStartProvider` -> `Analytics`)

1. `EarlyStartProvider.onCreate()` preserves its exact 3-step order before `FirebaseInitProvider` (`initOrder="1000"`):
   1. `AnalyticsGuard.beforeFirebase(context!!)`
   2. `HandBackConsent.beforeStart(context!!)`
   3. `(context!!.applicationContext as TodayWeatherApp).startAnalytics()`
2. `AnalyticsGuard.beforeFirebase(context)` stays synchronous. It skips the `commit()` only when both `measurement_enabled_from_api` and `measurement_enabled` keys exist in `com.google.android.gms.measurement.prefs` and both read as `false` (falling back to committing both `false` if reading throws or either key is missing/`true`).
3. In `Analytics.applyCollection(value, storeOnFailure)`:
   - When `value == false`: turns SDK off (`setCollectionEnabled(false)`, `setConsent(false)`) and commits `store.recordCollection(false)`.
   - When `value == true`: turns SDK off and sets consent (`setCollectionEnabled(false)`, `setConsent(true)`), then directly checks `store.recordCollection(true)` without an intermediate `store.recordCollection(false)` commit, then enables SDK collection (`setCollectionEnabled(true)`).
   - Any exception still runs `stopSdk()`, clears `choiceFlow`/`pendingScreen`, commits `store.recordCollection(false)`, and commits `store.write(false)` when `storeOnFailure` is `true`.

## Site 2: Widget reservation in `WeatherRepository.load`

4. When `reserveWidgetAttempt != null`:
   - Acquire `synchronized(this)` to check `key in inFlightLocations || location in inFlightLocations.values`, and snapshot `latestRequest[key]` and `locationStartGeneration[location]`; release the lock immediately. If busy, return `LoadResult.Skipped` without calling `reserveWidgetAttempt()`.
   - Call `reserveWidgetAttempt()` **outside** `synchronized(this)`. If it returns `false`, return `LoadResult.Skipped`.
   - Re-acquire `synchronized(this)` and re-check `key in inFlightLocations || location in inFlightLocations.values || latestRequest[key] != keyGenBefore || locationStartGeneration[location] != locGenBefore`. If any request for that `key` or `location` started meanwhile (even if its HTTP phase already finished while conversion is still running or committed), return `LoadResult.Skipped` without modifying `inFlightLocations`, `running`, `latestRequest`, or `locationStartGeneration`.
   - Every request registration inside `synchronized(this)` updates both `latestRequest[key]` and `locationStartGeneration[location]`.
   - Do not install a provisional in-flight marker in `inFlightLocations` while reserving.
5. Foreground loads (`reserveWidgetAttempt == null`) keep the exact existing single `synchronized(this)` registration (also recording `locationStartGeneration[location]`).

## Site 3: Usage analytics choice & Cordova hand-back

6. `TodayWeatherApp` owns an `AnalyticsChoiceController` backed by `appScope` and a single-thread-serialized IO dispatcher (`app.analyticsWriter = Dispatchers.IO.limitedParallelism(1)`):
   - `PrivacyActions` wires `setAnalytics: (Boolean) -> Unit` (`controller::submit`), `saveFailure: StateFlow<PrivacySaveFailure?>`, `consumeFailure: (Long) -> Unit`, and `onPopupOpened: () -> Unit`.
   - `AppContent`'s `AnalyticsPopup` `choose(value)` closes the popup immediately and calls `privacy.setAnalytics(value)`. `controller.submit(value)` registers the choice generation immediately via `analytics.beginChoice(value)` (stopping collection and SDK at once on `false` under `stateLock` only) and launches `analytics.commitChoice(value, id)` on `appScope` + `analyticsWriter` so Activity recreation neither cancels the commit nor drops `LOC_PRIVACY_SAVE_FAILED`.
   - Reopening `AnalyticsPopup` invokes `privacy.onPopupOpened()`, suppressing any earlier in-flight failure so a stale alert cannot overlap the reopened popup; dismissing the alert consumes it once via `consumeFailure(requestId)`.
7. `Analytics` splits its synchronization into two locks with strict hierarchy (`transitionLock` -> `stateLock`) and tracks a monotonic `choiceGeneration` plus `collecting: StateFlow<Boolean>`:
   - `transitionLock` serializes `start()`, `setCollectionEnabled(value)`, and `commitChoice(value, generation)` so consent transitions never interleave.
   - `stateLock` guards in-memory state (`enabled`, `collectingFlow`, `lastScreen`, `pendingScreen`, `choiceFlow`, `choiceGeneration`) and SDK calls (`setCollectionEnabled`, `setConsent`, `logEvent`). `track()`, `screen()`, `onOpened()`, and `beginChoice()` acquire **only** `stateLock`.
   - Every `ConsentStore` disk call (`startChoice`, `write`, `recordCollection`) and suite hand-back (`onChoiceWritten`) runs **outside** `stateLock`, so Main-thread `track()`/`screen()`/`onOpened()`/`beginChoice()` never wait on a `SharedPreferences.commit()` fsync.
   - After `store.write(value)` succeeds, `commitChoice` executes `onChoiceWritten` (wired to `handBack::rewrite` in `TodayWeatherApp`) on the serialized background writer **before** enabling the SDK or returning `ChoiceOutcome.APPLIED`. A failed hand-back rolls back a grant (SDK off, `recordCollection(false)`, `write(false)`, best-effort `onChoiceWritten()`) and reports `ChoiceOutcome.FAILED`; a failed `applyCollection` rollback also calls best-effort `onChoiceWritten()`.
   - If a newer `beginChoice` supersedes an in-flight `commitChoice` (including while blocked in `store.recordCollection(true)`), the superseded commit does not enable the SDK or flush `pendingScreen`, ensures SDK stays off and writes `store.recordCollection(false)` if needed, and returns `ChoiceOutcome.SUPERSEDED`.
   - `Analytics.collecting` becomes `true` only under `stateLock` after `store.recordCollection(true)` and `sdk.setCollectionEnabled(true)` succeed; `AdsDeviceTest` awaits `app.analytics.collecting.value`.
8. `TodayWeatherApp` keeps a dedicated single-thread daemon executor (`handBackExecutor`) and passes `handBackExecutor::execute` to `handBack.watchConsent(...)` in `onCreate()` for any non-`setCollectionEnabled` writes to `tw_analytics_consent`.
   - `HandBackWriter.consentListener` keeps its exact name, visibility, type, and `@field:Keep` annotation (`ListenerKeepTest` and `check_r8.py` `KEPT_FIELDS`).
   - Comments in `TodayWeatherApp.kt`, `HandBack.kt`, and `android/README.md` document both the synchronous hand-back commit on `analyticsWriter` for user choice saves and the kept preference listener scheduling `handBackExecutor` off Main for other writes.

## Site 4: Interstitial allowance (`ForecastInterstitial` / `ForecastVisits`)

9. `ForecastVisits` separates best-effort async persistence for `visible(tab)` (`saveAsync: (ForecastAdDay) -> Unit`, defaulting to `{ save(it) }`) from durable persistence for `reserve`, `displayed`, and `failedBeforeDisplay` (`save: (ForecastAdDay) -> Boolean`).
10. `ForecastInterstitial` constructs `ForecastVisits` through an internal `forecastVisits(prefs, today, draw, chance)` helper where:
    - `saveAsync` writes all fields (`day`, `hourly`, `daily`, `spent`) and calls `apply()`.
    - `save` writes all fields and calls `commit()`.
11. `apply()` is used **only** for `visible(tab)` to avoid queuing durable interstitial reservations into `QueuedWork.waitToFinish`.

## Non-goals

Changing the Cordova hand-back schema/retention policy, altering `WidgetRefresh.reserveAttempt` durability, moving `ForecastVisits.reserve` off Main, or running emulator tests in this step.
