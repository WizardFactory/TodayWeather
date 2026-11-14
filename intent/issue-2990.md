# Issue 2990: iOS tracking-permission row and page notice with a Settings shortcut (Cordova)

Owner: AK. Planner: Anthropic / Claude Code root. Source: [issue #2990](https://github.com/WizardFactory/TodayWeather/issues/2990).
Endpoint: pre-merge (verified PR readiness, no merge). AK approved the [plan](../plans/issue-2990.md), set the notice
text and asked for the implementation, the user manual and pre-merge on 2026-11-15.

## Problem

Since iOS 1.1.2 (#2945) the app asks for App Tracking Transparency (ATT) permission once. A user who chose
"Ask App Not to Track" gets non-personalized ads, and the app never shows the choice again. iOS shows the system prompt
once per install, so the app cannot ask again with that prompt.

## Decisions (AK, 2026-11-15)

- Do only the menu row and the page notice of #2990. The AdMob explainer wording and the system prompt wording
  (recommendations 1 and 2 of the 2026-11-15 wording research) are not part of this task.
- The notice at the bottom of the hourly, daily and air pages stays visible until the user switches tracking on in iOS
  Settings. It has no close button and no hide period. This settles the first open decision of #2990.
- Legacy Cordova app only, and iOS only. The native iOS app (#2948) and Android are out of scope.
- The elements are added to the iOS bundle by a build hook, so no shared Cordova source and no Android reference
  changes (plan approved; this replaces the Android recapture that #2990 lists).
- Notice text (Korean, AK): "TodayWeather는 광고 수익으로 운영됩니다. 관심사에 맞는 광고를 원하면 iOS 설정에서 추적을
  허용할 수 있습니다. 기능은 어느 쪽이든 같습니다." Button: "설정 열기". The other locales translate it.

## Outcome and acceptance

An iOS user can see the current tracking choice and reach the iOS Settings page of the app from the menu and from the
three weather pages. Nothing prompts, blocks or rewards.

- AC1: on iOS the menu shows a row with the current choice (allowed or not allowed) below "Ad privacy choices" when the
  ATT status is `authorized` or `denied`. Tapping it opens the app's page in iOS Settings. The row is absent for
  `restricted`, `not_determined` and `unavailable`.
- AC2: on iOS, while the ATT status is `denied`, the hourly, daily and air pages each end with one short text and one
  button that opens the app's page in iOS Settings. The notice cannot be closed, is absent for every other status, is
  page content (no popup, modal or backdrop), and covers neither weather content nor the ad banner.
- AC3: the texts are neutral and exist in ko, en, ja, zh-CN, zh-TW and de: no reward, no urgency, no imitation of the
  system prompt, no button titled "Allow". AK approves the final texts.
- AC4: the change is iOS-only. App code makes no ATT request. No Cordova source that the Android parity references
  track changes, and the Android build contains neither element.
- AC5: the iOS build stops with a named cause when an insertion point or a locale text is missing.
- AC6: an iPhone run shows the row and the notice with tracking off, and neither notice nor a "not allowed" row after
  tracking is switched on. The iOS manual shows both with device screenshots.

## Authority and boundaries

Authorized (AK, 2026-11-15): implementation, tests, smoke checks on a simulator and on the shared iPhone, the user
manual, commits, push, PR creation and updates, CI, independent review and corrections.

Not authorized without a separate approval: edits or comments on #2990, a store release (the change reaches users only
with a new iOS version), App Store Connect changes, merge and any device-wide setting change on AK's iPhone.

Out of scope: the native iOS app, Android, TodayAir, a second ATT prompt, the AdMob explainer text and the purpose string.

## Risks and questions

- App Review: Apple permits a Settings shortcut for users who turned tracking off for the app, and forbids manipulation
  and gating (5.1.1(iv), 5.1.2(i)). A notice on three pages that cannot be closed is the part of this design most likely
  to be read as pressure. AK accepted this on 2026-11-15; the neutral wording and the in-page placement are the mitigation.
- With the device-wide switch "Allow Apps to Request to Track" off, iOS reports `denied` and the app cannot tell this
  from a per-app refusal. The per-app switch may then be missing from the app's Settings page, so the notice could stay
  with no way to remove it from that page. To be probed on a simulator before the texts are final (plan task T0).
- In the EEA an allowed status gives personalized requests only with the stored consent (spec #2945 R2). The notice
  depends on the ATT status alone, so its text must not promise personalized ads.
