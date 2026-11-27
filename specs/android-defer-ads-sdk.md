# Spec: defer Android Ads SDK start

Consumes [intent](../intent/android-defer-ads-sdk.md) and the 2026-11-27 Galaxy S21+ cold-start Perfetto evidence (PERF-4, issue #3234).

## Deferred SDK start scheduling

1. `AdsConsent` accepts an injectable `SdkStartScheduler` returning a `CancelHandle`, so JVM tests can drive and verify deferred SDK start deterministically without sleeping or relying on real `Choreographer` / `MessageQueue` timing.
2. The production default scheduler (`AfterFirstFrameIdleScheduler`) sequences three stages on the main looper without waiting for user input:
   - Wait for the next `Choreographer.FrameCallback` so the first content frame can draw.
   - Wait a minimum delay (`minDelayMs`, default `1_000L` ms) via `Handler.postDelayed` after that frame callback so the first frame finishes and early post-TTID interactions (such as a tap 200 ms after TTID) do not collide with `WebViewChromium.init`.
   - Register a one-shot `MessageQueue.IdleHandler` on `Looper.getMainLooper().queue` alongside an upper-bound fallback (`maxIdleWaitMs`, default `2_000L` ms; `3_000L` ms total cap after the first frame) so the SDK starts at the first main-thread idle point after the delay, or at the upper bound if the main thread stays continuously busy.
3. Calling `CancelHandle.cancel()` at any stage removes any pending frame callback, delayed runnables, and idle handler, prevents the scheduled callback from running, and releases references cleanly.

## Trace section

4. Dispatching `platform.startSdk` is wrapped in an Android trace section named `ads.startSdk` (`android.os.Trace.beginSection("ads.startSdk")` / `endSection()` in a `try`/`finally` block), so Perfetto traces record the exact main-thread dispatch time relative to TTID, input events, idle periods, and `WebViewChromium.init`.

## Consent, lifecycle, and format invariants

5. `MainActivity` continues calling `opened.consent.start(this)` once state is loaded and the start page is not showing. UMP consent info update, consent form loading/display, and privacy options form handling stay immediate and unchanged.
6. Only `platform.startSdk` is deferred. Consent rules are unchanged:
   - `platform.startSdk` never runs unless `platform.canRequestAds()` is true or the existing debug-only technical-UMP-failure fallback applies (`!releaseAds` and not a consent decision).
   - If consent is revoked (for example via privacy options) before a scheduled start fires, the pending start is cancelled, and the callback also re-checks consent/fallback right before calling `platform.startSdk`.
7. Activity recreation and destruction:
   - `AdsConsent.stop(activity)` cancels any pending deferred start when no active activity remains, without leaking the destroyed activity.
   - Rebinding to a new activity via `AdsConsent.start(newActivity)` (whether after `stop(oldActivity)` or before it) cancels any stale pending handle and schedules a fresh start if the SDK has not yet started and consent/fallback permits it.
   - `platform.startSdk` runs at most once per `AdsConsent` instance; subsequent `start(activity)` calls or stale callbacks from cancelled handles never start the SDK a second time.
8. Ad format and analytics contracts remain unchanged:
   - Banner delay continues to be measured from app open (`TwAds.sessionStart`, `OpenedModel.adStart`), not from SDK start; no placeholder strip is reserved (#3211).
   - `NativeInventory` decision rules are unchanged (#3212); because the SDK becomes ready later, more first visits may finish as misses while pending, which is permitted by [specs/android-native-slot-reach.md](android-native-slot-reach.md).
   - `ForecastInterstitial` chance, spacing, and daily cap logic are unchanged (#3213).
   - Usage analytics startup order (`EarlyStartProvider`, `startAnalytics`) and `ad_lifecycle` telemetry are unchanged (AN-15).

## Non-goals

Removing the ~0.1 s `WebViewChromium.init` cost from the main thread altogether, deferring UMP consent requests or forms, changing ad-format eligibility/delay rules, or modifying manifest metadata flags (already set).
