# Plan: whole app icon on the Android splash

Consumes [intent](../intent/android-splash-icon.md) and [spec](../specs/android-splash-icon.md).

| # | Change | Files | Check |
| --- | --- | --- | --- |
| 1 | Test: resolve the theme's splash icon at API 24 and 34 and 14 densities; check the child is the imported art at >= 40% size and its visible pixels fit the platform circle and the compat ring hole (1 px margin); on SDK 34 also render the drawable and check the drawn pixels (review round 1: CODEX-1, CODEX-2) | `app/src/test/.../SplashIconTest.kt` | Red on the current theme and on the 25%/60 dp insets |
| 2 | Inset drawable and theme switch | `res/drawable/splash_icon_inset.xml`, `res/drawable-v26/splash_icon_inset.xml`, `res/values/themes.xml` | Test green; `ImportedClientAssetsTest` green |
| 3 | Emulator screenshots of the cold-start splash | API 36 (`tw_api36_capture`), API 24 (`tw_api24`) | Complete icon visible |

Rejected: re-exporting a padded PNG (breaks the imported-asset provenance and hash test); `windowSplashScreenIconBackgroundColor` blue with foreground art only (no separate foreground asset exists; changes the look).

Rollback: revert the theme line; no data or migration involved.

## User scenarios

| ID | User and goal | Steps | Expected | Failure |
| --- | --- | --- | --- | --- |
| S1 | Android 12+ user opens the app | Cold start from the launcher | Splash shows the whole rounded icon with sun rays and bottom row, then the app | Corners, rays or bottom row cut off |
| S2 | Android 7–11 user opens the app | Cold start from the launcher | Same complete icon through core-splashscreen | Clipped icon or crash on inflating the drawable |
