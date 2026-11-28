# Plan: drop unused Places Autocomplete activities from Android release APK

Consumes [intent](../intent/android-drop-places-activities.md) and [spec](../specs/android-drop-places-activities.md).

| # | Change | Files | Check |
| --- | --- | --- | --- |
| 1 | Measure baseline `assembleRelease` on master (`d5d4cd05e`) with private env vars (without `google-services.json`) | `reports/sdlc/android-drop-places-activities/logs/baseline-release.log` | Record APK bytes, dex/mapping class counts, `aapt2 dump resources` count, and exact Places activity names in merged release manifest |
| 2 | Add `xmlns:tools` and `tools:node="remove"` entries for the three verified Places widget activities with explanatory comment | `android/app/src/main/AndroidManifest.xml` | Merged release manifest contains zero `com.google.android.libraries.places.widget.*` activities |
| 3 | Rebuild `assembleRelease` with identical env inputs and compare before/after metrics + run `check_r8.py` | `reports/sdlc/android-drop-places-activities/logs/branch-release.log` | `check_r8.py` exits 0; record exact APK size, class count, and resource count deltas |
| 4 | Run full debug build and JVM test suite | `reports/sdlc/android-drop-places-activities/logs/full-test.log` | `./gradlew assembleDebug test` exits 0 (`ResourceKeepTest` and `ListenerKeepTest` pass) |
| 5 | Emulator place-search smoke (coordinator) | `android/tools/emulator/run-production-start.sh`, live S02 Places search check | Google Places predictions work on S01 and S02 (`London` predictions + opened weather preview) with `TW_PLACES_API_KEY_ANDROID` (`ProductionPlacesTest.kt:94` master drift from #3180 left out of scope) |

Rejected: excluding transitive AppCompat/Material dependencies in Gradle — unsafe if another library transitively requires classes at compile time; manifest `tools:node="remove"` lets R8 and resource shrinking compute exact reachability safely.

Rollback: revert the three `<activity ... tools:node="remove" />` entries in `android/app/src/main/AndroidManifest.xml`.

## User scenarios

| ID | User and goal | Steps | Expected | Failure |
| --- | --- | --- | --- | --- |
| S1 | New user searching a city on S01 | Open start screen, type a city name with Places API key configured | Google Places autocomplete predictions appear and selecting one loads weather | Search fails, crashes, or silently falls back to bundled towns |
| S2 | Release engineer building and checking APK | Build `assembleRelease`, inspect merged manifest, run `check_r8.py` | No Places widget activities in merged manifest; `check_r8.py` passes; measurable APK size comparison recorded | Missing kept listener field, broken R8 check, or activities still merged |
| S3 | CI running PR checks | Run `./gradlew assembleDebug test` | Build and all JVM tests (`ResourceKeepTest`, `ListenerKeepTest`, etc.) pass | Test or manifest merge failure |
