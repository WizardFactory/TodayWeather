# Plan: Android parse and convert off the main thread

Consumes [intent](../intent/android-parse-off-main.md) and [spec](../specs/android-parse-off-main.md) for issue #3233 (PERF-5).

| # | Change | Files | Check |
| --- | --- | --- | --- |
| 1 | TDD Red: add constructor parameter `compute` (initially unused) and failing JVM tests proving `WeatherRepository.load`, `NationSource`, and `NationLoads` queue parsing/conversion on `compute` and preserve supersede ordering during off-main parse | `WeatherRepository.kt`, `NationSource.kt`, `NationLoads.kt`, `WeatherRepositoryTest.kt`, `NationSourceTest.kt`, `NationLoadsTest.kt`, `WeatherTelemetryTest.kt` | Focused Gradle test run fails on behavioral assertions (not compile errors); log saved to `reports/sdlc/android-parse-off-main/logs/tdd-red.log` |
| 2 | Wrap `strictJson` and `WeatherConverter.convert` in `withContext(compute)` in `WeatherRepository.load`, preserving `CancellationException`, lock/request ordering, both `latest(key, request)` checks, and caller-dispatcher telemetry/state publication | `android/core-data/.../WeatherRepository.kt` | `WeatherRepositoryTest` passes |
| 3 | Wrap `NationSource.nation` and `NationSource.special` parsing and `NationLoads` warning-card building in `withContext(compute)`, keeping `NationLoads` `states`/`jobs` on Main | `android/core-data/.../NationSource.kt`, `android/app/.../ui/nation/NationLoads.kt` | `NationSourceTest` and `NationLoadsTest` pass; log saved to `reports/sdlc/android-parse-off-main/logs/tdd-green.log` |
| 4 | Inject deterministic test dispatchers for `compute` in existing JVM and Robolectric tests so `runCurrent()`/`waitForIdle()` tests remain deterministic | `android/core-data/src/test/...`, `android/app/src/test/...` | `./gradlew --no-daemon -Dorg.gradle.jvmargs="-Xmx2g" -Dorg.gradle.workers.max=2 assembleDebug test` passes; log saved to `reports/sdlc/android-parse-off-main/logs/full-test.log` |
| 5 | Emulator smoke and before/after main-thread profiling (coordinator) | PR evidence | Two saved places swipe, pull to refresh, nationwide page; main-thread time before/after |

Rejected: moving `fetched(...)` telemetry inside `compute` (risks running `@Synchronized Analytics.track` on background threads while holding app locks); moving `NationLoads.open` body wholesale onto `compute` (would race plain `HashMap` `jobs`); touching unused `coordinate*` methods (out of scope).

Rollback: revert the commit; `compute` defaults to `Dispatchers.Default` and no persisted data format changes.

## User scenarios

| ID | User and goal | Steps | Expected | Failure |
| --- | --- | --- | --- | --- |
| S1 | Reader opening app or swiping places | Load weather for saved places on Main | `strictJson` and `WeatherConverter.convert` run on `compute`, UI state updates on Main | Main-thread stall during parse/convert |
| S2 | Rapid place refresh | Trigger a second load while the first is parsing on `compute` | Newer load commits; older load returns `Superseded` and does not overwrite memory or cache | Stale weather overwrites newer entry/cache |
| S3 | Reader opening nationwide or warnings page | Open Nation, Nation Air, or KMA Special | JSON parse and warning card building run on `compute`; page state updates on Main | Main-thread stall on 654 KB payload or `HashMap` race |
