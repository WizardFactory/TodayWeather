# Spec: R8 shrinking and obfuscation of the Android release

Consumes [intent/android-r8.md](../intent/android-r8.md).

## Build (AC1)

- The `release` build type of `android/app` sets `isMinifyEnabled = true`, `isShrinkResources = true` and `proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")`. `debug` keeps neither.
- R8 writes `app/build/outputs/mapping/release/mapping.txt`. Its header holds `# pg_map_id:` and `# pg_map_hash: SHA-256 <hex>`, the SHA-256 of the lines after the header; the R8 marker of the app's dex holds the same ID as `pg-map-id`.
- Keep rules: the libraries' consumer rules and AGP's manifest rules cover the manifest's components, WorkManager workers, the Glance action callback, ViewModels, Firebase registrars and kotlinx.serialization serializers. `app/src/release/res/raw/keep.xml` (release source set only) keeps `@string/LOC_*`, the catalog `chartTexts` and `forecastTexts` read by `getIdentifier`. `app/proguard-rules.pro` holds no rule. `ResourceKeepTest` fails when a key read by name has no keep pattern, or when `getIdentifier` appears other than once in each of `ChartStrings.kt` and `ForecastStrings.kt` among the app's Kotlin and Java sources.
- With `app/google-services.json` present the Crashlytics plugin injects a random mapping ID resource and finalizes R8 with `uploadCrashlyticsMappingFileRelease` (plugin 3.0.7: `mappingFileUploadEnabled` defaults to the variant's minification). Without the file neither plugin is applied.

## Behavior (AC2)

No product behavior changes. Persisted state (`files/app_state.json`, widget preferences, WorkManager's database) written by an unminified build is read by the minified one: stored names are string literals or kept class names.

## Release tools (AC3)

`android/tools/release/check_r8.py <apk> <mapping.txt>`: one `ok`/`FAIL` line per check, then `- R8 mapping SHA-256: <hex>`. Fails (status 1) on no `classes*.dex`; a `~~D8` marker in any dex; no R8 marker with a `pg-map-id` string in a dex without an `~~L8` marker (the desugared library has its own), or such a marker with a `pg-map-id` that is not a non-empty string; app dex files naming more than one ID, or one that is not the mapping's `pg_map_id`; a mapping that renames no more of the app's classes (`net.wizardfactory.todayweather.*`) than it keeps under their names (not obfuscated); a mapping that removes none of them (no `R8$$REMOVED$$CLASS$$<n>`, not shrunk); a mapping whose content SHA-256 differs from its header's. Status 2: usage or an unreadable file. `check-apk.sh` takes the mapping as a third argument, prints `check_r8.py`'s check lines, fails when it fails and adds the mapping SHA-256 to the identity lines. `scripts/release-notes.mjs` drafts an `R8 mapping SHA-256` field for Android, an identity of the build; the uploads go into `Store status`. `gradle-release.sh --without-crashlytics-upload` builds without the Crashlytics mapping upload, for the byte-comparison rebuild only.

## Documents (AC4)

`docs/operations/android-release.md` step 4 copies `mapping.txt` next to the signed APK, passes it to `check-apk.sh`, and states the Crashlytics upload, its network need and the random mapping ID; step 5 reads the crash buffer; step 7 uploads the mapping to Play as the version's deobfuscation file; step 9 keeps it; the rebuild comparison builds without the Crashlytics upload and allows the mapping ID as its only difference.

## Amendment 2026-11-24: fields kept for weakly held listeners (AC5–AC7)

Consumes the intent amendment of the same date.

- A field that only holds a listener a registry keeps weakly is written but never read, so R8 removes it and the listener can be collected. In the app this is `HandBackWriter.consentListener` (the analytics choice's `OnSharedPreferenceChangeListener`, `HandBack.kt`); it carries `@field:Keep` (`androidx.annotation.Keep`), which AndroidX's `annotation` consumer ProGuard rules (`META-INF/proguard/androidx-annotations.pro`) keep, so `app/proguard-rules.pro` still holds no rule. Other registrations (network callback, broadcast receivers, Play services task listeners) are held strongly by their registries.
- `check_r8.py` also fails when no dex file of the APK declares an entry of `KEPT_FIELDS` in its `class_defs` / `class_data_item` field lists, under the names the mapping gives the class (its class line; none when the class was removed) and the field (its field line `<type> <name> -> <new name>`, or the field's own name: R8 9.5 writes no line for a member it keeps under its own name): `FAIL R8 removed <class>.<field>`. A field reference in `field_ids` without a class declaration, or a string of the same name elsewhere, does not count. `ListenerKeepTest` (app, JVM) fails when `registerOnSharedPreferenceChangeListener` is called anywhere but in `HandBack.kt`, when the field lacks `@field:Keep`, or when `KEPT_FIELDS` does not name it.
