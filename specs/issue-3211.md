# Spec: anchored banner and native card switches (#3211)

Consumes [intent](../intent/issue-3211.md) and the investigation in `reports/sdlc/issue-3211/investigation.md` (local). Platforms: native Android (`android/`) and native iOS (`ios/`). The WebApp, Cordova and the servers are unaffected.

## Remote Config

| Key | Shipped default | Read as | Applies to |
| --- | --- | --- | --- |
| `tw_banner_enabled` | `"true"` | Whole pair with the delay; invalid pair ignored (unchanged) | Every ad format of the native apps; Cordova's banner |
| `tw_banner_delay_seconds` | `"0"` | Integer 0..120 (unchanged) | Android: every format. iOS: the anchored banner |
| `tw_app_banner_enabled` (new) | `"false"` | `"true"` on, anything else off (the default) | The anchored banner |
| `tw_native_enabled` | `"true"` | `"true"` on, anything else off (unchanged) | The native card |
| `tw_interstitial_enabled` | `"true"` | unchanged | The forecast interstitial |

- The new key is registered in the in-app defaults on both platforms, so an install that never fetched reads `false`.
- The banner switch is read with the format switches: from the stored activated values, again after the fetch, and on iOS also from a published update while the app is open (the real-time listener already used for `tw_native_enabled`). Android applies it at the next app open after a fetch, as it does for `tw_native_enabled`.
- The app does not arbitrate between formats. Both on shows both.

## Anchored banner

**Eligible to request** when all hold: the Ads SDK has started and consent permits requests (UMP `canRequestAds`, or the debug-build fallback); no privacy options form is open; the Remote Config policy is final (applied, failed or 12 s timeout); `tw_banner_enabled` and `tw_app_banner_enabled` are both on; the activity/window exists. No request is made otherwise, so a disabled switch adds no unshown requests.

**Shown** when a loaded banner exists, it is eligible and `tw_banner_delay_seconds` has passed since the app opened (`BannerGate`). One `ad_policy_exposure` per app open counts when it becomes eligible.

**Turned off** (switch, consent or privacy form): the banner is hidden and destroyed. It loads again, respecting 5 s between loads, when eligible again. A change of the request's personalization (ATT/TCF) on iOS replaces the banner, as it discards native creatives.

**Layout.** The banner sits under the tab bar, above the system navigation bar (Android) or on the home-indicator inset with black below (iOS), as AN-15/IN-15 placed it. While no banner is shown, the shell keeps its full height: no reserved strip. Pages, menus and popups over the tabs end at the banner's top while it shows.

**Units.** Debug builds use Google's adaptive-banner test units. Release builds read `TW_ADMOB_BANNER_ANDROID` (Gradle property/environment) and `TW_ADMOB_BANNER_IOS` (`Private.xcconfig` → `TWAdMobBannerUnit`). Android release packaging and the iOS release archive check reject a missing or test value, as for the other units. At runtime on iOS a missing or malformed banner unit disables only the banner.

## Native card and interstitial

- Android: unchanged.
- iOS: additionally require `tw_banner_enabled` to be on, so the all-ads gate holds on both platforms. No delay is added to the iOS native card or interstitial.

## Failure paths

- Offline first start: defaults apply → banner off, native card as before.
- Fetch fails or exceeds 12 s: the stored values (or defaults) apply.
- No fill: nothing shown, nothing reserved; `ad_load_error` with the SDK code.
- Banner unit missing on iOS: banner never requested; other formats unaffected.

## Out of scope

Console values, ad unit creation, mediation, Cordova changes, arbitration between formats.
