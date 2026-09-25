# Isolated iOS screenshot harness

This is verification tooling, not the app's release build. It serves copied current web source over loopback to a minimal native WKWebView. Native safe-area constraints are applied and the status bar is hidden. External HTTP(S) is blocked by the WebView content rule.

The test-only `cordova.js` emits `deviceready`; it provides no plugin bridge. `render-harness.js` captures console/errors, supplies a Korean locale and empty Google Places predictions, and exposes a loopback diagnostic queue. Weather/nation/warning fixtures are synthetic. Never publish this diagnostic server.

## Reproduction

Prerequisites used: macOS arm64, Xcode 26.5, installed iOS Simulator runtime, Node 24.21.0, Python 3.13, Dart Sass 1.93.2. No legacy Gulp/Cordova reset is required. From the repository root:

```sh
python3 reports/rewrite-verification/capture/prepare.py /private/tmp/tw-screen-review
cd /private/tmp/tw-screen-review
npm install --ignore-scripts --no-audit --no-fund
./node_modules/.bin/sass --load-path=. --quiet-deps scss/ionic.app.scss www/css/ionic.app.css
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcrun swiftc -sdk "$DEVELOPER_DIR/Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator.sdk" -target arm64-apple-ios17.0-simulator -module-cache-path /private/tmp/tw-screen-module-cache -parse-as-library RenderCheck.swift -o RenderCheck.app/RenderCheck
codesign --force --sign - RenderCheck.app
python3 server.py
```

Keep the server terminal running. In another terminal, create/select a **dedicated test simulator**, boot it, install `RenderCheck.app`, and launch `local.todayweather.rendercheck` using `xcrun simctl`. Do not erase or reset a personal simulator. Tested device/runtime pairs were iPhone 17 Pro/iOS 26.5 and iPhone SE 3/iOS 18.6.

On first launch, dismiss the app's access explanation and select the built-in Seoul chip. The exact coordinate URL is served by the fixture. Other city/provider calls are not supplied. `python3 evaluate.py --file inspect.js` reports state, viewport, resources and SVG checks. Run only one harness app at a time because the command queue is shared.

From the repository root, capture a route after city initialization:

```sh
python3 reports/rewrite-verification/capture/capture-screen.py /private/tmp/tw-screen-review <TEST_DEVICE_UUID> tw-hourly --state tab.forecast
```

The command overwrites that named screenshot under `docs/rewrite/screenshots/` and its diagnostic under `reports/rewrite-verification/`. Inspect the image; no-error diagnostics alone do not prove correct composition. Set `radioList` through the existing controller before entering `setting-radio`; a URL alone does not initialize its choices.

For TodayAir, prepare a separate fresh directory with `--product todayAir`, serve it on the same loopback port after stopping the previous server, then relaunch the harness and initialize a city. Reusing app storage across product variants may select an incompatible startup page. If switching the staged config during an existing run, perform an actual document reload: changing only the URL fragment does not re-register product-specific routes.

Stop the loopback server and shut down only the dedicated test device when finished. Do not call application/server collection routes for screenshot setup.

## 2026-09-24 overlay, state and variant recipes

`prepare.py` options: `--locale en-US` sets `navigator.language` and `navigator.languages` (region derivation reads the latter; the default stays `ko-KR`). `--photo-feed` serves [the synthetic feed](../../../docs/rewrite/examples/weather-photos-feed.json) with two generated gradient PNGs and points the staged `weatherPhotosUrl` at it. The WebView caches `render-harness.js` and `client.config.js`; when changing a staged file during a run, add a query string to its `<script>` tag or stage a fresh directory.

`capture-screen.py --before '<js>'` runs code inside a `$rootScope.$apply` with the injector bound to `i`. Each 2026-09-24 manifest entry records the exact trigger. Patterns used:

| Target | Recipe |
| --- | --- |
| Start access explanation (O01) | Capture `start` before dismissing it; it appears on every StartCtrl entry |
| TabCtrl overlays (O02, O03, O08) | Find the scope that owns `showRetryConfirm` and call `startPopup()`, `showRetryConfirm(title, msg, 'weather')` or `popUpAirForecastInfo('airkorea')`. Permission retry variants need `cordova.plugins.diagnostic` and were not rendered |
| Event overlays (O05, O06, O07) | `$broadcast('showUpdateInfoEvent')`, `'showAlertInfoEvent'`, or `'notificationEvent', {title, message}` |
| About and shared alert (O09, O10) | SettingCtrl `clickMenu('openInfo')`; `$rootScope.showAlert(...)` |
| Push save prompt (O12) | Open `setting-push` with `{fav:1}` for a city without stored settings, then call the PushCtrl scope `onClose()` |
| Loading (O17) | `$ionicLoading.show()` on `tab.search`; header spinner by setting `showLoadingIndicator=true` on the active TabCtrl scope |
| Themes | Persist `settingsInfo.theme`, set every `cities[].photo` to `null`, reload the document, then close the recurring update popup. Changing paths at runtime does not refresh one-time `::` bindings |
| Android templates | Reload `index.html?ionicplatform=android`; a later `ionic.Platform.setPlatform` call is too late |
| TodayAir | Stage `--product todayAir`, or change the staged package, clear storage and reload the document |
| iPad (2026-09-25) | Create a separate dedicated simulator (for example `xcrun simctl create "TW Render iPad" <iPad Pro 11-inch device type> <iOS 26.5 runtime>`), shut down the phone test device so only one harness app polls the command queue, install and launch `RenderCheck.app`, clear storage, select Seoul, then capture with `--state tab.forecast` / `tab.dailyforecast`. The harness allows portrait only |

Harness probes are plain scripts run inside the WebView with `python3 evaluate.py --file <script>`. [`start-popup-choice.js`](../probes/start-popup-choice.js) records which route each start-popup option takes; the [photo selection result](../probes/weather-photo-selection.json) records its evaluated expression. Both results are in [probes](../probes/). The other probes in that directory are offline Node scripts over extracted source (no harness); each script's header gives its exact `node` command.

## Evidence boundaries

The saved captures test rendering, router-driven state selection and programmatic scrolling. They do not test physical tap gestures, native permissions, live API/CORS, Firebase, purchase receipts, delivery, widgets, accessibility sizes, landscape or release binaries. Missing native-plugin console messages are expected. Captures of map/bulletin data are explicitly synthetic. Source file parity and fixture provenance are recorded in the [verification report](../README.md).
