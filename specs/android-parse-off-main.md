# Spec: Android parse and convert off the main thread

Consumes [intent](../intent/android-parse-off-main.md) and PERF-5 (#3233).

## Weather response parsing and conversion

1. `WeatherRepository` accepts `compute: CoroutineDispatcher = Dispatchers.Default` placed immediately after `io` so existing 2-5 argument positional callers keep compiling.
2. In `WeatherRepository.load`, only `NationSource.strictJson` and `WeatherConverter.convert` run inside `withContext(compute)`. Both calls sit outside every `synchronized` block and before `commits.withLock`.
3. `CancellationException` thrown while suspended on `compute` propagates as coroutine cancellation rather than being converted into `LoadResult.Failed`.
4. Request ordering and invariants remain exact:
   - Inside `synchronized(this)`: widget in-flight check, `reserveWidgetAttempt()`, `inFlightLocations`/`running` updates, and `++requests` -> `latestRequest[key]`.
   - `finally` clears `inFlightLocations`/`running` only if the request is still latest.
   - `fetched(...)` telemetry runs on the caller's dispatcher right after `strictJson`, never inside `compute`.
   - `latest(key, request)` is checked twice on the caller's dispatcher: before `WeatherConverter.convert` and again inside `commits.withLock`.
   - Inside `commits.withLock`: `cached(place)` -> build entry -> `loadTimes` (`synchronized`) -> `entries.update` -> `writeCache`.
   - All `StateFlow` updates (`running`, `entries`) and return handling remain on the caller's dispatcher.
5. Unused coordinate forecast/warning helpers (`coordinateAirForecast`, `coordinatePollenForecast`, `coordinateWarnings`) are left unchanged.

## Nationwide and warning parsing

6. `NationSource` accepts `compute: CoroutineDispatcher = Dispatchers.Default` after `specialHttp`.
   - `NationSource.nation` runs `strictJson` and `NationResponse(...)` construction inside `withContext(compute)`, rethrowing `CancellationException` and returning `PageLoad.Failed` for parse/shape errors.
   - `NationSource.special` runs `runCatching { strictJson(body) }.getOrDefault(JsonNull)` inside `withContext(compute)`, rethrowing `CancellationException`.
7. `NationLoads` accepts `compute: CoroutineDispatcher = Dispatchers.Default` after `timeZone`.
   - In `NationLoads.open` for `NationRoutes.WARNINGS`, `languages()` and `timeZone()` are read on the caller's dispatcher (Main), then `WarningCards.cards(Warnings.parse(...))` runs inside `withContext(compute)`.
   - All `states` (`MutableStateFlow`) and `jobs` (`HashMap`) accesses stay strictly on the caller's dispatcher (Main).

## Test determinism

8. Unit and Robolectric tests that rely on deterministic scheduling (`runCurrent`, `advanceUntilIdle`, `rule.waitForIdle`) inject deterministic test dispatchers (`StandardTestDispatcher(testScheduler)` or `Dispatchers.Unconfined`) for `compute` matching their `io` setup.

## Non-goals

Changing HTTP client threading, modifying `commits.withLock` structure (PERF-6), changing widget workers, or altering weather/nationwide UI output.
