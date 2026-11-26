# Spec: whole app icon on the Android splash

Consumes [intent](../intent/android-splash-icon.md).

1. `Theme.TodayWeather.Starting` uses `@drawable/splash_icon_inset` as `windowSplashScreenAnimatedIcon`. Background (#FFFFFF), duration (200 ms) and `postSplashScreenTheme` stay.
2. `splash_icon_inset` draws the imported `splash_icon` scaled to half of its bounds, centred: an `inset` of 25% per side (API 26+), or 60 dp per side on API 24–25 (core-splashscreen draws the icon at 240 dp there).
3. For an icon area of side L (240 dp and 288 dp), every opaque pixel of the drawn icon lies within L/3 of the centre, the splash mask's safe circle.
4. `splash_icon.png` and the launcher icons are unchanged.
