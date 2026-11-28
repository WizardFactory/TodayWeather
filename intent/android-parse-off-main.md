# Intent: parse and convert weather and nationwide responses off the main thread

- Task: `android-parse-off-main` (issue #3233, sub-issue of #2877). Mode: implementation. Change kind: behavior (performance, no visible output change). Endpoint: **pre-merge** (no merge, release, store or Remote Config action).
- Source and authority: AK, 2026-11-27: PERF-5 from the 2026-11-27 Android ANR audit (finding A2), queued to land before PERF-6 because both touch `WeatherRepository.load`.

## Problem

`OkHttpGet.request` resumes coroutines on the caller's dispatcher, and the app's callers launch from `viewModelScope` or composition scopes on Main. Every weather load (85-101 KB JSON) and nationwide load (up to 654 KB JSON plus warning-card construction) therefore runs `NationSource.strictJson`, `WeatherConverter.convert`, `Warnings.parse`, and `WarningCards.cards` on the main thread during app start, resume reload, place swipe, 10-minute timer, refresh, place add, and nationwide page opens.

## Outcome

Weather and nationwide JSON parsing, validation, response conversion, and warning-card building run on an injected background dispatcher (`Dispatchers.Default` in production), while request ordering, supersede semantics, telemetry, cache consistency, and Main-thread state publication stay unchanged.

## Scope and exclusions

In scope:
- `android/core-data`: `WeatherRepository` and `NationSource` off-main parsing/conversion with injected `compute` dispatchers.
- `android/app`: `NationLoads` off-main warning parsing/card building with an injected `compute` dispatcher, keeping `states`/`jobs` updates on Main.
- JVM unit tests covering off-main dispatch, supersede-during-parse, and deterministic test dispatcher injection.

Out of scope:
- Unused parse sites (`coordinateAirForecast`, `coordinatePollenForecast`, `coordinateWarnings`).
- Widget background path (`WidgetRefresh`, already off Main).
- PERF-6 lock/cache changes, iOS, server, or releasing.

## Acceptance criteria

- **AC1** `WeatherRepository.load` runs `NationSource.strictJson` and `WeatherConverter.convert` on an injected `compute` dispatcher (`Dispatchers.Default` by default), outside every `synchronized` block and before `commits.withLock`; a JVM test proves the work is queued on `compute` and not run on the caller's dispatcher.
- **AC2** A JVM test proves that when a newer request for the same place completes while an older request's off-main parse/convert is queued on `compute`, the older request returns `LoadResult.Superseded` and leaves the newer in-memory entry and cache file intact.
- **AC3** Nationwide parsing (`NationSource.nation`, `NationSource.special`, and `NationLoads` `Warnings.parse`/`WarningCards.cards`) runs on an injected `compute` dispatcher while `NationLoads` `states` and `jobs` updates stay on Main; JVM tests prove the work is queued on `compute`.
- **AC4** `./gradlew assembleDebug test` passes, including `WeatherRepositoryTest`, `WeatherSessionTest`, `StartFlowTest`, `NationSourceTest`, `NationLoadsTest`, and `GoldenCorpusTest`.
- **AC5** Emulator smoke (two saved places, swipe, pull to refresh, nationwide page) and before/after main-thread profiling evidence are recorded for the PR (run by coordinator after implementation).
