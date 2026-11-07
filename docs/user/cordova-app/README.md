# TodayWeather Android app user manual (Cordova 1.1.1)

[Read the 32-page PDF](manual.pdf). The [editable source](manual.json) holds the same steps. The [screenshots](screenshots/) are actual captures of the app with their [provenance](screenshots/provenance.json).

The manual covers TodayWeather 1.1.1 on Android, built from client source `97b57689`, with Korean screens. Each step names a Korean label followed by its English meaning. Weather values are live production data from 7 November 2026; they show how to read the screens, not fixed results.

## Sections

Screen and overlay IDs refer to the [rewrite screen specification](../../rewrite/screen-specifications.md) and [overlays](../../rewrite/screen-overlays.md).

| Pages | User task | IDs |
| --- | --- | --- |
| 1–2 | First launch: access notice, choose a place | O01, S01 |
| 3–4 | Hourly weather: comparison with yesterday, hourly chart and details | S03 |
| 5 | Daily weather | S04 |
| 6–7 | Air quality and pollutant details | S05 |
| 8–15 | Saved places: search, add, switch, overseas, edit and delete, current location | S02, S03 |
| 16 | Notifications for a place | S09 |
| 17–24 | Menu and settings: units, startup page, refresh interval, themes | S06–S08, S03 |
| 25–28 | Weather warnings, nationwide weather and wind, nationwide air | S12, S10, S11 |
| 29–30 | Data sources and version; usage analytics and privacy choices | O10, S06 |
| 31–32 | Share; exit | O16, O15 |

## Differences from the rewrite specification

The rewrite package describes the older baseline `bd6640f2`. The manual follows the current app:

- S13 (purchase and ad removal) was removed in #2641.
- O05 (update information) was removed in 1.1.0.
- S14 (guide) is still in the source but users cannot reach it: its menu item has `ng-if="false"` (`client/www/index.html`).
- The menu now includes 선택적 이용 통계 (Optional usage analytics), 광고 개인정보 선택 (Ad privacy choices), 개인정보처리방침 (Privacy policy) and 이용약관 (Terms).
- Home-screen widgets were removed in 1.1.0, and TodayAir is retired.

## Not shown

- Android permission prompts: the capture tool grants location and notification permissions in advance.
- The ad privacy form: on the Korean emulator, no form appeared within four seconds of tapping 광고 개인정보 선택.
- Notification delivery and real ad units. The debug build shows Google test ads ("테스트 광고") at the bottom.
- iOS.

## Reproduce

Prerequisites: macOS with Android SDK platform 36 and an API 36 emulator image, JDK 17, Gradle 8.14 on `PATH`, and Node 22.12 or later. The client also needs its private build inputs: `client/.env` and the Firebase configuration named there (see the [mobile application build](../../../README.md#mobile-application)).

1. In `client/`, run `npm ci` and `npm run www`.
2. Build the capture APKs with the [native harness](../../../scripts/verification/rewrite/native/README.md): `scripts/verification/rewrite/native/build-harness.sh android full`, and later `… android manual`.
3. Set the emulator's locale to `ko-KR` and its time zone to Asia/Seoul. Pin adb to the emulator with `ANDROID_SERIAL`, because the driver reinstalls the app on the selected device. Then run `node scripts/verification/rewrite/native/run.mjs android /tmp/tw-harness/app-debug.apk <output-dir>` for each APK.
4. Select the captures listed in `screenshots/provenance.json`. Downscale them to 720×1600 and reduce them to a 256-color palette.
5. Build the PDF with the screenshot-manual skill: `python build_manual.py docs/user/cordova-app/manual.json manual.pdf --font "/Library/Fonts/Arial Unicode.ttf"`. Use any TTF that covers Hangul and the symbols ☰, ← and µ. Render every page and inspect it before replacing `manual.pdf`.

The capture tool calls only public read APIs and answers push writes locally. It writes nothing to production.

Related: the Android native app plan in #2877 uses this manual as its readable parity reference.
