# Spec: iOS-native TodayWeather app (#2948)

Consumes the [intent](../intent/ios-native.md). Requirements authority: #2948 and its sub-issues #2950–#2968 (IN-01..IN-19). This spec records the cross-cutting contracts and how parity is judged; it does not restate each sub-issue. Where it says "as on Android", the [Android spec](android-native.md) and `android/README.md` hold the detail.

## Behavior to retain

The native app reproduces the Cordova 1.1.1 app (`client/`, iOS build) for users:

- **Parity oracle.** The Cordova iOS build: the source at the PR's base revision, including its `ionic.Platform.isIOS()` branches, and captures of that build on iOS Simulators. The [Cordova user manual](../docs/user/cordova-app/README.md) (Android captures) and the [rewrite specification](../docs/rewrite/README.md) name the screens and states. The Android native app is a reference for behavior already decided, not the oracle. Where sources disagree, the current Cordova iOS behavior wins.
- **Server.** The legacy server as deployed, without changes. Every request uses path version `v000903`, with the paths, headers and documented exceptions listed in the Android spec. Push requests carry `type: "ios"`. `Accept-Language` is what the WKWebView sends.
- **Identity and data.** Bundle ID `net.wizardfactory.todayweather`, deployment target iOS 17.0, the same Apple team, App Store record and App Group `group.net.wizardfactory.todayweather`. `Device-Id` is the `CDVUUID` value in standard `UserDefaults`. The migration sources are the WKWebView `localStorage` of origin `app://localhost`, then the App Group suite. The Firebase iOS app and APNs configuration stay the same.
- **Privacy.** Analytics is off until the user opts in; a Cordova opt-in does not carry over. Ads follow the Cordova iOS build of #2945, which replaced the no-tracking position of #2660: the app makes no App Tracking Transparency request of its own, UMP shows the IDFA explainer and the system prompt, a request is personalized only when tracking is authorized and GDPR does not apply or TCF purposes 1, 3 and 4 are consented, and every other request sends `npa=1` with the publisher first-party ID off; the localized `NSUserTrackingUsageDescription` is copied from `client/resources/ios/tracking/` (IN-15). Location uses when-in-use authorization only.
- **Anomalies.** Documented Cordova anomalies (docs/rewrite A01–A49) are kept, except A01: a response applies to the place that requested it.

## Cross-cutting requirements

| ID | Requirement | Verification |
| --- | --- | --- |
| R1 | The iOS build never reads `client/`, `android/`, `tw.ios/`, `ta.ios/` or `applewatch/`. Copied files carry provenance (source path, commit, SHA-256). | CI job without those directories; re-running each import tool produces no diff. |
| R2 | Models, domain logic and request building are Swift package targets without UIKit or SwiftUI types. | Package target dependencies; `swift test` on macOS. |
| R3 | No private inputs in Git, docs or logs; the build and unit tests run without them. | CI builds without private inputs; artifact checker; review. |
| R4 | Tests reach neither the production push server nor the production Firebase project. A simulator shares the Mac's network, so isolation comes from the test builds (local recorder URL, non-production Firebase configuration), not from taking the device offline. | Request recording in tests; the upgrade test fails on a request to a production host. |
| R5 | No test, mock or dry-run modes in the app; doubles are injected by test code. | Review. |
| R6 | Parity is shown per screen against Cordova iOS captures within recorded tolerances. | Screenshot tests (IN-05 onward) and the IN-18 checklist. |
| R7 | An update from the Cordova build keeps places, settings, alarms, push registration and `Device-Id`, and analytics stays off without opt-in. This holds for a state in `localStorage` and for a state that exists only in the App Group suite (an update straight from 1.0.10). | Simulator upgrade test (IN-03, IN-04), extended by later issues. |
| R8 | Every request the native client makes uses a path the legacy server serves under `v000903`, or a documented exception. | The IN-18 request-path test. |
| R9 | The core equals the Cordova code on the shared golden corpus. Where JavaScriptCore differs from the Node-generated corpus, the difference is listed and decided. | Corpus tests on macOS and on a simulator; `ios/tools/corpus/differences.md` (IN-02). |
| R10 | A fallback Cordova build never applies half a hand-back, although `UserDefaults` has no multi-key commit. | Interrupted-write tests and the simulator hand-back test (IN-17). |

## Exclusions

IN-19 (release) until separately authorized, widgets, Apple Watch, TodayAir, the #2651 restyle, changes to the Android app and server changes.

## Assumptions and risks

Observed on 2026-11-13 unless marked otherwise:

- **Deployment target iOS 17.0** (AK, 2026-11-13). SDK minimums of the latest releases: Firebase 13.1.1 iOS 15, Google Mobile Ads 13.12.0 iOS 13, UMP 3.1.0 iOS 12, Places SDK for iOS 11.3.0 iOS 17.
- **Build machine:** Xcode 27.2 and Swift 6.4.2; Xcode 27 simulates and debugs iOS 17 and later; the installed runtime is iOS 26.5. IN-03 records which WebKit storage layouts (iOS 17 onward) were tested.
- **Unverified until the spike:** that installing a build over another with the same bundle ID on a simulator keeps the data container and the App Group container; how the WKWebView `localStorage` is read; whether the shipped 1.1.1 IPA registers a URL scheme (IN-16).
- **JavaScript engine:** the corpus was generated under Node (V8), and the Cordova iOS app runs in JavaScriptCore. IN-02 measures the difference.
- **Private inputs:** building the Cordova iOS reference app needs the client configuration and Firebase files, which this checkout does not hold (`npm run release:fetch` in `client/`).
- Screenshot comparisons between SwiftUI and WKWebView renderings need tolerances; each comparison records its tolerance.
- Physical-device checks belong to IN-14 (alarm delivery) and IN-19.
