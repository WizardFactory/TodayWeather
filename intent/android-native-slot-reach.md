# Intent: decide the Android native card when its slot is reached

- Task: `android-native-slot-reach` (issue #3212). Mode: implementation. Change kind: behavior. Endpoint: **pre-merge** (no merge, release, upload, Remote Config or AdMob console change).
- Source and authority: AK, 2026-11-26, through the coordinating agent: "3개 이슈 발행하고 병렬로 premerge까지 진행". Sibling tasks #3211 and #3213 run separately.

## Problem

`NativeInventory.open()` assigns a creative only when a tab/city visit opens. After a cold start the Hourly page opens before consent, SDK start, Remote Config and the first native load have finished, so the first visit of a session shows no card even when the ad arrives before the reader scrolls to the slot. The loaded ad then waits for a later visit or expires after 55 minutes. iOS decides when the slot comes into view (`ForecastNativeSlot`, `NativeAdVisit`).

## Outcome

An ad that is ready before the reader reaches the slot's insertion point is shown in that visit. An ad that arrives after the slot was reached waits for a later visit, so the forecast never moves under the reader. The other #3041 rules stay: one decision per visit, a tab keeps its assigned ad, 55-minute lifetime, consent and remote switches, no blank gap on no fill.

## Scope and exclusions

In scope: `android/app/src/main/java/net/wizardfactory/todayweather/ads/NativeInventory.kt`, `NativeForecastAds.kt`, their unit tests, `docs/rewrite/android-forecast-ad-placement.md`.
Out of scope: iOS, banner and interstitial behavior (#3211, #3213), Remote Config keys, ad units.

## Acceptance criteria

- **AC1** Unit tests: an ad arriving after the visit opened but before the slot is reached is shown; an ad arriving after the slot was reached is not shown in that visit and serves the next one. Existing `NativeInventoryTest` cases pass.
- **AC2** Device run of a debug build with test units: a card on the first Hourly visit after a cold start once the reader scrolls to the slot, with `ad_lifecycle` `impression` logged. Logcat or screenshot attached to the PR.
- **AC3** Pre-change observation recorded on #3212 (done: https://github.com/WizardFactory/TodayWeather/issues/3212#issuecomment-7182775503).
- **AC4** Hourly, Daily, Air and Saved Places slots all use the reach rule (they share `rememberNativeAdSlot`).

## Amendment 2026-11-26: early impression (AK)

The post-change emulator run found that the SDK records an impression for a card composed just below the scroll viewport, under the tab bar. The Compose clip does not hide the embedded `NativeAdView` from the SDK's view-visibility check. The problem predates this change, which makes it more frequent. AK decided to fix it in this PR ([finding](https://github.com/WizardFactory/TodayWeather/issues/3212#issuecomment-7183169165)).

- **AC5** While no part of the card is inside the scroll viewport, the registered `NativeAdView` is `INVISIBLE`, which keeps its layout size. Inside the viewport it is `VISIBLE`. A JVM test covers the switch. On the device, `impression` follows the scroll to the card, not the load.
