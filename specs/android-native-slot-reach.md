# Spec: Android native card decided at slot reach

Consumes [intent](../intent/android-native-slot-reach.md). Amends the late-ad sentence of [Android forecast ad placement](../docs/rewrite/android-forecast-ad-placement.md).

## Definitions

- **Visit**: one composition of a tab's page for one city (`key(selected, city)` in `MainActivity`). A menu or overlay that temporarily removes the slot does not end the visit.
- **Reached**: the slot's insertion point is at or above the bottom edge of the page's scroll viewport, i.e. any part of the page from the insertion point downwards is inside the viewport. This matches iOS (`viewport.maxY >= 0` for the slot anchor). An insertion point already scrolled past (above the viewport) counts as reached.

## Behavior

1. When a visit opens and the tab has an assigned, unexpired ad, or a spare is ready, the visit takes it immediately (unchanged). Taking it early cannot move content the reader sees, because the reach decision would pick the same ad.
2. Otherwise the visit is **pending**. A fill that arrives while the visit is pending and the slot is not yet reached is assigned to the visit's tab and shown at once. The card appears below the viewport, so nothing visible moves.
3. When the slot is reached while still pending, the visit is decided as a miss. Later fills become the spare for a future visit (unchanged #3041 rule).
4. A decided visit never changes its decision, except that expiry or disabling clears a shown card (unchanged).
5. Returning from an overlay with the same visit key keeps the decision or the pending state.
6. A pending fill also triggers preparation of the next spare, as `open()` does after it consumes one.

## Non-goals

No change to load timing, retry, the 55-minute lifetime, the eligibility gate (consent, SDK, Remote Config, delay) or card layout.

## Viewport visibility of the card (amendment 2026-11-26)

7. The registered `NativeAdView` is `VISIBLE` exactly while some part of the card's area is inside the scroll viewport, and `INVISIBLE` otherwise. That includes the band under the tab bar and an area scrolled above the viewport. `INVISIBLE` keeps the layout, so nothing moves when the view switches. The SDK reads impressions from the Android view, which the Compose scroll clip does not hide.
