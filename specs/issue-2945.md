# Spec: App Tracking Transparency for personalized AdMob requests on iOS (#2945)

Source: [intent](../intent/issue-2945.md), AK's decision in
[#2660](https://github.com/WizardFactory/TodayWeather/issues/2660#issuecomment-6841327261), master `9b3a362e`,
`emi-indo-cordova-plugin-admob` 3.0.4 source, and Google's IDFA documentation read on 2026-11-13
([SDK guide](https://developers.google.com/admob/ios/privacy/idfa),
[message selection](https://support.google.com/admob/answer/10114020)).

## Problem and outcome

The iOS build removes the ATT purpose string and forces `npa=1` on every AdMob request. After this change, a user who
allows tracking gets personalized requests. Every other user keeps non-personalized requests with the publisher
first-party ID off. Android does not change.

## Behaviour that stays

- UMP runs inside the plugin's `initialize`. Release builds request no ads until UMP allows them.
- Firebase Analytics keeps the Core variant, IDFV and ad-network registration off, the GTM removal and its guards.
  Analytics consent stays opt-in and separate. The four Analytics advertising consent categories stay denied.
- The build hook still fails when the plugin's request anchor, the Analytics package anchor or a GTM container changes.
- Android behaviour, the banner policy, the five-second request spacing and the #2871 first-session start.

## Requirements

### R1. Consent order (AC2)

1. The app does not call the plugin's `requestIDFA` or any other ATT request. UMP owns the explainer and the system
   prompt. iOS shows the system prompt once per install, and UMP offers its form only while the status is not determined.
2. On iOS the adapter reports "ready" to TwAds only after both events: the Ads SDK has started, and the plugin's
   `initialize` call has answered (success or error). The first banner request therefore follows the GDPR message and
   the explainer or ATT prompt, including on an upgraded install whose cached consent starts the SDK early.
3. Failure path: when the consent update fails but the SDK already started from cached consent, ads continue as today.
   When UMP gives no permission, release builds request no ads, as today.
4. When the IDFA message is unpublished or cannot load, no prompt appears, the status stays not determined and requests
   stay non-personalized.

### R2. Request rule (AC3)

Each request is built in the plugin's `setAdRequest`. The hook injects a rule there that reads the live state:

| ATT status | Stored consent | Request |
| --- | --- | --- |
| authorized | GDPR does not apply, or TCF purposes 1, 3 and 4 are consented | personalized: no `npa`, first-party ID on |
| authorized | GDPR applies and purpose 1, 3 or 4 is missing | `npa=1`, first-party ID off |
| denied, restricted, not determined | any | `npa=1`, first-party ID off |
| unavailable or unknown value | any | `npa=1`, first-party ID off |

- "GDPR applies" means `IABTCF_gdprApplies` is 1. Ads are requested only after UMP completed, so a missing value means
  UMP found no GDPR requirement. The Ads SDK still applies its own consent checks to a personalized request.
- The rule is one plain C function, so a test can compile and run it for every status. The hook copies it into the
  generated plugin source.
- The hook also adds a read-only plugin action that returns the ATT status name and the request mode. It never prompts.
  The adapter calls it once consent has settled and writes one `console.log` line:
  `{"component":"admob","operation":"request_policy","att_status":...,"personalized":...,"result":"applied"}`.
  If the action fails, the line reports `att_status: "unavailable"` and ads continue; the native rule is unaffected.

### R3. Purpose strings (AC4)

- `client/resources/ios/tracking/<locale>.lproj/InfoPlist.strings` holds `NSUserTrackingUsageDescription` for `ko`, `en`,
  `ja`, `zh-Hans` and `zh-Hant`. `config.xml` copies each folder into the app bundle.
- The text states the actual use: personalized ads and ad measurement, and that declining keeps non-personalized ads.
- The hook writes the `en` text into `App-Info.plist` and fails the build when: the plist has no
  `NSUserTrackingUsageDescription` key to replace, any locale source is missing or empty, or a locale folder is not
  part of the Xcode project. It refreshes the bundled copies from their sources, because `cordova prepare` copies a
  resource folder only when it is new.
- Side effect: iOS treats the app as localized in these five languages, so system dialogs follow the device language.

### R4. Disclosures (AC5)

- Privacy policy sources (ko, en, ja): state that on iOS the advertising identifier is used for personalized ads and ad
  measurement only after the user allows tracking, how to change the choice, and that declining keeps ads non-personalized.
- `store-privacy-review.md`: replace the no-ATT finding; set the Apple "Tracking" answer to yes for the advertising
  identifier and advertising data used by AdMob, pending device evidence.
- `store-policy-evidence.md`, `cordova-store-release.md`, `monetization.md`, `mobile-api.md` and the advertising sequence
  diagram describe the new flow. The runbook lists the AK-owned steps: publish the IDFA message, submit the App Store
  answers, upload the policy pages, device checks.
- The Cordova user manual shows the prompts with real screenshots. This needs the published IDFA message.

### R5. Measurement (AC6)

- For users who opted in to Analytics, the app sets the user property `att_status` (authorized, denied, restricted,
  not_determined, unavailable) on iOS. Nothing is sent without Analytics consent.
- A query reports, per day, app version and `att_status`: active installations, banner requests, load failures,
  impressions, estimated revenue and eCPM.
- Match rate and show rate come from AdMob reports, split by app version and serving restriction (personalized or
  non-personalized), in separate columns. The document states that Analytics counts cover only opted-in users.

## Interfaces

- Plugin action `twAdPrivacyState` on service `emiAdmobPlugin` (iOS only, injected):
  `{att_status: string, personalized: boolean}`.
- `Monetization.setAdTrackingStatus(status)`: stores the allowlisted status and sets the user property when collection
  is enabled, and again after a later opt-in.
- Hook file renamed to `client/scripts/ios-ad-privacy.js`, because it no longer forbids tracking.

## Verification approach

- Node tests: rule for every status and consent case (compiled C), hook output and each drift guard, missing or empty
  purpose string per locale, adapter ready order (fresh, upgraded, consent failure), no ATT request from app code,
  `att_status` allowlist and consent gate.
- Integrated smoke: `cordova prepare ios` and a simulator build of the generated project; inspect the built bundle
  for the five localized strings, the plist text and the compiled rule.
- Device evidence (fresh install: order, single prompt, console lines for allow and decline) needs the published IDFA
  message. Until AK approves that console change, this part is reported as not run.

## Risks and open points

- A published IDFA message also reaches shipped builds that have no purpose string. Their behaviour is unverified.
  Check a 1.1.1 build on a device right after publishing, and unpublish if it misbehaves.
- Whether UMP shows the ATT alert after a refused GDPR message is unverified; App Review has rejected that order in
  informal reports. Check with the EEA debug geography on a device.
- The injected action and rule depend on plugin 3.0.4 source anchors. A plugin update fails the build until reviewed.

## Amendments

- 2026-11-13, during build: R3 changed from "fail when a bundled copy is missing" to "refresh bundled copies and fail
  when a locale folder is not in the Xcode project". Reason: the first real `cordova prepare ios` showed that Cordova
  copies a resource folder only when it is new, so an edited string stayed stale in `platforms/ios`. Acceptance
  criteria are unchanged; the plan's T2 checks follow the amended text.
