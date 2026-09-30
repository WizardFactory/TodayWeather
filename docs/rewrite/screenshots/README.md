# Screenshot evidence

[Open the visual gallery](index.html) · [Screen definitions](../screen-specifications.md) · [Overlay definitions](../screen-overlays.md) · [Machine-readable manifest](manifest.json)

Captured 2026-09-23 (21 images), 2026-09-24 (27 images) and 2026-09-25 (2 iPad images) from source `ff7acf3996ccb66c912d2ed4710cf300197d6966`. The package was re-baselined to `bd6640f2` on 2026-09-25; `client/` is identical at both commits, so the captures stay valid and keep their original dates and commit in the manifest. They do not show the `bd6640f2` server additions (daily date gaps, `dailyStatus`, `historyStatus`). These are actual iOS Simulator screenshots of the current shared web source in a minimal WKWebView shell, **not release-app screenshots or current weather observations**. Only third-party web libraries were restored from ta.ios/www/lib; the app JS/templates/styles come from client/. All images were visually inspected.

Weather, air, nationwide values and warnings are synthetic. The synthetic Seoul payload uses the world-parser shape to exercise shared presentation; it does not test domestic KMA normalization. Separate [KMA/world parser examples](../client-data-contracts.md) cover normalization. Capture fixtures are in [examples](../examples/README.md). Location autocomplete returns no predictions; native plugins and external HTTP(S) are unavailable/blocked.

The large-phone shell uses safe-area constraints and hides the native status bar. The unsafe-area baseline deliberately omits those constraints and shows title occlusion. It is diagnostic evidence, not the desired layout. Compact screenshots and the Korean menu (`tw-menu.png`) were reused from the earlier same-day verified run with the basic fixture. `capture_file_mtime_utc` records preserved file metadata, not a claim about server publication time.

The 2026-09-23 set uses Korean and the light theme. The 2026-09-24 set adds overlays/dialogs (`O` IDs), loading states, favorites search/edit states, TodayAir favorites, national precipitation/wind modes, dark/old/photo themes, en-US locale/region, and Ionic Android platform mode. Each new manifest entry records a `trigger` (how the state was produced) and `notes`. Several overlays were opened by calling the controller function or broadcasting the event that source uses, not by reproducing the full native trigger; the trigger field says which. The guide contains bundled historical app artwork. The purchase page is the plugin-unavailable state; no purchase/restore or push save was performed. Small text/national map content may continue below the first viewport; screenshots are viewport captures, not full-page images.

Additional limits for the 2026-09-24 set:

