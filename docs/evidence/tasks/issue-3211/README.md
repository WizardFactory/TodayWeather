# #3211 format switch captures (2026-11-26)

Dated screenshots of the Remote Config format switches with Google test ad units. Remote Config values were injected by test code (Android `FixedRemoteConfig`, iOS `BannerSwitchSmokeTests.FixedConfig`); no Firebase console value was changed. Images are downscaled to 540 px wide.

| File | Platform / run | Switches | Observed |
| --- | --- | --- | --- |
| `android-banner-only.png`, `android-banner-only-locations.png` | `AdsDeviceTest#theRemoteSwitchesSelectTheAnchoredBanner`, `-e adFormats banner`, tw_api36_capture emulator | banner true, native false | Test banner under the tab bar on all four tabs; no native card (test passed) |
| `android-all-off.png` | same test, `-e adFormats off` | `tw_banner_enabled` false | No banner, no strip, no native card (test passed) |
| `ios-banner-only.png` | `BannerSwitchSmokeTests` `banner`, iPhone 16 simulator iOS 26.5 | banner true, native false | Test banner under the tab bar; native inventory disabled |
| `ios-native-only.png` | same, `native` | banner false, native true | Google native test creative in Hourly; no banner request, no slot |
| `ios-all-off.png` | same, `off` | `tw_banner_enabled` false | Neither format requested |

Limitation: the Android native-only run (`#aTestNativeCardLoadsOnAllFourPagesWhileAnalyticsStaysOff`, `-e adFormats native`) found no native card within 120 s; the SDK logged "Incorrect native ad response. Click actions were not properly specified". The unchanged master build (f69254ec5) failed the same way on the same emulator the same day, so no Android native-only screenshot is included.

SHA-256:

```
2d19a868ca307f871b64abf124a444c43cae8197b1cfdd3b84a01574d4892aa6  android-all-off.png
fa8ac1e912de39760c02742cefc901c074624b12182f612ba840f05d494fd2e0  android-banner-only-locations.png
96580eb2556aec8d930f8eade2c4af981ab4ecae7646bf0060228705f47d8714  android-banner-only.png
c64e2fa34697ead451fb8ce6adb5c688103da141ee788bae516b45b2add36a3f  ios-all-off.png
493d7a32bac0d7bac415f14779854f5b89b2c60a9b297c651ad7284c184a28c7  ios-banner-only.png
a7a4a8024752737baf57780390de9dd73babf511673619f1eb51fa74e8570eae  ios-native-only.png
```
