# Metrics

First-step scope approved by AK on 2026-11-23. Each figure is stored with the day it covers, that day's timezone and the collection time.

| Metric | Definition | Source | Day boundary | Published |
| --- | --- | --- | --- | --- |
| iOS first-time downloads | Units with product type `1`, `1F`, `1T` or `F1` for Apple identifier `1041700694` | App Store Connect daily sales summary | Pacific Time | The following day. Apple states about 05:00 PT for the Americas and later for other regions. |
| iOS re-downloads and updates | Product types `3`, `3F` and `7`, `7F`, `7T`, `F7`. Stored, not part of "downloads". | Same report | Pacific Time | Same |
| Android installs | Daily user installs from the monthly installs files. Column names are confirmed when a real file is read. | Google Play report bucket | Pacific Time, inferred from Play's statistics help | Within three to seven days |
| Ad earnings | Estimated earnings per day, app and platform | AdMob network report | Account timezone, observed as Asia/Seoul; confirm against the console | Next morning as an estimate; changes for about 48 hours and is final at month end |
| Ad delivery | Impressions, ad requests, match rate, show rate | Same report | Same | Same |
| Rating and rating count | Public average and count per store and storefront | Apple lookup API; Google Play listing | Collection time | Immediate |
| New and changed reviews | Reviews created or edited since the previous run, and those without a developer reply | App Store Connect and Google Play review APIs | Review timestamp | Immediate. Google Play lists only the last week. |

Product type meanings follow Apple's [product type identifiers](https://developer.apple.com/help/app-store-connect/reference/product-type-identifiers). Report timing follows Apple's [availability page](https://developer.apple.com/help/app-store-connect/reference/sales-and-trends-reports-availability), Google's [report export page](https://support.google.com/googleplay/android-developer/answer/6135870) and AdMob's [estimated earnings page](https://support.google.com/admob/answer/10529727).

## Reading rules

- A brief reports the latest complete day per source, with the date. With a 09:00 KST run, Apple's latest day is usually two calendar days back in Korean time.
- The App Store sales report covers every app of the vendor. Filter by Apple identifier.
- AdMob earnings for the last three days are re-collected on every run and replace the stored values.
- A source that fails or is not yet published is recorded as not collected with its reason. A missing record is never a zero.
- Ad statistics other than payment totals are confidential under the AdSense terms and stay private. See [sources](sources.md#what-stays-private).

## Later additions

Not collected yet: uninstalls, crash-free rate, active users, retention, store conversion, competitor and keyword tracking. Analytics consent is off by default, so GA4 undercounts users.
