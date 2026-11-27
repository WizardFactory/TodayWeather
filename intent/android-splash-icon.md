# Intent: show the whole app icon on the Android launch splash

- Task: `android-splash-icon` (issue #3223, sub-issue of #2877). Mode: implementation. Change kind: behavior (splash resource). Endpoint: **pre-merge** (no merge, release or store action).
- Source and authority: AK, 2026-11-27: "Sub issues로 만들고 premerge까지 진행", after the 2026-11-26 report "Splash screen에서 앱아이콘의 가장자리들이 짤려서 표시됨" on the Play 2.0.1 build.

## Problem

`Theme.TodayWeather.Starting` uses the imported `splash_icon.png`, a 512 px rounded square that fills its canvas. Android 12+ (and core-splashscreen on older versions) shows only the centre of the splash icon, inside a mask whose diameter is two thirds of the icon area, so the sun rays, the corners and the bottom weather row are cut off.

## Outcome

The splash shows the complete icon on a white background, on Android 12+ (including Samsung's squircle mask) and on Android 7–11 through core-splashscreen. The launcher icon and the imported asset stay unchanged.

## Scope and exclusions

In scope: the splash icon resource used by `Theme.TodayWeather.Starting`, a JVM test, the Android README if it describes the splash. Out of scope: launcher icon, iOS launch screen, splash duration, `client/`.

## Acceptance criteria

- **AC1** A JVM test fails on the current splash icon and passes after the change: at the platform and compat icon sizes, no opaque pixel of the drawn icon lies outside the centred circle of diameter 2/3 of the icon area.
- **AC2** Cold-start splash screenshots on an API 36 emulator and an API 24–30 emulator show the complete icon (rounded square, sun rays, bottom row), attached to the PR.
- **AC3** The launcher icon and the imported `splash_icon.png` are unchanged (`ImportedClientAssetsTest` passes) and `./gradlew :app:testDebugUnitTest` passes.
