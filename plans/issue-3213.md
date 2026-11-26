# Issue #3213: forecast interstitial chance through Remote Config

Source: [#3213](https://github.com/WizardFactory/TodayWeather/issues/3213), the canonical intent and specification. Authority: AK, 2026-11-26, "3개 이슈 발행하고 병렬로 premerge까지 진행" (via the coordinator); endpoint pre-merge, no merge. Decisions fixed by the coordinator: key `tw_interstitial_chance`, an integer percent from 0 to 100, default 30, an invalid value uses 30; every other interstitial rule stays unchanged.

## Behavior

- Both apps register `tw_interstitial_chance` with the default `30` next to `tw_native_enabled` and `tw_interstitial_enabled`.
- A value is valid only when it is a non-empty string of ASCII digits whose integer value is at most 100. Anything else, including an absent key, a sign, a decimal point, whitespace, non-ASCII digits or an overflow, gives 30.
- An eligible repeat transition shows a ready ad when `draw < percent / 100`, with `draw` uniform in `[0, 1)`. `0` never shows, `100` always shows. The draw is still taken once per eligible action.
- The percentage is read at each draw, so a fetched value applies to later draws without a reinstall:
  - Android: `RemoteBannerConfig.interstitialChance`, applied from the activated values and then the fetch of each app opening, including a fetch activated after the 12 s timeout (CODEX-1). It is kept outside the published `State`, so a change does not restart ad eligibility. `MainActivity` hands `ForecastInterstitial` a reader of it.
  - iOS: `RemoteBannerConfig.interstitialChance`, applied from the startup snapshot and from realtime updates; a chance-only update does not call `onChange` (no eligibility refresh or preload, CODEX-3). `FirebaseBridges` adds the key to the realtime key set and to `values()`. `Monetization` hands `ForecastInterstitial` a reader of the current config.
- Unchanged: eligibility (first-visit protection, read-past-chart and source/destination rules), the one-per-day cap, reservation and release, `tw_interstitial_enabled`, consent and the legacy banner policy.

## Files

| Area | Files |
| --- | --- |
| Android | `analytics/RemoteBannerConfig.kt` (key, default, parser, `interstitialChance` property outside the published state, defaults, late-fetch apply), `ads/ForecastVisits.kt` (chance reader replaces `REPEAT_CHANCE`), `ads/ForecastInterstitial.kt` (passes the reader), `MainActivity.kt` (reads `opened.adConfig.interstitialChance`) |
| iOS | `TWDomain/Ads/RemoteBannerConfig.swift`, `TWDomain/Ads/ForecastAdVisits.swift`, `TodayWeather/Ads/ForecastInterstitial.swift`, `Monetization.swift`, `FirebaseBridges.swift` |
| Tests | `ForecastVisitsTest.kt`, new `InterstitialChanceConfigTest.kt`, `ForecastInterstitialDeviceTest.kt` (and its declared count in the release-CI adb double `android/tools/release-ci/test/adb`); `ForecastAdVisitsTests.swift`, `ForecastFormatConfigTests.swift` |
| Documents | `docs/rewrite/android-forecast-ad-placement.md` (#3041 design notes), `android/README.md`, `ios/README.md`, `docs/user/ios-app/README.md`, `plans/issue-3059.md` (historical note), both ad-delivery Archify diagrams (JSON and regenerated HTML) |

Sibling tasks #3211 and #3212 edit the same config files; these edits only add constants, fields and list entries.

## Acceptance criteria

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC1 | Default 30 when the key is absent; 0 never and 100 always; an invalid value uses 30; a draw just below the threshold shows and one at the threshold does not | `InterstitialChanceConfigTest`, `ForecastVisitsTest.theConfiguredChanceDecidesEachEligibleReturn`; `ForecastFormatConfigTests.interstitialChance*`, `ForecastAdVisitsTests.theConfiguredChanceDecidesEachEligibleReturn` |
| AC2 | Existing interstitial tests (daily cap, first-visit protection, reservation) still pass on both platforms | Android `ads`/`analytics` unit packages and `ForecastInterstitialDeviceTest`; iOS `swift test` and app-hosted `ForecastInterstitialTests` |
| AC3 | A fetched value applies to later draws without a reinstall | Android: stored-then-fetched and fetch-after-timeout tests (`InterstitialChanceConfigTest`); iOS: stored-then-fetched and published realtime-update tests (`ForecastFormatConfigTests`); `aChangedChanceAppliesToTheNextDrawWithoutANewInstance` on both |
| AC4 | No repository document states 10% as the current chance | `rg` over the repository for the old statements; regenerated diagrams |

## User scenarios

| ID | User and goal | Steps | Expected | Failure path | AC |
| --- | --- | --- | --- | --- | --- |
| U1 | A reader moving between Hourly and Daily on a fresh install (no fetched value) | Open a place on Hourly, read past the chart, open Daily, read past the chart, tap Hourly | Each eligible return shows a ready ad with 30% chance, at most once per day | No ready ad or a draw at or above 0.30: the tab opens immediately | AC1, AC2 |
| U2 | The operator sets `tw_interstitial_chance` to 0 or 100 in the console | The app fetches the template on the next opening (iOS: also a realtime update) | 0: no interstitial; 100: every eligible return while the daily allowance remains | A malformed value (for example `150` or `30.5`): 30 applies | AC1, AC3 |
| U3 | Documentation reader | Read the ad placement notes, READMEs, the iOS user guide and diagrams | They state the Remote Config chance and its default 30 | — | AC4 |

## Verification

- Test-first: the new tests were added before the implementation and failed to compile against the missing API (Android `compileDebugUnitTestKotlin`, iOS `swift test`); they pass afterwards.
- Additional functional smoke: the debug Android build on an emulator (`tw_api36_capture`) with Google's test interstitial unit, driven through Hourly ↔ Daily after reading past the chart until the test interstitial showed and the daily allowance was recorded as spent. The on-device `ForecastInterstitialDeviceTest` runs the real controller, activity and preferences with the default and a changed chance. The iOS app builds and its app-hosted interstitial tests pass on a task simulator; an iOS UI journey to a shown ad was not run (the local Debug build has no private server configuration).
- Archify diagrams regenerated with `finalize` (validate, deliver, check, browser-check) and `visual-check`.
