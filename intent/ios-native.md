# Intent: iOS-native TodayWeather app (#2948)

## Source and authority

- #2948 and its sub-issues #2950–#2968 (IN-01..IN-19) are the requirements authority.
- #2877 decision 1 (AK, 2026-11-07): iOS moves to native after the Android app.
- AK, 2026-11-13: asked for the iOS issue (#2948), then for `/sdlc` "Planning, breakdown 등 빌드 준비" with "Android 버전은 오픈베타로 넘어갔으니 이제 iOS 진행하면됨". This settles the start decision of #2948: the iOS work starts now.
- AK, 2026-11-13, after the minimum-version research: "17로 확정하고 개발 진행", then two answers: merge each sub-issue pull request after a review PASS and CI ("병합까지"), and continue through IN-18 ("IN-18까지"): if the spike gates pass, IN-06 counts as go. Recorded on #2948 (https://github.com/WizardFactory/TodayWeather/issues/2948#issuecomment-6844921241).

Mode: implementation. Endpoint per sub-issue: **main** (merge after review PASS and CI). Authorized: scoped code, tests and docs under `ios/` (and `client/` only for IN-17 if the hand-back reader needs an iOS fix), the shared workflow `.github/workflows/ios.yml`, these intent/spec/plan documents, local builds and simulator runs, commits, pushes, PRs, CI, cross-provider review, corrections, merges, and updates of #2948 and its sub-issues. Excluded: IN-19 (release signing, physical-device gate, TestFlight and App Store steps), deployments, store or production actions, production push writes (IN-14's physical-iPhone criterion needs AK's separate authorization), secrets in Git, new accounts and permission changes. A failed spike gate stops the run at IN-06.

## Problem

The iOS app is the Cordova 13 / cordova-ios 8.1.1 / Ionic 1 build in `client/` (App Store 1.1.1, deployment target iOS 15.0, iPhone and iPad). #2948 replaces it with a Swift/SwiftUI app that behaves and looks the same and ships as an update of `net.wizardfactory.todayweather`, so installed users keep their places, settings, alarms and push registration.

## Desired outcome

An `ios/` Xcode project that reproduces the Cordova iOS 1.1.1 app on the legacy server API. It is proven against the Cordova code (the golden corpus shared with Android), captures of the Cordova iOS build and a simulator upgrade from the Cordova build, and it is ready for the release work of IN-19.

## Acceptance criteria

Each sub-issue's completion criteria are its acceptance criteria. Program-level outcomes:

- **P1** — Every sub-issue IN-01..IN-18 is merged with its criteria met or a recorded, reviewed limitation.
- **P2** — The iOS build never reads `client/`, `android/`, `tw.ios/`, `ta.ios/` or `applewatch/`; CI builds and tests `ios/` in a checkout without them.
- **P3** — No production writes and no private inputs in Git, logs or docs. Tests reach neither the production push server nor the production Firebase project.

## Decisions

Settled:

- **Start (AK, 2026-11-13):** now; the Android app is in open beta.
- **Inherited from #2877 and AN-06:** the legacy server without changes; `v000903` for every call; Cordova anomalies kept except A01; S13–S16 not built; 12:00 AM in the alarm picker acts as Delete; the free-form weather-address fallback keeps its HTTP 501; the feedback mail keeps the device UUID (D37); widgets later.
- **Deployment target (AK, 2026-11-13): iOS 17.0.** Xcode 27 simulates and debugs only iOS 17+; the Places SDK for iOS needs 17; iOS 15–16 were about 2.3% of the app's devices and keep Cordova 1.1.1.
- **Place search:** the Places SDK for iOS with a key restricted to the bundle ID (AK issues it). Blocks IN-10 until then.

Planning basis (the recommended defaults of #2948, accepted with "IN-18까지"; IN-06 records them):

- **Core reuse:** option A, a Swift port checked against the shared golden corpus.
- **Text size:** follow Dynamic Type, verified up to `xxxLarge`.
- **Cordova iOS during the build:** fixes only.

## Scope

In scope: IN-01..IN-18. Out of scope: IN-19 until separately authorized, widgets (WidgetKit), Apple Watch, TodayAir, the #2651 restyle, changes to the Android app, and server changes.
