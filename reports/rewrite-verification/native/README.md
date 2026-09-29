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

## World mode (one overseas city)

`build-harness.sh <android|ios> world` runs a fresh start and then adds Tokyo through the search tab ("Tokyo" on Android, "도쿄" on the ko-KR simulator). It checks that the weather request succeeds, the hourly and daily charts render, the expanded details show the Visual Crossing attribution, and the city is added to the favorites.

## Upgrade mode (store update simulation)

`build-harness.sh <android|ios> upgrade` checks that an update from the store version keeps the user's data although the web origin changes. Launch 1 runs S1 and adds a push record, leaves a marker in the native App Group preferences and prints `TWHOST wipe-web-storage`. After stopping the app, the driver deletes only the web storage (Android `app_webview/…/Local Storage` via `run-as`; iOS `Library/WebKit`) and keeps the native preferences. Launch 2 must open a tab screen, not S01, with the same number of cities and push records restored by `TwStorage.init`.

`run.mjs` exits with 1 when a scenario did not finish or any unclassified error, unclassified failed check or native crash was recorded.

## Evidence boundaries

Live data changes over time, so a capture shows the production response at capture time. The harness cannot tap native UI: permissions are pre-granted, the iOS share sheet is left open at the end, and the iOS Simulator has neither App Store nor Mail. The iOS notification permission alert is native too, so iOS runs check only that the app requests it; FCM registration and the push-list `POST` are checked on Android, where `POST_NOTIFICATIONS` is pre-granted. Real-device behavior, release signing, push delivery, real ad units and purchase are outside these runs.

## Backend integration before deployment (2026-09-29)

Integrated master `d4858b59` (PRs #2629, #2630, #2631). No upstream mobile source changes. AK reports these backend changes are not yet deployed; the previous production S1 observation remains historical, not a test of the new code.

Local checks use synthetic providers and credentials, isolated models, and loopback peers. No production writes or notifications:

```sh
TZ=UTC NODE_PATH=<test-dependencies> node --test server/test/offline/air-fallback.test.js server/test/offline/air-chain.test.js server/test/offline/world-air.test.js server/test/offline/push-s3.test.js
TZ=UTC NODE_PATH=<test-dependencies> node server/test/offline/air-chain-smoke.js
TZ=UTC NODE_PATH=<test-dependencies> node server/test/offline/world-air-smoke.js
TZ=UTC NODE_PATH=<locked-server-dependencies> node server/test/offline/push-s3-smoke.js --client
```

Run these from the repository root. The air suites passed 74 tests, the push coordinator suite passed 27 cases, and domestic/world HTTP smokes passed 16/17 scenarios respectively on Node 24.21.0. These are local compatibility checks, not deployed Node 10 or native-app evidence. The actual Cordova branch `service.push.js` also passed registration, reopen, location change, token rotation, deletion, alarm and disable against real local routers/IPC/S3 peers with the locked server dependencies installed using npm 8. No native push receipt was tested.

After deployment:

- Verify Seoul/Busan/Incheon/Jeju air observations and Tokyo/London current air through the public v000903 endpoint, including requested air units, source, observation time, and available pollutants.
- Run native `full`, `world`, and `layout` scenarios on Android and iOS. Inspect S05 with actual air values and chart scrolling; current-only air does not imply a historical or forecast series.
- Explicitly inspect air failures. The historical S1 exceptions in `triage.mjs` were removed during the 2026-09-29 post-deployment layout audit after live Seoul/Tokyo air was observed; missing-air exceptions and `air-codes count=0` now fail. **Zero unclassified failures alone does not prove air recovery:** require live-air/value checks and inspect the captures.
- Record the pending-air path separately. The app currently ignores `airStatus` and does not schedule the suggested retry; supplier attribution is not rendered either. Track presentation work before treating provider display as release-ready.
- Follow [the S3 push runbook](../../../docs/operations/push-s3.md) and #2626 for activation, actual registrations, token rotation, alarm/alert delivery, disabled/deleted registrations and monitoring. The native harness intercepts push writes, so it cannot prove production registration or receipt.

## Live air layout mode

`build-harness.sh <android|ios> layout-live` extends `layout` with mandatory Seoul and Tokyo air-data/value checks, lower-card captures, pollutant/station horizontal-strip endpoints, available air-chart endpoints, and Tokyo hourly/daily chart checks. Current-only data is recorded as no air time series rather than a chart failure. Run `npm run www:config` and `npm run www:css` in `client/` first to use Google test ads and current styles.

The iOS notification permission request is skipped only in this layout mode so a native alert cannot cover captures. This is layout evidence, not permission or delivery evidence. Push writes remain intercepted. Use full/device verification for notifications.

The 2026-09-29 iOS run required an isolated artifact because the normal build aborted in `GULMutableDictionary` with a nil key. To reproduce that **layout-only** setup after building, copy the simulator app to a new directory, set the copied `Info.plist` key `FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED` to boolean `true`, and ad-hoc sign the copy (`codesign --force --sign - --timestamp=none <copy.app>`). Pass the copied app to `run.mjs`. Do not apply this switch to the release configuration or treat the resulting pass as Analytics/runtime verification.

For a supplemental stationary air capture, use mode `capture-air`: it opens Seoul air and holds each capture state for eight seconds. This was used when busy simulators saved a later screen under an earlier screenshot label; retain the original run and label supplemental captures separately. Automated DOM checks alone do not detect a native ANR dialog or a late screenshot.

`capture-charts` similarly holds the Seoul hourly/daily chart capture positions for eight seconds. The dated [post-deployment report](layout-2026-09-29.md) includes the size matrix, original runtime failures, repeats, and capture provenance.
