# Native Cordova harness (issue #2605 PoC)

Verification tooling for the Cordova 13 PoC build of TodayWeather, not part of the app. It drives native **debug** builds on an Android emulator and an iOS Simulator against the production API and records what each screen does. Captures from the 2026-09-27 runs are the `native-*` entries in the [screenshot manifest](../../../docs/rewrite/screenshots/manifest.json).

| File | Role |
| --- | --- |
| [`tw-harness.js`](tw-harness.js) | Injected as the first `<head>` script of a built `www` (never `client/www`). Hooks `window` errors (JS and resources), `unhandledrejection`, `console.error`, XHR failures and `Util.ga.trackException`, then runs one scenario per app launch (S1 fresh start … S9 external hand-offs). S1 also checks the platform integrations: AdMob SDK start and banner load (Google test units), the FCM token `PUT` on Android, and the Android text zoom kept at 100 by the accessibility plugin. Push writes (`PUT /push`, `POST /push-list`, `DELETE`) are answered locally with `200 {}` and never reach production. It taps the way `ionic.tap` does: a `click` with `isIonicTap = true` at the element centre, redirected to the control of an enclosing `<label>`, and it refuses to tap an element covered by another one (for example a popup backdrop) |
| [`run.mjs`](run.mjs) | Host driver. Installs fresh, grants location, sets the Seoul location, launches once per scenario, saves a screenshot for every `TWSHOT` line and performs `TWHOST` actions (Android back, background/resume) and, for hand-offs to other apps, takes the screenshot and brings the app back itself because iOS suspends the web view's timers |
| [`triage.mjs`](triage.mjs) | Summarizes a run and classifies each error and failed check by its known cause; anything else is `UNCLASSIFIED` |
| [`build-harness.sh`](build-harness.sh) | Builds the injected artifacts without touching `client/www`: Android `prepare` → inject → `compile` → `prepare` again; iOS `build` → copy the `.app` → inject → ad-hoc re-sign |
| [`cdp-probe.mjs`](cdp-probe.mjs) | Sends a request from inside the running Android debug WebView over the DevTools protocol and prints the raw request/response headers and any CORS error (used for the world-weather status 0) |
| [`font-scale-check.sh`](font-scale-check.sh) | Captures S03 at Android system font scale 1.0 and 1.3 and restores the original scale |
| [`add-native-captures.py`](add-native-captures.py) | Copies selected run screenshots into `docs/rewrite/screenshots/` and writes their manifest entries (hash, size, device, trigger, notes) |

## Reproduction

Prerequisites used: macOS arm64, Xcode 26.5, Android SDK platform 36 and build-tools 36.0.0, an API 35 AVD, Node 24.21.0, the client prepared as in [client/package.json](../../../client/package.json) (`npm run www`).

```sh
reports/rewrite-verification/native/build-harness.sh android    # -> /tmp/tw-harness/app-debug.apk
reports/rewrite-verification/native/build-harness.sh ios        # -> /tmp/tw-harness/TodayWeather.app
node reports/rewrite-verification/native/run.mjs android /tmp/tw-harness/app-debug.apk /tmp/tw-verify/android --fold
node reports/rewrite-verification/native/run.mjs ios /tmp/tw-harness/TodayWeather.app /tmp/tw-verify/ios <SIMULATOR_UDID>
node reports/rewrite-verification/native/triage.mjs /tmp/tw-verify/android /tmp/tw-verify/ios
```

The driver uninstalls and reinstalls the app on the selected device, so use a dedicated test emulator/simulator. It calls only the public app API through the app, never `/gather` routes. Rebuild with `cordova build` afterwards if a harness-free build is needed on the device.

## Layout mode (screen sizes)

`build-harness.sh <android|ios> layout` injects `window.TW_HARNESS_MODE = 'layout'`. The harness then runs two launches:

- It walks O01 and S01–S14, and audits each screen:
  - horizontal page overflow;
  - the visible part of an element falling outside the viewport (Ionic's parked elements and clipped slides are ignored);
  - text cut with an ellipsis.
- It checks both charts:
  - `overflow-x`;
  - the initial scroll position and whether the current column is visible;
  - both ends reachable;
  - no vertical clipping;
  - on Android, a real touch swipe (`cdp-swipe`, DevTools `Input.synthesizeScrollGesture`) that must scroll the chart without changing the city.

`run.mjs … --size=WxH` emulates a CSS screen on Android with `wm size (3W)x(3H)` and `wm density 480`, and resets both at the end. On iOS, use a simulator of the target model.

```sh
reports/rewrite-verification/native/build-harness.sh android layout
node reports/rewrite-verification/native/run.mjs android /tmp/tw-harness/app-debug.apk /tmp/tw-layout/a-320x694 --fold --size=320x694
```

The audit does not catch a control clipped by an `overflow: hidden` parent, for example the S09 weekday row at 320 px. Review the screenshots as well.

## Evidence boundaries

Live data changes over time, so a capture shows the production response at capture time. The harness cannot tap native UI: permissions are pre-granted, the iOS share sheet is left open at the end, and the iOS Simulator has neither App Store nor Mail. The iOS notification permission alert is native too, so iOS runs check only that the app requests it; FCM registration and the push-list `POST` are checked on Android, where `POST_NOTIFICATIONS` is pre-granted. Real-device behavior, release signing, push delivery, real ad units and purchase are outside these runs.
