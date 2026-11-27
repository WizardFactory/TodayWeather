# Intent: drop unused Places Autocomplete activities from Android release APK

- Task: `android-drop-places-activities` (issue #3235, sub-issue of #2877). Mode: implementation. Change kind: behavior (packaging/size only, no visible UI or place-search behavior change). Endpoint: **pre-merge** (no merge, release or store action).
- Source and authority: 2026-11-27 Android R8 configuration analysis (§6.1) and issue #3235 (`PERF-7`, optional size-only improvement).

## Problem

The Google Places SDK (`places`) merges three widget activities into the app's release manifest (`BasicPlaceAutocompleteActivity`, `PlaceAutocompleteActivity`, and `PlacesLightboxActivity`), even though TodayWeather never opens Places widget UI and calls only `Places.initializeWithNewPlacesApiEnabled`, `PlacesClient`, and `FindAutocompletePredictionsRequest` (`PlaceSearch.kt`). Because AAPT2 keeps every manifest-declared activity and its referenced layouts, R8 and resource shrinking retain the unused Places widget classes and pulled-in AppCompat/Material resources.

## Outcome

The three unused Places widget activities are removed from the merged Android manifest via `tools:node="remove"` so R8 and resource shrinking can drop unreachable widget code and resources, with S01 place search (`GooglePlaceSearch`) and all existing keep rules unchanged. Before/after release APK size, dex class count, and resource count are measured on the same build setup so AK can confirm whether the size savings justify adoption.

## Scope and exclusions

In scope: `android/app/src/main/AndroidManifest.xml`, task intent/spec/plan docs, and reproducible before/after release APK size/class/resource measurements.
Out of scope: modifying `proguard-rules.pro` or any existing keep rules (`LOC_*` in `keep.xml`, `@field:Keep consentListener`, WorkManager workers, Glance `ManualWeatherRefreshAction`, Cordova notification components), changing `PlaceSearch.kt`, iOS, web, server, or store release.

## Acceptance criteria

- **AC1** The merged release manifest contains none of the three Places widget activities (`com.google.android.libraries.places.widget.BasicPlaceAutocompleteActivity`, `com.google.android.libraries.places.widget.PlaceAutocompleteActivity`, `com.google.android.libraries.places.widget.internal.placedetails.photoviewer.PlacesLightboxActivity`).
- **AC2** Before/after release builds with identical private inputs record release APK size (bytes and KB delta), dex/mapping class count, and `aapt2 dump resources` count.
- **AC3** `./gradlew assembleDebug test` passes (including `ResourceKeepTest` and `ListenerKeepTest`), and `android/tools/release/check_r8.py` passes on the release APK and mapping.
- **AC4** Emulator smoke (`run-production-start.sh` with Google Places predictions and `run-production-places.sh`) passes with `TW_PLACES_API_KEY_ANDROID` configured.
