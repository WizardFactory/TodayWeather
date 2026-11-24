# Spec: R8 shrinking and obfuscation of the Android release

Consumes [intent/android-r8.md](../intent/android-r8.md).

## Build (AC1)

- The `release` build type of `android/app` sets `isMinifyEnabled = true`, `isShrinkResources = true` and `proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")`. `debug` keeps neither.
- R8 writes `app/build/outputs/mapping/release/mapping.txt`. Its header holds `# pg_map_id:` and `# pg_map_hash: SHA-256 <hex>`, the SHA-256 of the lines after the header; the R8 marker of the app's dex holds the same ID as `pg-map-id`.
- Keep rules: the libraries' consumer rules and AGP's manifest rules cover the manifest's components, WorkManager workers, the Glance action callback, ViewModels, Firebase registrars and kotlinx.serialization serializers. `app/src/main/res/raw/keep.xml` keeps `@string/LOC_*`, the catalog `chartTexts` and `forecastTexts` read by `getIdentifier`. `app/proguard-rules.pro` holds no rule. `ResourceKeepTest` fails when a key read by name has no keep pattern or a new source file calls `getIdentifier`.
- With `app/google-services.json` present the Crashlytics plugin injects a random mapping ID resource and finalizes R8 with `uploadCrashlyticsMappingFileRelease` (plugin 3.0.7: `mappingFileUploadEnabled` defaults to the variant's minification). Without the file neither plugin is applied.

## Behavior (AC2)

No product behavior changes. Persisted state (`files/app_state.json`, widget preferences, WorkManager's database) written by an unminified build is read by the minified one: stored names are string literals or kept class names.

## Release tools (AC3)

`android/tools/release/check_r8.py <apk> <mapping.txt>`: one `ok`/`FAIL` line per check, then `- R8 mapping SHA-256: <hex>`. Fails (status 1) on no `classes*.dex`; a `~~D8` marker in any dex; no R8 marker with `pg-map-id` in a dex without an `~~L8` marker (the desugared library has its own); a mapping `pg_map_id` that is not one of those IDs; a mapping whose content SHA-256 differs from its header's. Status 2: usage or an unreadable file. `check-apk.sh` takes the mapping as a third argument, prints `check_r8.py`'s check lines, fails when it fails and adds the mapping SHA-256 to the identity lines. `scripts/release-notes.mjs` drafts an `R8 mapping SHA-256` field for Android.

## Documents (AC4)

`docs/operations/android-release.md` step 4 copies `mapping.txt` next to the signed APK, passes it to `check-apk.sh`, and states the Crashlytics upload, its network need and the random mapping ID; step 5 reads the crash buffer; step 7 uploads the mapping to Play as the version's deobfuscation file; step 9 keeps it; the rebuild comparison allows the mapping ID as its only difference.
