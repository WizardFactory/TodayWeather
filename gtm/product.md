# Product context

Agents read this before writing listing text, replies, briefs or analyses. It states facts with their source; it is not marketing copy.

## Product

| Item | Value |
| --- | --- |
| Name | TodayWeather (Korean: 오늘날씨) |
| App Store | App ID `1041700694`, bundle `net.wizardfactory.todayweather` |
| Google Play | Package `net.wizardfactory.todayweather` |
| Web | `https://todayweather.ai` (landing and policies), `https://app.todayweather.ai` (web app) |
| Revenue | AdMob advertising. No purchases. See [monetization](../docs/operations/monetization.md). |
| Clients | Native iOS and Android apps, and the web app. See the [product lifecycle](../docs/architecture/service-overview.md#product-lifecycle). |

## What users come for

The [store voice research](../docs/evidence/research/landing-store-voice-2026-11-21.md) (Korean storefronts, retrieved 2026-11-21) found these needs in written reviews:

- Deciding what to wear by comparing today's temperature with yesterday's at the same hour.
- Reading the hourly chart quickly, with today and yesterday as two series.
- Seeing the current temperature within today's range in the daily view.
- Checking the weather from the home screen with a widget.

Its sample is Korean reviewers only, and most reviews predate the native apps. Do not extend it to other countries without new evidence.

## Markets

- Listing languages in the repository: Korean, English, Japanese, German and Chinese for Google Play; Korean, English, Japanese and Chinese for the App Store. See [store listing](listing/README.md).
- The [focus cities](../docs/operations/mobile-focus-cities.md) and the [market comparison](../docs/evidence/research/mobile-markets-2026-11-20/README.md) describe the 21 target countries. That comparison uses no TodayWeather usage or revenue data.

## Limits on what may be published

- Download counts, ad statistics, review bodies and account identifiers stay out of this repository. See [sources](sources.md).
- Reviewer names are not stored anywhere by GTM tools.