- The photo theme uses a loopback synthetic feed ([example](../examples/weather-photos-feed.json)) with generated gradient images, not real weather photographs.
- en-US captures override `navigator.language`/`navigator.languages` in the staged harness; release builds derive region from `cordova-plugin-globalization`.
- No capture comes from an Android device or Android WebView, and none shows the TodayAir iOS purchase page with a loaded store product (subscription disclosure and privacy/terms block); see [product and platform differences](../screen-specifications.md#product-and-platform-differences).
- The two iPad captures (2026-09-25) use a dedicated iPad Pro 11-inch (M5) simulator in portrait; landscape is not captured because the harness `Info.plist` allows portrait only. See [device classes and orientation](../screen-specifications.md#device-classes-and-orientation).
- Android-mode captures load `index.html?ionicplatform=android` in the iOS WKWebView. They show Android templates/icons, not Android WebView rendering, hardware back, permission dialogs or plugins.
- The StartCtrl retry confirm, the permission-dependent TabCtrl retry variants, the push permission popup and equal-time alert, the Android exit confirm, share sheet, time picker, purchase progress and the native AdMob banner are not captured; captures therefore also omit the banner area reserved below the tab bar for free accounts. See [overlay definitions](../screen-overlays.md) for their text and behavior.
- In the light theme the header refresh spinner is rendered but invisible (white on white); the dark-theme capture shows the same element.

## Native Cordova PoC captures (2026-09-27)

The `native-*` files are a separate evidence set. They are screenshots of **native Cordova debug builds** of the issue #2605 PoC (branch `review-cordova-ios-android-deployment`, based on `b8a3c504`, uncommitted at capture time): `cordova-android` 15.1.0 on a Pixel Fold emulator (Android 15 / API 35, en-US; folded unless the title says unfolded) and `cordova-ios` 8.1.1 on an iPhone 17 Pro Simulator (iOS 26.5, ko-KR). The app called the **production API**, so the weather, bulletin and national values are whatever production returned at capture time. They are not synthetic, not current, and not release builds.

A test-only [native harness](../../../scripts/verification/rewrite/native/README.md) was injected into the built `www` (never `client/www`). It tapped through the screens, tapping the way `ionic.tap` delivers taps; the manifest `trigger` names the scenario step. Location permission was pre-granted and the device location set to Seoul City Hall. The status bar is real: iOS keeps it outside the web view, and Android draws it at `#111111`. Differences from the WKWebView set: live data instead of fixtures; real plugins (share, store and mail hand-offs, keyboard, location, status bar); no AdMob, Firebase or purchase plugin; region from `navigator.languages`. The captures were visually inspected, and the harness recorded no unexplained JS error in the runs they come from. See [Native Cordova PoC build](../screen-specifications.md#native-cordova-poc-build-2026-09-27) for what each one shows.

<!-- capture-table:start -->
| ID | View | Device | Variant | Data |
| --- | --- | --- | --- | --- |
| S01 | [Native Android — initial selection](native-android-start.png) | Pixel Fold emulator (folded) / Android 15 (API 35) | todayWeather · en-US · light · native build | live production API (2026-09-27) |
| S01 | [Native iOS — initial selection](native-ios-start.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light · native build | live production API (2026-09-27) |
| S01 | [Initial selection — compact](tw-start-compact.png) | iPhone SE (3rd generation) / iOS 18.6 | todayWeather · ko-KR · light | built-in city list |
| S01 | [Initial location selection — en-US](tw-start-en-us.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · en-US · light | bundled city list |
| S01 | [Initial location selection](tw-start.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | built-in city list |
| S02 | [Native iOS — searching](native-ios-search.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light · native build | live production API (2026-09-27) |
| S02 | [TodayAir saved locations](ta-favorites.png) | iPhone 17 Pro / iOS 26.5 | todayAir · ko-KR · light | screenshot-weather.json |
| S02 | [Saved locations — editing](tw-favorites-editing.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| S02 | [Saved locations — searching](tw-favorites-search.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| S02 | [Saved locations](tw-favorites.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| S03 | [Native Android — hourly weather](native-android-hourly.png) | Pixel Fold emulator (folded) / Android 15 (API 35) | todayWeather · en-US · light · native build | live production API (2026-09-27) |
| S03 | [Native Android — hourly, unfolded](native-android-unfolded-hourly.png) | Pixel Fold emulator (unfolded) / Android 15 (API 35) | todayWeather · en-US · light · native build | live production API (2026-09-27) |
| S03 | [Native iOS — hourly weather](native-ios-hourly.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light · native build | live production API (2026-09-27) |
| S03 | [Native iOS — hourly, dark theme](native-ios-theme-dark.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · dark · native build | live production API (2026-09-27) |
| S03 | [Native iOS — hourly, photo theme](native-ios-theme-photo.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · photo · native build | live production API (2026-09-27) |
| S03 | [Hourly weather — Ionic Android mode](tw-android-mode-hourly.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light · Ionic android mode | screenshot-weather.json |
| S03 | [Hourly weather — compact](tw-hourly-compact.png) | iPhone SE (3rd generation) / iOS 18.6 | todayWeather · ko-KR · light | screenshot-weather-basic.json |
| S03 | [Hourly weather](tw-hourly.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| S03 | [Hourly weather — iPad portrait](tw-ipad-hourly.png) | iPad Pro 11-inch (M5) / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| S03 | [Hourly weather — dark theme](tw-theme-dark-hourly.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · dark | screenshot-weather.json |
| S03 | [Hourly weather — old theme](tw-theme-old-hourly.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · old | screenshot-weather.json |
| S03 | [Hourly weather — photo theme](tw-theme-photo-hourly.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · photo | screenshot-weather.json + weather-photos-feed.json |
| S04 | [Native Android — daily weather](native-android-daily.png) | Pixel Fold emulator (folded) / Android 15 (API 35) | todayWeather · en-US · light · native build | live production API (2026-09-27) |
| S04 | [Native iOS — daily weather](native-ios-daily.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light · native build | live production API (2026-09-27) |
| S04 | [Daily weather — compact](tw-daily-compact.png) | iPhone SE (3rd generation) / iOS 18.6 | todayWeather · ko-KR · light | screenshot-weather-basic.json |
| S04 | [Daily weather](tw-daily.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| S04 | [Daily weather — iPad portrait](tw-ipad-daily.png) | iPad Pro 11-inch (M5) / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| S05 | [Native Android — air tab without air data](native-android-air-empty.png) | Pixel Fold emulator (folded) / Android 15 (API 35) | todayWeather · en-US · light · native build | live production API (2026-09-27) |
| S05 | [Native iOS — air tab without air data](native-ios-air-empty.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light · native build | live production API (2026-09-27) |
| S05 | [Air quality](tw-air.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| S06 | [Native Android — menu (en-US)](native-android-menu.png) | Pixel Fold emulator (folded) / Android 15 (API 35) | todayWeather · en-US · light · native build | live production API (2026-09-27) |
| S06 | [Native iOS — menu](native-ios-menu.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light · native build | live production API (2026-09-27) |
| S06 | [Menu — Ionic Android mode](tw-android-mode-menu.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light · Ionic android mode | local settings |
| S06 | [Menu — en-US region](tw-menu-en-us.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · en-US · light | local settings |
| S06 | [Menu and settings](tw-menu.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | local settings |
| S07 | [Units — en-US defaults](tw-units-en-us.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · en-US · light | local unit defaults |
| S07 | [Units](tw-units.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | local unit defaults |
| S08 | [Temperature choice](tw-temperature-unit.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | radioList from Units |
| S08 | [Theme choice](tw-theme.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | radioList from SettingCtrl |
| S09 | [Notification settings](tw-push-settings.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | local default form; no submission |
| S10 | [National weather — precipitation](tw-nation-rain.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-nation.json |
| S10 | [National weather — wind](tw-nation-wind.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-nation.json |
| S10 | [National weather](tw-nation.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-nation.json |
| S11 | [Native iOS — national air](native-ios-nation-air.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light · native build | live production API (2026-09-27) |
| S11 | [National air](tw-nation-air.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-nation.json |
| S12 | [Native iOS — bulletins (stale 2021 data)](native-ios-bulletin.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light · native build | live production API (2026-09-27) |
| S12 | [Weather bulletin](tw-warning.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-special.json |
| S13 | [Purchase plugin unavailable](tw-purchase-unavailable.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | no store plugin or product |
| S14 | [Legacy guide](tw-guide.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | bundled historical guide artwork |
| S15 | [TodayAir combined weather](ta-weather.png) | iPhone 17 Pro / iOS 26.5 | todayAir · ko-KR · light | screenshot-weather.json |
| S16 | [TodayAir air](ta-air.png) | iPhone 17 Pro / iOS 26.5 | todayAir · ko-KR · light | screenshot-weather.json |
| S16 | [TodayAir air — dark theme](ta-theme-dark-air.png) | iPhone 17 Pro / iOS 26.5 | todayAir · ko-KR · dark | screenshot-weather.json |
| O01 | [Start access explanation](tw-overlay-access-explanation.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | bundled city list |
| O02 | [Zero-city start choice](tw-overlay-start-popup.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| O03 | [Retry confirm — weather failure variant](tw-overlay-retry-weather.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| O05 | [Native Android — update information](native-android-update-info.png) | Pixel Fold emulator (folded) / Android 15 (API 35) | todayWeather · en-US · light · native build | live production API (2026-09-27) |
| O05 | [Native iOS — update information](native-ios-update-info.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light · native build | live production API (2026-09-27) |
| O05 | [Update information](tw-overlay-update-info.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| O06 | [Weather-alert introduction](tw-overlay-alert-intro.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| O07 | [Foreground notification](tw-overlay-foreground-notification.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| O08 | [Air-forecast source information](tw-overlay-air-source-info.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| O09 | [Native iOS — world weather failure](native-ios-world-weather-error.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light · native build | live production API (2026-09-27) |
| O09 | [Shared error alert](tw-overlay-start-error-alert.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | bundled city list |
| O10 | [About attribution](tw-overlay-about.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | bundled city list |
| O12 | [Notification settings — save changes](tw-overlay-push-save-confirm.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | local default form; no submission |
| O15 | [Native Android — exit confirm](native-android-exit-confirm.png) | Pixel Fold emulator (folded) / Android 15 (API 35) | todayWeather · en-US · light · native build | live production API (2026-09-27) |
| O16 | [Native Android — share chooser](native-android-share.png) | Pixel Fold emulator (folded) / Android 15 (API 35) | todayWeather · en-US · light · native build | live production API (2026-09-27) |
| O16 | [Native iOS — share sheet](native-ios-share.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light · native build | live production API (2026-09-27) |
| O17 | [Header refresh spinner — dark theme](tw-loading-header-spinner-dark.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · dark | screenshot-weather.json |
| O17 | [Header refresh spinner — light theme](tw-loading-header-spinner-light.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| O17 | [Loading overlay (Start/Search flows)](tw-loading-overlay-search.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather.json |
| O19 | [Native Android — store hand-off](native-android-store.png) | Pixel Fold emulator (folded) / Android 15 (API 35) | todayWeather · en-US · light · native build | live production API (2026-09-27) |
| O19 | [Native iOS Simulator — store hand-off](native-ios-store.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light · native build | live production API (2026-09-27) |
| baseline | [Full-screen safe-area risk](baseline-unsafe-area.png) | iPhone 17 Pro / iOS 26.5 | todayWeather · ko-KR · light | screenshot-weather-basic.json |
<!-- capture-table:end -->

See [verification](../../evidence/rewrite/README.md) and [reproduction tooling](../../../scripts/verification/rewrite/capture/README.md) for checks, known gaps and commands. The manifest includes source revision, device/OS, pixel dimensions, SHA-256, state, fixture and capture limitations for each PNG.
