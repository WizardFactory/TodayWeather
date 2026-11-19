# Android advertising implementation plan

[Intent](../intent/issue-3041.md) · [Screen specification](../docs/rewrite/android-forecast-ad-placement.md)

| Scenario | Actions and expected result | Failure path and verification |
| --- | --- | --- |
| AC1 · Read forecast, air or saved places | Open a populated tab and scroll to the specified position. One labeled card appears. Search/edit hides it. | Empty or late ad leaves the reader’s position unchanged. Compose and native inventory checks. |
| AC2 · Revisit forecasts | Open Hourly and Daily once, read past the chart and tap a visited forecast. An eligible draw may show a ready ad. Dismiss to reach the selected tab. | On failure continue immediately. Rapid taps, restart or date rollback cannot repeat a consumed cap. Clock and callback tests. |
| AC3 · Disable advertising | Apply remote format switches and revoke eligibility. Open or refresh the app and use core navigation. | Loaded or outstanding ads cannot bypass the gate. SDK setup, debug/release configuration and emulator smoke. |

Build the format adapters and daily reservation independently. Integrate through MainActivity and the scrollable screen bodies. Run focused and wider Android checks before the fresh-device journey, manual update, independent review and CI. Roll back formats independently through their existing-app-open Remote Config fetch.
