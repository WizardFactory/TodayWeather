# Plan: anchored banner and native card switches (#3211)

Consumes [intent](../intent/issue-3211.md) and [spec](../specs/issue-3211.md). One PR to `master` from `feat/3211-ad-format-switches`. Design stage: the change restores the AN-15/IN-15 banner flow with one more gate; the existing [Android](../docs/architecture/diagrams/android-ad-delivery.html) and [iOS](../docs/architecture/diagrams/ios-forecast-ad-delivery.html) delivery diagrams are updated rather than a new design produced.

## User scenarios

| ID | User | Goal | Prerequisites | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | Operator | Serve the anchored banner instead of the native card | Remote Config `tw_app_banner_enabled=true`, `tw_native_enabled=false`, `tw_banner_enabled=true` | Publish; reader opens the app after the fetch | Banner under the tab bar on every tab; no native card | No fill: no banner, no empty strip | AC1, AC2, AC3 |
| S2 | Operator | Serve only the native card (today's setup) | `tw_app_banner_enabled=false`, `tw_native_enabled=true` | Publish; reader opens the app | Native cards in content; no banner, full-height shell | — | AC1, AC2, AC3 |
| S3 | Operator | Stop all ads | `tw_banner_enabled=false` | Publish; reader opens the app | No format requests or shows | Offline client keeps its last fetched values | AC4 |
| S4 | New reader | First start offline | Fresh install, no network | Open the app, close S01, view tabs | Defaults: no banner; native card behaves as before | — | AC4 |
| S5 | Reader | Consent and privacy | UMP form required or privacy options opened | Answer the form / open 광고 개인정보 선택 | No banner request before consent; banner hidden while the privacy form is open and reloaded after | Consent refused: no banner | AC3 |
| S6 | Operator | Change the switch without a release | Running app (iOS) or next open (Android) | Publish a new value | iOS applies a published update in the open app; Android at the next open after the fetch | Fetch fails: stored values stay | AC4 |

Machine-readable copy: `reports/sdlc/issue-3211/user-scenarios.json` (local).

## Files

Android (`android/app/src/main/java/net/wizardfactory/todayweather/`):
- `analytics/RemoteBannerConfig.kt`: add `APP_BANNER_ENABLED`, its default and `State.appBannerEnabled` (additive).
- `ads/TwAds.kt`: request only while eligible ([spec](../specs/issue-3211.md#anchored-banner)); `setPermitted`; destroy when not eligible; gate shown on the new switch.
- `MainActivity.kt`: create `AdMobBanner` per activity, attach/detach, pause/resume, pass `BannerSlot` to `AppContent` while shown; `OpenedModel.ads` with the shared `adConfig`.
- `app/build.gradle.kts`: `BANNER_AD_UNIT` (debug test unit; release `TW_ADMOB_BANNER_ANDROID`, required).
- Tests: `ads/TwAdsTest.kt` (switch matrix, defaults, invalid value, kill switch, no request while off, turning off destroys); device test `AdsDeviceTest#theRemoteSwitchesSelectTheAnchoredBanner` and `FixedRemoteConfig` in `TestRunner.kt`.

iOS:
- `Core/Sources/TWDomain/Ads/RemoteBannerConfig.swift`: `appBannerEnabledKey`, default, `appBannerEnabled`, live update (additive).
- `Core/Sources/TWDomain/Ads/TwAds.swift`: same eligibility rules as Android; no longer takes over `config.onChange` (the owner forwards changes).
- `TodayWeather/Ads/AdMobBanner.swift`: restored from `472e145e3^` (anchored adaptive banner, `makeRequest()` personalization).
- `TodayWeather/Ads/Monetization.swift`: create banner and `TwAds`; forward eligibility (consent, privacy form, personalization change); `tw_banner_enabled` gates native and interstitial; width change refreshes the banner; injectable Remote Config source (`configSource`) for tests.
- `TodayWeather/Ads/FirebaseBridges.swift`: listen for and read the new key (additive).
- `TodayWeather/Ads/AdsSettings.swift`, `Support/Info.plist`, `Support/App.xcconfig`, `tools/ads/check_release.py`, `tools/ads/run-ads-check.sh`, `tools/manual/run-manual-capture.sh`: optional runtime banner unit, required in the release check.
- `TodayWeather/Shell/ShellView.swift`: restore the banner slot under the tab bar.
- Tests: `Core/Tests/TWDomainTests/ForecastFormatConfigTests.swift`, `BannerPolicyTests.swift`, `Core/Tests/TWDataTests/RequestSitesTests.swift` (SDK site register); `TodayWeatherTests/BannerLayoutTests.swift` (restored), `AdPrivacyBundleTests.swift`, `BannerSwitchSmokeTests.swift` (new).

Docs: `docs/operations/monetization.md` (switch table), `android/README.md`, `ios/README.md`, `docs/architecture/diagrams/{android-ad-delivery,ios-forecast-ad-delivery}.json` and regenerated HTML, the forecast-ads manuals under `docs/user/android-app/forecast-ads/` and `docs/user/ios-app/forecast-ads/` (banner screenshots, rendered PDFs).

## Order

1. Android config + TwAds tests (red), implementation (green); MainActivity wiring; build.
2. iOS domain config + TwAds tests (red), implementation (green); app wiring; Xcode tests.
3. Emulator run (banner-only and native-only) with test units, screenshots; simulator run likewise.
4. Docs, diagrams, manuals; artifact checker; commit, push, PR; Codex review loop.

## Checks

- `./gradlew :app:testDebugUnitTest --tests '*TwAdsTest*'` then the full app unit suite; `./gradlew :app:assembleDebug`.
- `swift test --package-path ios/Core --filter 'ForecastFormatConfigTests|BannerPolicyTests'` then the full Core suite; the Xcode app tests per `ios/README.md`.
- Smoke (no console change; Remote Config values are injected by test code only):
  - Android: `AdsDeviceTest#theRemoteSwitchesSelectTheAnchoredBanner` with `-e ads online -e adFormats banner` and `off`, and `#aTestNativeCardLoadsOnAllFourPagesWhileAnalyticsStaysOff` with `-e adFormats native`, on an emulator with Google test units. `FixedRemoteConfig` (androidTest) replaces Firebase.
  - iOS: `BannerSwitchSmokeTests` (`TEST_RUNNER_TW_BANNER_CAPTURE=1`) drives the app's `Monetization` with real UMP, the Ads SDK and Google's demo units through an injected `BannerConfigSource`, on a task simulator with the tracking answer stored.
  - Screenshots from those runs feed the PR and the manuals.

## Rollback

Remote: publish `tw_app_banner_enabled=false` (the default). Code: revert the PR; the new key is then ignored.

## Risks

See [intent](../intent/issue-3211.md#risks). Rejected alternative: reusing `tw_banner_enabled` for the banner (changes Cordova and the all-ads gate).
