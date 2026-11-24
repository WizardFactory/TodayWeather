# Store listing

## Where the listing lives

| Content | Location |
| --- | --- |
| Google Play texts per language (`title`, `short_description`, `full_description`, changelogs) | [`client/fastlane/metadata/android/`](../../client/fastlane/metadata/android) |
| Google Play phone screenshots | `images/phoneScreenshots/` under each language there |
| App Store texts per language (`name`, `subtitle`, `keywords`, `description`, `release_notes`) | [`client/fastlane/metadata/ios/`](../../client/fastlane/metadata/ios) |
| Policy, privacy and support pages linked from the stores | [`client/fastlane/privacy/`](../../client/fastlane/privacy) |
| How texts and images reach the stores | [Store release runbook](../../docs/operations/cordova-store-release.md) |
| Disclosure and policy evidence | [Policy evidence](../../docs/operations/store-policy-evidence.md) |

Those files are the source for listing text. This page records what was observed live and why it changed. Edit listing text there, then add a line to the [GTM log](../log.md).

## Observed live

Public pages only, read on 2026-11-23 (KST).

| Store and storefront | Name or title shown | Version | Rating | Notes |
| --- | --- | --- | --- | --- |
| App Store, Korea | 오늘날씨 - 어제보다 오늘은? | 2.0.1, released 2026-11-21 | 3.98 from 846 ratings | Apple lookup API |
| App Store, United States and Japan | No result | | | The lookup API returned zero results for app ID `1041700694`. Availability in these storefronts is unconfirmed. |
| Google Play, Korea | 오늘날씨 - 미세먼지, 날씨 예보, 비 알림, 미세먼지 | Not read | 3.25 from 831 ratings | Listing page. The title differs from the repository's `ko-KR/title.txt`: the listing update was rejected and resubmitted on 2026-11-23 and was still in review ([#3122](https://github.com/WizardFactory/TodayWeather/issues/3122)). |

## Notes for changes

- Descriptions that present government weather or air-quality information must link to the official sources; Google Play rejected a listing without them on 2026-11-23.
- Google Play validates the whole listing on a commit, including the 30-character title limit, so a screenshot change cannot be sent separately from invalid text.
- Record keyword and screenshot decisions here with the date and the reason, and link the evidence.
