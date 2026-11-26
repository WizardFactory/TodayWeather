# #3211 format switch captures (2026-11-26)

Dated screenshots of the Remote Config format switches with Google test ad units. Remote Config values were injected by test code (Android `FixedRemoteConfig`, iOS `BannerSwitchSmokeTests.FixedConfig`); no Firebase console value was changed. Images are downscaled to 540 px wide.

| File | Platform / run | Switches | Observed |
| --- | --- | --- | --- |
| `android-banner-only.png`, `android-banner-only-locations.png` | `AdsDeviceTest#theRemoteSwitchesSelectTheAnchoredBanner`, `-e adFormats banner`, tw_api36_capture emulator | banner true, native false | Test banner under the tab bar on all four tabs; no native card (test passed) |
| `android-all-off.png` | same test, `-e adFormats off` (rerun after review round 1) | `tw_banner_enabled` false; banner, native and interstitial switches on | No banner, no strip, no native card (test passed) |
| `android-native-only.png` | `AdsDeviceTest#aTestNativeCardLoadsOnAllFourPagesWhileAnalyticsStaysOff`, `-e adFormats native`, tw_api34_play emulator (API 34) | banner false, native true | Google native test ad on all four tabs; no banner (test passed). The SDK's test-ad validator bubbles overlay the page. |
| `ios-banner-only.png` | `BannerSwitchSmokeTests` `banner`, iPhone 16 simulator iOS 26.5 | banner true, native false | Test banner under the tab bar; native inventory disabled |
| `ios-native-only.png` | same, `native` | banner false, native true | Google native test creative in Hourly; no banner request, no slot |
| `ios-all-off.png` | same, `off` (after review round 2) | `tw_banner_enabled` false; every format switch on | No banner, native or interstitial enabled |

Note: on tw_api36_capture (API 36) the native-only run found no native card within 120 s; the SDK logged "Incorrect native ad response. Click actions were not properly specified", and the unchanged master build (f69254ec5) failed the same way there the same day. The same test passed on tw_api34_play.

SHA-256:

```
087e53047dacafe8fad0a5f0c95b7d4a6d67e3ea7f45f486388a575d2d2d839f  android-all-off.png
fa8ac1e912de39760c02742cefc901c074624b12182f612ba840f05d494fd2e0  android-banner-only-locations.png
96580eb2556aec8d930f8eade2c4af981ab4ecae7646bf0060228705f47d8714  android-banner-only.png
82a247343795a8a5eabbc37b122f01d123fd363879c482bb994c9b1276318a5b  android-native-only.png
c64e2fa34697ead451fb8ce6adb5c688103da141ee788bae516b45b2add36a3f  ios-all-off.png
493d7a32bac0d7bac415f14779854f5b89b2c60a9b297c651ad7284c184a28c7  ios-banner-only.png
a7a4a8024752737baf57780390de9dd73babf511673619f1eb51fa74e8570eae  ios-native-only.png
```
