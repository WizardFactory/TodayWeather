# Plan: defer Android Ads SDK start

Consumes [intent](../intent/android-defer-ads-sdk.md) and [spec](../specs/android-defer-ads-sdk.md) for issue #3234.

| # | Change | Files | Check |
| --- | --- | --- | --- |
| 1 | TDD Red: introduce `SdkStartScheduler` / `CancelHandle` parameter on `AdsConsent` (keeping immediate start behavior), update existing `AdsConsentTest` cases (`aStoredConsentStartsTheSdkAtOnce` renamed deliberately to `aStoredConsentDefersTheSdkStartUntilTheSchedulerFires`), and add failing tests for deferred start, recreation cancellation/rebinding (start exactly once), and consent revocation/denial | `android/app/src/main/java/net/wizardfactory/todayweather/ads/AdsConsent.kt`, `MainActivity.kt`, `android/app/src/test/java/net/wizardfactory/todayweather/ads/AdsConsentTest.kt` | `./gradlew :app:testDebugUnitTest --tests "net.wizardfactory.todayweather.ads.AdsConsentTest"` fails behaviorally (`reports/sdlc/android-defer-ads-sdk/logs/tdd-red.log`) |
| 2 | TDD Green: implement deferred scheduling, generation-guarded cancellation/rebinding, `AfterFirstFrameIdleScheduler` (`Choreographer.postFrameCallback` -> `1_000L` ms delay -> `MessageQueue.IdleHandler` with `2_000L` ms fallback cap), and `Trace.beginSection("ads.startSdk")` in `AdsConsent.kt`; add Robolectric test for `AfterFirstFrameIdleScheduler` | `android/app/src/main/java/net/wizardfactory/todayweather/ads/AdsConsent.kt`, `AdsConsentTest.kt` | Focused `AdsConsentTest` passes (`reports/sdlc/android-defer-ads-sdk/logs/tdd-green.log`) |
| 3 | Document when the Ads SDK starts (after onboarding, first content frame, post-frame delay, and main-thread idle) and expected early-visit fill effect | `android/README.md`, `docs/operations/monetization.md` | Link/doc review; full JVM suite passes (`ParityChecklistTest`, `AdsConsentTest`, `TwAdsTest`, `NativeInventoryTest`, `ForecastVisitsTest`, `NativeSlotAnchorTest`, `NativeCardViewportTest`, `NativeCardLayoutTest`, `InterstitialChanceConfigTest`, `BannerGateTest`) |
| 4 | Full local build and JVM test verification | — | `./gradlew assembleDebug test` passes (`reports/sdlc/android-defer-ads-sdk/logs/full-test.log`) |
| 5 | Device & phone verification (coordinator gate, outside this worktree edit) | — | Emulator `AdsDeviceTest` (including banner switch) + `run-ads-check.sh`; Galaxy S21+ cold-start Perfetto traces (with and without `google-services.json`, 200 ms post-TTID tap, 6-run TTID check) |

## Rejected alternatives

- **Deferring `consent.start(this)`**: would delay the UMP consent update and first-launch consent form.
- **Idle-only after `postFrameCallback` with 0 ms minimum delay**: on Galaxy S21+, an idle point can arrive ~85–100 ms after TTID, causing `WebViewChromium.init` to collide with early user taps (including the scripted tap at TTID + 200 ms). Parameterizing `minDelayMs = 1_000L` and `maxIdleWaitMs = 2_000L` keeps tuning to one constant if phone traces require adjustment.
- **Deferring only inside `GoogleAdsPlatform.startSdk`**: would leave `AdsConsentTest` (which uses a fake `AdsPlatform`) blind to deferred start, cancellation, and recreation behavior.

## Rollback

Revert the branch/commit; the change only adjusts `AdsConsent` SDK start scheduling and documentation.

## User scenarios

| ID | User and goal | Steps | Expected | Failure |
| --- | --- | --- | --- | --- |
| S1 | Returning user opens app and taps quickly | Cold start with stored consent; tap 200 ms after TTID | First frame renders; tap is unobstructed; `ads.startSdk` and `WebViewChromium.init` run after 1 s delay and main-thread idle | `WebViewChromium.init` runs ~100 ms after TTID and delays tap |
| S2 | First-launch user sees consent prompt | Cold start without consent; complete start page; answer UMP form | UMP update and consent form open immediately without deferral; SDK starts only after consent is granted and scheduler fires | Consent form delayed or SDK starts before consent |
| S3 | User rotates phone right after launch | Cold start with stored consent; rotate before deferred start fires | Pending start for old activity is cancelled; new activity schedules and starts SDK exactly once | Activity leaked, SDK never starts, or SDK starts twice |
| S4 | User without consent or UMP failure in release | Launch with declined consent, revoked privacy options, or release UMP failure | No SDK start is scheduled or executed | SDK starts without valid consent |
