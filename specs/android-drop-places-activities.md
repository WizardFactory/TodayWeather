# Spec: drop unused Places Autocomplete activities from Android release APK

Consumes [intent](../intent/android-drop-places-activities.md) and issue #3235 (`PERF-7`).

## Manifest stripping

1. `android/app/src/main/AndroidManifest.xml` declares `xmlns:tools="http://schemas.android.com/tools"` on `<manifest>`.
2. Inside `<application>`, the manifest removes the three unused Google Places widget activities using `tools:node="remove"`:
   - `com.google.android.libraries.places.widget.BasicPlaceAutocompleteActivity`
   - `com.google.android.libraries.places.widget.PlaceAutocompleteActivity`
   - `com.google.android.libraries.places.widget.internal.placedetails.photoviewer.PlacesLightboxActivity`
3. An inline XML comment explains that only `PlacesClient` and `FindAutocompletePredictionsRequest` (`PlaceSearch.kt`) are used, that these removals must be reversed if Places widget UI is ever adopted, and that the merged release manifest should be re-checked after Places SDK upgrades.

## Unchanged contracts and keeps

4. `PlaceSearch.kt` (`Places.initializeWithNewPlacesApiEnabled`, `PlacesClient`, `FindAutocompletePredictionsRequest`) and S01 place search behavior remain unchanged.
5. No R8 or resource keep rules are modified (`proguard-rules.pro`, `keep.xml`, `@field:Keep consentListener`, WorkManager workers, Glance callbacks, Cordova notification components).

## Verification requirements

6. Before/after `assembleRelease` builds use identical environment inputs (with `TW_ADMOB_*` and `TW_PLACES_API_KEY_ANDROID`, without `google-services.json` so Crashlytics upload is not triggered) and compare APK bytes, dex/mapping class counts, and `aapt2 dump resources` counts.
7. `android/tools/release/check_r8.py` passes on the resulting release APK and mapping file.
8. `./gradlew assembleDebug test` passes cleanly, keeping `ResourceKeepTest` and `ListenerKeepTest` green.
9. Emulator smoke (`run-production-start.sh` and `run-production-places.sh`) verifies live Places predictions on an emulator with `TW_PLACES_API_KEY_ANDROID`.

## Non-goals

Removing `com.google.android.libraries.places:places`, altering R8 keep rules, or optimizing AdMob / Play services dependencies.
