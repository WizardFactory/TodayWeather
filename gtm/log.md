# GTM log

Dated events that explain changes in downloads, earnings, ratings or reviews. Newest first. One line per event: what changed, on which store or channel, and the evidence. Dates are KST unless stated.

| Date | Area | Event | Evidence |
| --- | --- | --- | --- |
| 2026-11-24 | Release | Google Play: version 2.0.1 (200010) published to production and open testing at 13:39 KST after managed publishing had held it. App Store: version 2.0.2 approved; phased release started 10:48 KST. | Play Console publishing overview; App Store Connect API |
| 2026-11-24 | Listing | Six reordered Google Play full descriptions published. | Play Console publishing overview |
| 2026-11-24 | Attribution | Audit: no store link used campaign values; GA4 had no web stream and no campaign events in 28 days; Google Ads campaigns paused, with the iOS Firebase conversion misconfigured because GA4 is not linked to Ads. | [Sources](sources.md#campaign-links) |
| 2026-11-24 | Access | Google Play report files became readable by the service account. | [Sources](sources.md) |
| 2026-11-23 | Access | AdMob API enabled and read-only reporting consent given; App Store key `tw_gtm_sales_reports` issued; Google Play service account granted read-only bulk report access; private bucket `todayweather-gtm` and its collector user created. | [Sources](sources.md) |
| 2026-11-23 | Listing | App Store Korea showed version 2.0.1 with a 3.98 average from 846 ratings; Google Play Korea showed a 3.25 average from 831 ratings. First recorded values; no change can be derived yet. | [Store listing](listing/README.md) |
| 2026-11-23 | Listing | Google Play rejected the 2026-11-22 listing update under the Misleading Claims policy: government information without a link to its source. Every description now lists the official source links, and the listing was resubmitted for review. | [#3122](https://github.com/WizardFactory/TodayWeather/issues/3122) |
| 2026-11-22 | Listing | Google Play listing texts and phone screenshots were sent for review (#3122). | [Store listing](listing/README.md) |
| 2026-11-21 | Release | App Store release date of version 2.0.1, as reported by Apple's lookup API. Its release notes announce the iOS widget. | [Store voice research](../docs/evidence/research/landing-store-voice-2026-11-21.md) |

Add an entry whenever a release ships, a listing or screenshot set changes, an experiment starts or ends, a provider or store incident affects users, or report access changes.
