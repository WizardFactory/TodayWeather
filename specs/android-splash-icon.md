# Spec: whole app icon on the Android splash

Consumes [intent](../intent/android-splash-icon.md).

1. `Theme.TodayWeather.Starting` uses `@drawable/splash_icon_inset` as `windowSplashScreenAnimatedIcon`. Background (#FFFFFF), duration (200 ms) and `postSplashScreenTheme` stay.
2. `splash_icon_inset` draws the imported `splash_icon` at 48% of its bounds, centred: an `inset` of 26% per side (API 26+), or 63 dp per side on API 24–25 (core-splashscreen draws the icon at 240 dp there).
3. Every visible pixel of the drawn icon lies inside the mask at every screen density, with a 1 px margin: within L/3 of the centre for Android 12+ (L = 240 dp and 288 dp), and inside core-splashscreen's ring hole (mask size / 2 − stroke, each rounded to whole pixels) for the compat path. The art covers at least 40% of the icon side.

Amendment (review round 1, CODEX-2): the first values (25%, 60 dp) left the art 0.5–0.6 px outside the rounded compat hole at some densities (120, 160, 180 dpi).
4. `splash_icon.png` and the launcher icons are unchanged.
