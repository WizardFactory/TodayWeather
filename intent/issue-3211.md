# Intent: separate Remote Config switches for the anchored banner and the native card (#3211)

| Field | Value |
| --- | --- |
| Task | `issue-3211`, implementation, change kind behavior |
| Source | [#3211](https://github.com/WizardFactory/TodayWeather/issues/3211); coordinator brief of 2026-11-26 relaying AK's authorization ("3개 이슈 발행하고 병렬로 premerge까지 진행") |
| Endpoint | `pre-merge`: implementation, tests, local builds, emulator/simulator/device runs with Google test ad units, commits, push of `feat/3211-ad-format-switches`, one PR to `master`, CI, SDLC review/correction, comments on #3211 only |
| Excluded | Merge, auto-merge, merge queue; store uploads, releases, tags; Firebase Remote Config, AdMob or console changes; clicking real ads; edits to #3212/#3213 or their branches; publishing AdMob figures |

## Problem

The native apps (Android 2.0.x, iOS 2.0.x) show ads only as in-content native cards and forecast interstitials (#3041, #3059). After 2026-11-18 ad impressions fell steeply while requests stayed matched (analysis in a private-figure comment on #3041). The operator needs to switch an anchored banner and the native card separately through Firebase Remote Config, without an app release.

## Outcome and acceptance criteria

- **AC1 — switch semantics.** A new key `tw_app_banner_enabled` (`"true"`/`"false"`, shipped default `false`) turns the anchored banner on. `tw_native_enabled` (default `true`) keeps switching the native card. Both true shows both formats. Any value other than `"true"` reads as off for the banner, so an invalid value falls back to the shipped default `false`. Android and iOS unit tests cover the four combinations, the defaults and an invalid value.
- **AC2 — Android banner.** The existing `AdMobBanner`/`TwAds`/`BannerSlot` code is wired back into `MainActivity` and the banner sits under the tab bar as in AN-15. A run with test ad units shows the banner and no native card for banner `true`/native `false`, and the reverse for the reverse values. Screenshots are attached to the PR.
- **AC3 — iOS banner.** A new anchored adaptive banner sits under the tab bar. It loads only after consent allows requests, follows the ATT/TCF personalization rule of the native card, waits for `tw_banner_delay_seconds` and reserves no strip while off or unfilled. Simulator screenshots with test ad units show both configurations of AC2.
- **AC4 — all-ads gate and offline start.** With `tw_banner_enabled` `false` no ad format loads on either platform. Without network on first start (defaults only) no banner appears and the native card behaves as before. A fetched change applies without a reinstall, as `tw_native_enabled` does.
- **AC5 — documentation.** The affected user manuals (with test-ad screenshots and rendered PDFs), operations/architecture notes and READMEs describe the new switch.

## Constraints

- Do not reuse `tw_banner_enabled` for the new banner: it remains the all-ads gate in the native apps and Cordova 1.x reads it for its banner. Keep `tw_banner_delay_seconds` as is.
- Keep edits to the shared files (`RemoteBannerConfig.kt`, `RemoteBannerConfig.swift`, `FirebaseBridges.swift`, `MainActivity.kt`) additive; the sibling tasks #3212 and #3213 touch them too.
- The repository is public: no AdMob figures, no private unit IDs.

## Findings that refine the issue text (2026-11-26)

- iOS today does not apply `tw_banner_enabled` to the native card or the interstitial: `Monetization.refreshEligibility` reads only consent, readiness and the per-format switches (`472e145e3`, #3059). The issue and the coordinator call it the all-ads gate in the native apps, and AC4 requires it on both platforms, so iOS gains that gate for every format. The delay keeps applying to the banner only on iOS (the issue asks for it there); Android already delays every format.
- Neither platform's private release inputs carry a banner unit any more (`TW_ADMOB_BANNER_ANDROID`/`TW_ADMOB_BANNER_IOS` were removed with the banner). Release builds need these values from the operator's private configuration before a banner can serve.

## Risks

- If the live Remote Config holds `tw_banner_enabled=false` the iOS native card stops after this release. Android already behaves so; the operator's planned use keeps it `true`.
- A banner turned on together with the native card adds requests; the operator plans to enable one format at a time.
