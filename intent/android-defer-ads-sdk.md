# Intent: defer Android Ads SDK start until after the first frame and idle

- Task: `android-defer-ads-sdk` (issue #3234, sub-issue of #2877; related: #3211, #3212, #3213). Mode: implementation. Change kind: behavior (performance; startup scheduling of `MobileAds.initialize`, no consent, policy, or visible layout change). Endpoint: **pre-merge** (no merge, release, store, or Remote Config action).
- Source and authority: 2026-11-27 Android performance review (PERF-4, Galaxy S21+ Android 15 R8 release of master `d5d4cd05e`).

## Problem

On a cold start with stored consent, `AdsConsent.start` starts the Google Mobile Ads SDK synchronously with the tabs opening. Although `GoogleAdsPlatform.startSdk` invokes `MobileAds.initialize` on a background thread, the SDK immediately posts creation of its internal JavaScript-engine WebView (`WebViewChromium.init`: `startChromiumLockedSync` + `AwContents.constructor`) onto the main thread 85–100 ms after TTID (218–291 ms), blocking the main thread for 103–124 ms right during the first user interactions.

## Outcome

The Ads SDK start (`platform.startSdk`) is deferred until after the first content frame has drawn, a bounded post-first-frame delay has cleared early interactions (starting at 1,000 ms, without waiting for user input), and the main thread has gone idle (with a short upper bound so a busy main thread cannot postpone ads indefinitely). The actual start dispatch is wrapped in the `ads.startSdk` trace section. This moves the ~0.1 s main-thread cost out of the initial interaction window; it does not eliminate total main-thread work.

## Scope and exclusions

In scope:
- Injectable deferred start scheduling on `AdsConsent` and its production main-thread first-frame/delay/idle scheduler (`android/app/.../ads/AdsConsent.kt`, `MainActivity.kt`).
- `ads.startSdk` trace section around the SDK start dispatch.
- Activity-recreation cancellation/rebinding so a pending start never leaks a destroyed activity or starts the SDK twice.
- JVM unit tests covering deferred start, recreation, and consent gates (`AdsConsentTest`).
- Documentation updates in `android/README.md` and `docs/operations/monetization.md`.

Out of scope:
- Deferring `consent.start`, UMP consent update, or consent/privacy-options forms (must stay where they are so first-launch consent is not delayed).
- Changing consent rules, debug fallback rules, `TwAds.sessionStart` / `OpenedModel.adStart` banner delay clocks, `NativeInventory` decision rules, `ForecastInterstitial` chance/cap rules, or analytics startup order (AN-15).
- Adding a reserved banner strip (forbidden by #3211).
- iOS, server, Cordova, baseline profile regeneration, releasing, or Remote Config changes.

## Acceptance criteria

- **AC1** On the Galaxy S21+, cold-start Perfetto traces show `ads.startSdk` starting after the first content frame and after a main-thread idle point, with `WebViewChromium.init` on the main thread only after `ads.startSdk`. One trace includes a scripted tap 200 ms after TTID whose input event is not delayed by `WebViewChromium.init`. Traces are summarized in the PR, including one with Firebase configured.
- **AC2** TTID over 6 cold starts is not worse than master `d5d4cd05e`.
- **AC3** JVM tests verify: no SDK start before the scheduler fires; exactly one start across activity recreation; no start without consent. `./gradlew assembleDebug test` passes.
- **AC4** `AdsDeviceTest` (including the banner switch test) and `android/tools/emulator/run-ads-check.sh` pass on an emulator.
- **AC5** `android/README.md` and `docs/operations/monetization.md` describe when the Ads SDK starts.
