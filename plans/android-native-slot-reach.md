# Plan: Android native card decided at slot reach

Consumes [intent](../intent/android-native-slot-reach.md) and [spec](../specs/android-native-slot-reach.md).

## Work

| # | Change | Files | Check |
| --- | --- | --- | --- |
| 1 | Pending visit state, `reach()`, fill-to-pending-visit | `ads/NativeInventory.kt`, `NativeInventoryTest.kt` | New tests red first, then green; existing cases pass with the test helper reaching the slot at open |
| 2 | Compose anchor that reports reach | `ads/NativeForecastAds.kt` (`NativeAdSlot`) | Robolectric/Compose test of the anchor inside a scrolling column; device run |
| 2b | Card view `INVISIBLE` outside the scroll viewport (amendment 2026-11-26) | `ads/NativeForecastAds.kt` (`NativeCardHost`, `NativeCard.mount`), `NativeCardViewportTest.kt` | Test red first; device: `impression` only after scrolling to the card |
| 3 | Document the rule | `docs/rewrite/android-forecast-ad-placement.md` | Link check |

The anchor is a zero-height layout whose probe child extends downward without taking space. Compose clips `boundsInWindow()` at every clipping ancestor (the vertical scroll container), so the probe's clipped bounds are non-empty exactly when the insertion point is above the viewport's bottom edge. No per-screen plumbing is needed; the Hourly, Daily, Air and Saved Places slots all go through `rememberNativeAdSlot`.

Rejected: deciding only at reach (iOS style) even when an ad is on hand. It shows a one-frame jump when the slot is visible at open, and changes nothing else. Using the window bottom as the viewport edge: it ignores the tab bar and banner area.

## User scenarios

| ID | User and goal | Steps | Expected | Failure |
| --- | --- | --- | --- | --- |
| S1 | Cold start reader on Hourly | Force-stop, open, wait for the native load, scroll to the slot | Card shown in the first visit; `impression` logged | No card until another visit |
| S2 | Reader who reaches the slot before the load | Open, scroll past the slot at once | No card in this visit; the later fill serves the next visit | Card inserted above or at the reader's position |
| S3 | Tab return | Hourly with card, Daily, back to Hourly | Hourly keeps its card from the first frame | Card swapped or missing |
| S5 | Card filled below the fold | Cold start, wait for the load, do not scroll | No `impression` yet; it is logged after scrolling to the card | `impression` logged while the card is under the tab bar |
| S4 | Overlay during a pending visit | Open, menu, close | Visit keeps its pending state; decision made at reach | New visit started |

## Verification mode

TDD for the inventory (AC1). The Compose reach anchor gets a JVM Compose test plus the device smoke (AC2, S1). S2 is covered by the unit test; on device it depends on load timing.
