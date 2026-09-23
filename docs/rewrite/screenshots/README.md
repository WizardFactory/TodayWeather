# Screenshot evidence

[Open the visual gallery](index.html) · [Screen definitions](../screen-specifications.md) · [Machine-readable manifest](manifest.json)

Captured 2026-09-23 from source `ff7acf3996ccb66c912d2ed4710cf300197d6966`. These are actual iOS Simulator screenshots of the current shared web source in a minimal WKWebView shell, **not release-app screenshots or current weather observations**. Only third-party web libraries were restored from ta.ios/www/lib; the app JS/templates/styles come from client/. All images were visually inspected.

Weather, air, nationwide values and warnings are synthetic. The synthetic Seoul payload uses the world-parser shape to exercise shared presentation; it does not test domestic KMA normalization. Separate [KMA/world parser examples](../client-data-contracts.md) cover normalization. Capture fixtures are in [examples](../examples/README.md). Location autocomplete returns no predictions; native plugins and external HTTP(S) are unavailable/blocked.

The large-phone shell uses safe-area constraints and hides the native status bar. The unsafe-area baseline deliberately omits those constraints and shows title occlusion. It is diagnostic evidence, not the desired layout. Compact screenshots and the menu were reused from the earlier same-day verified run with the basic fixture. `capture_file_mtime_utc` records preserved file metadata, not a claim about server publication time.

All captures use Korean and the light theme; the theme selector shows available choices but does not verify all themes. The guide contains bundled historical app artwork. The purchase page is the plugin-unavailable state; no purchase/restore or push save was performed. Small text/national map content may continue below the first viewport; screenshots are viewport captures, not full-page images.

| ID | View | Device | Data |
| --- | --- | --- | --- |
| baseline | [Full-screen safe-area risk](baseline-unsafe-area.png) | iPhone 17 Pro / iOS 26.5 | screenshot-weather-basic.json |
| S16 | [TodayAir air](ta-air.png) | iPhone 17 Pro / iOS 26.5 | screenshot-weather.json |
| S15 | [TodayAir combined weather](ta-weather.png) | iPhone 17 Pro / iOS 26.5 | screenshot-weather.json |
| S05 | [Air quality](tw-air.png) | iPhone 17 Pro / iOS 26.5 | screenshot-weather.json |
| S04 | [Daily weather — compact](tw-daily-compact.png) | iPhone SE (3rd generation) / iOS 18.6 | screenshot-weather-basic.json |
| S04 | [Daily weather](tw-daily.png) | iPhone 17 Pro / iOS 26.5 | screenshot-weather.json |
| S02 | [Saved locations](tw-favorites.png) | iPhone 17 Pro / iOS 26.5 | screenshot-weather.json |
| S14 | [Legacy guide](tw-guide.png) | iPhone 17 Pro / iOS 26.5 | bundled historical guide artwork |
| S03 | [Hourly weather — compact](tw-hourly-compact.png) | iPhone SE (3rd generation) / iOS 18.6 | screenshot-weather-basic.json |
| S03 | [Hourly weather](tw-hourly.png) | iPhone 17 Pro / iOS 26.5 | screenshot-weather.json |
| S06 | [Menu and settings](tw-menu.png) | iPhone 17 Pro / iOS 26.5 | local settings |
| S11 | [National air](tw-nation-air.png) | iPhone 17 Pro / iOS 26.5 | screenshot-nation.json |
| S10 | [National weather](tw-nation.png) | iPhone 17 Pro / iOS 26.5 | screenshot-nation.json |
| S13 | [Purchase plugin unavailable](tw-purchase-unavailable.png) | iPhone 17 Pro / iOS 26.5 | no store plugin or product |
| S09 | [Notification settings](tw-push-settings.png) | iPhone 17 Pro / iOS 26.5 | local default form; no submission |
| S01 | [Initial selection — compact](tw-start-compact.png) | iPhone SE (3rd generation) / iOS 18.6 | built-in city list |
| S01 | [Initial location selection](tw-start.png) | iPhone 17 Pro / iOS 26.5 | built-in city list |
| S08 | [Temperature choice](tw-temperature-unit.png) | iPhone 17 Pro / iOS 26.5 | radioList from Units |
| S08 | [Theme choice](tw-theme.png) | iPhone 17 Pro / iOS 26.5 | radioList from SettingCtrl |
| S07 | [Units](tw-units.png) | iPhone 17 Pro / iOS 26.5 | local unit defaults |
| S12 | [Weather bulletin](tw-warning.png) | iPhone 17 Pro / iOS 26.5 | screenshot-special.json |

See [verification](../../../reports/rewrite-verification/README.md) and [reproduction tooling](../../../reports/rewrite-verification/capture/README.md) for checks, known gaps and commands. The manifest includes source revision, device/OS, pixel dimensions, SHA-256, state, fixture and capture limitations for each PNG.
