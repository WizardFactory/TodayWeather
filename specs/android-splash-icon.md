# Spec: whole app icon on the Android splash

Consumes [intent](../intent/android-splash-icon.md).

1. `Theme.TodayWeather.Starting` uses `@drawable/splash_icon_inset` as `windowSplashScreenAnimatedIcon`. Background (#FFFFFF), duration (200 ms) and `postSplashScreenTheme` stay.
2. `splash_icon_inset` draws the imported `splash_icon` at 48% of its bounds, centred: an `inset` of 26% per side (API 26+), or 63 dp per side on API 24–25 (core-splashscreen draws the icon at 240 dp there).
3. Every visible pixel of the drawn icon lies inside the mask at every screen density, with a 1 px margin: within L/3 of the centre for Android 12+ (L = 240 dp and 288 dp), and inside core-splashscreen's ring hole (mask size / 2 − stroke, each rounded to whole pixels) for the compat path. The art covers at least 40% of the icon side.

4. `splash_icon.png` and the launcher icons are unchanged.
5. The test identifies the drawn child as the `splash_icon` resource (same `ConstantState`), whose bytes `ImportedClientAssetsTest` pins, on every SDK it runs (review round 2, CODEX-1).

Amendment (review round 1, CODEX-2; wording per round 2, CODEX-3): with the first values (25%, 60 dp) the compat hole, rounded to whole pixels, actually clipped the art at 180 dpi: a visible pixel's centre was 89.14 px from the centre, against an 88.5 px hole. At 120 dpi the art stayed inside the hole (59.05 px against 59.5 px) but within the test's 1 px margin. At 160 dpi a drawn pixel's edge reached 79.04 px against a 79 px hole. The margin and the new values (26%, 63 dp) keep every density clear of the hole's edge.
