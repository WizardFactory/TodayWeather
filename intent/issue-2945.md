# Issue 2945: App Tracking Transparency for personalized AdMob requests on iOS

Owner: AK. Builder: Anthropic / Claude Code root. Source: [issue #2945](https://github.com/WizardFactory/TodayWeather/issues/2945).
Endpoint: pre-merge (verified PR readiness, no merge), selected by AK on 2026-11-13.

## Problem

The iOS app never asks for App Tracking Transparency (ATT) permission. A build hook removes the purpose string and forces
`npa=1` on every AdMob request, so all iOS requests are non-personalized. In the 7 days to 2026-11-13 AdMob reported
219 iOS impressions for US$0.02 against 2.19k Android impressions for US$3.50.

## Decisions (AK, 2026-11-13)

Recorded in [#2660](https://github.com/WizardFactory/TodayWeather/issues/2660#issuecomment-6841327261).

- Introduce ATT on iOS. Disclosed purpose: personalized advertising and ad measurement through AdMob, nothing else.
- Use the AdMob Privacy & messaging IDFA explainer before the system prompt. The GDPR message stays first.
- Firebase Analytics may not use IDFA. It keeps the Core variant with IDFV and ad-network registration off, and the
  GTM/IdentitySupport removal. Analytics consent stays a separate choice.
- Android is unchanged.

## Outcome and acceptance

Users who allow tracking get personalized ad requests. Every other user keeps today's behaviour.

- AC1: #2660 records AK's decision with the approved purpose, the explainer choice and the Analytics limit.
- AC2: on iOS the consent steps run in this order: GDPR message (where it applies), IDFA explainer or system ATT prompt,
  then the first ad request. The app never raises the ATT prompt itself, so the prompt appears at most once per install.
- AC3: each ad request is personalized only when ATT is authorized and the stored consent allows personalization.
  Denied, restricted, not determined and unavailable keep `npa=1` and the publisher first-party ID off. The hook's
  drift guards remain. The app writes the ATT status and the request mode to the device console.
- AC4: `NSUserTrackingUsageDescription` describes the actual use in ko, en, ja, zh-Hans and zh-Hant, and the iOS build
  fails when the string is missing for any of them.
- AC5: the privacy policy sources, `docs/operations/store-privacy-review.md`, `store-policy-evidence.md`, the release
  runbook and the user manual describe the shipped tracking behaviour, including the App Store "Data Used to Track You"
  answers to submit.
- AC6: the #2654 measurement reports iOS match rate, show rate, impressions and eCPM split by ATT status and app
  version, with match rate kept separate from show rate.

## Authority and boundaries

Authorized (AK, 2026-11-13): implementation, tests, smoke checks, commits, push, PR creation and updates, CI, independent
review and corrections, and comments on #2660 and #2945. Evidence may move among the configured Claude, Codex, Grok and
Antigravity accounts.

Not authorized without a separate approval: publishing the AdMob IDFA message, changing App Store Connect answers,
uploading pages to todayweather.ai, store submission, release, merge, auto-merge and any permission change.

Out of scope: Android, TodayAir, the PWA, Analytics consent design, the post-release before/after report and App Review.
Those issue criteria stay open after this PR, so the PR must not close #2945.

Coordinated issues: #2660 (privacy and disclosures), #2654 (measurement), #2871 (AdMob eligibility), #2605 (release).

## Risks and questions

- Device evidence for AC2 and AC3 needs the real IDFA message published in the AdMob console. That is AK-approved work.
- The effect of a published IDFA message on shipped builds without the purpose string is not verified.
- Informal reports describe App Review rejections when the ATT alert follows a refused GDPR message. Check on a device.
- Adding localized `InfoPlist.strings` makes iOS treat the app as localized in five languages, which also changes the
  language of system permission dialogs.
