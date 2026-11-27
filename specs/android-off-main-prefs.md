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
   - Acquire `synchronized(this)` to check `key in inFlightLocations || location in inFlightLocations.values`; release the lock immediately. If busy, return `LoadResult.Skipped` without calling `reserveWidgetAttempt()`.
   - Call `reserveWidgetAttempt()` **outside** `synchronized(this)`. If it returns `false`, return `LoadResult.Skipped`.
   - Re-acquire `synchronized(this)` and re-check `key in inFlightLocations || location in inFlightLocations.values`. If a request started meanwhile, return `LoadResult.Skipped` without modifying `inFlightLocations`, `running`, or `latestRequest` (at most one wasted reservation, never an extra network request).
   - Do not install a provisional in-flight marker in `inFlightLocations` while reserving.
5. Foreground loads (`reserveWidgetAttempt == null`) keep the exact existing single `synchronized(this)` registration.

## Site 3: Usage analytics choice & Cordova hand-back

6. `PrivacyActions.setAnalytics` becomes `suspend (Boolean) -> Boolean`.
   - `MainActivity` wires it to run `app.analytics.setCollectionEnabled(value)` on a single-thread-serialized IO dispatcher (`app.analyticsWriter = Dispatchers.IO.limitedParallelism(1)`) inside `app.appScope.async(...)` so a started consent save is not cancelled by activity recreation and sequential choices execute in FIFO order off Main.
   - `AppContent`'s `AnalyticsPopup` `choose(value)` closes the popup immediately and launches in `rememberCoroutineScope()` to await `actions.setAnalytics(value)`, setting `privacyAlert = R.string.LOC_PRIVACY_SAVE_FAILED` when it returns `false`.
7. `Analytics` splits its synchronization into two locks with strict hierarchy (`transitionLock` -> `stateLock`):
   - `transitionLock` serializes `start()` and `setCollectionEnabled(value)` so consent transitions never interleave.
   - `stateLock` guards in-memory state (`enabled`, `lastScreen`, `pendingScreen`, `choiceFlow`) and SDK calls (`setCollectionEnabled`, `setConsent`, `logEvent`). `track()`, `screen()`, and `onOpened()` acquire **only** `stateLock`.
   - Every `ConsentStore` disk call (`startChoice`, `write`, `recordCollection`) runs **outside** `stateLock`, so Main-thread `track()`/`screen()`/`onOpened()` never wait on a `SharedPreferences.commit()` fsync.
   - On withdrawal (`value == false`), `enabled = false`, `choiceFlow.value = false`, `pendingScreen = null`, and `stopSdk()` happen under `stateLock` before `store.write(false)`.
8. `TodayWeatherApp` creates a dedicated single-thread daemon executor (`handBackExecutor`) and passes `handBackExecutor::execute` to `handBack.watchConsent(...)` in `onCreate()`.
   - `HandBackWriter.consentListener` keeps its exact name, visibility, type, and `@field:Keep` annotation (`ListenerKeepTest` and `check_r8.py` `KEPT_FIELDS`).
   - Comments in `TodayWeatherApp.kt`, `HandBack.kt`, and `android/README.md` are updated to state that Android notifies `SharedPreferences` listeners on the main thread and that the hand-back runs on a single background executor to stay off Main and preserve write order.

## Site 4: Interstitial allowance (`ForecastInterstitial` / `ForecastVisits`)

9. `ForecastVisits` separates best-effort async persistence for `visible(tab)` (`saveAsync: (ForecastAdDay) -> Unit`, defaulting to `{ save(it) }`) from durable persistence for `reserve`, `displayed`, and `failedBeforeDisplay` (`save: (ForecastAdDay) -> Boolean`).
10. `ForecastInterstitial` constructs `ForecastVisits` through an internal `forecastVisits(prefs, today, draw, chance)` helper where:
    - `saveAsync` writes all fields (`day`, `hourly`, `daily`, `spent`) and calls `apply()`.
    - `save` writes all fields and calls `commit()`.
11. `apply()` is used **only** for `visible(tab)` to avoid queuing durable interstitial reservations into `QueuedWork.waitToFinish`.

## Non-goals

Changing the Cordova hand-back schema/retention policy, altering `WidgetRefresh.reserveAttempt` durability, moving `ForecastVisits.reserve` off Main, or running emulator tests in this step.
