# Spec: Android-native TodayWeather app (#2877)

Consumes the [intent](../intent/android-native.md). Requirements authority: #2877 and its sub-issues #2880–#2897 (AN-01..AN-18); this spec records the cross-cutting contracts and how parity is judged, and does not restate each sub-issue.

## Behavior to retain

The native app reproduces the Cordova 1.1.1 app (`client/`, Android build) for users:

- **Parity oracle.** The Cordova source at the PR's base revision, the [Cordova user manual](../docs/user/cordova-app/README.md) and the [rewrite specification](../docs/rewrite/README.md) (older baseline; the manual lists the differences). Where they disagree, the current source wins. S14 (guide) is unreachable in 1.1.1 and is not built.
- **Server.** The legacy server as deployed, without changes. Every request uses path version `v000903` (option A in #2877): `/weather/v000903/coord/{lat},{long}`, `/geocode/v000903/{coord,addr}/…`, `/v000903/kma/addr/…`, `/v000903/nation/KR`, `/v000903/kma/special`, `/v000903/push`, `/v000903/push-list`. Headers match the Cordova app where the server reads them (`Device-Id`, `Accept-Language`). Documented exceptions: the Cordova fallback `/weather/v000903/addr/{address}`, which the server does not serve (kept by AN-06; the app handles the failure as Cordova does), and requests outside the legacy server (the weather photo feed `TW_WEATHER_PHOTOS_URL` and its photos, the Places, Firebase and AdMob SDKs).
- **Identity and data.** Package `net.wizardfactory.todayweather`, the same signing certificate (AN-19), `Device-Id` = `ANDROID_ID`, the Cordova SharedPreferences suites as the migration source, the same Firebase project and sender.
- **Anomalies.** Documented Cordova anomalies (docs/rewrite A01–A49) are kept unless the AN-06 decision record fixes them. A01 (late responses) is fixed: a response applies to the place that requested it.

## Cross-cutting requirements

| ID | Requirement | Verification |
| --- | --- | --- |
| R1 | The Android build never reads `client/`. Imported files carry provenance (source path, last commit, hashes). | CI job without `client/`; import re-run produces no diff; unit test checks provenance hashes. |
| R2 | Domain logic and models are plain Kotlin/JVM modules without Android types. | Module plugins (`kotlin.jvm`) and compilation. |
| R3 | No private inputs in Git, docs or logs; the build and unit tests run without them. | CI builds without private inputs; artifact checker; review. |
| R4 | No production writes in tests; push writes go to test doubles. | Test code review; request recording in tests. |
| R5 | No test, mock or dry-run modes in the app; doubles are injected by test code. | Review. |
| R6 | Parity is shown per screen against the manual and Cordova captures within recorded tolerances. | Screenshot tests (AN-05 onward) and the AN-18 checklist. |
| R7 | An update from the Cordova build keeps places, settings, alarms, push registration and `Device-Id`, and analytics stays off without opt-in. *Amended 2026-11-24 (AK, analytics default-on): a Cordova opt-in still does not carry over; without a stored native choice, usage analytics follows the [region rule](analytics-default-on.md) (on by default outside the EEA, the United Kingdom and Switzerland; off there and for an unknown region until the user allows it).* | Emulator upgrade test (AN-03, AN-04), extended by later issues; since 2026-11-24 run in the opt-in region DE (`analyticsRegion`), with the region rule covered by `AnalyticsDefaultTest` and `AnalyticsTest`. |
| R8 | Every request the native client makes uses a path the legacy server serves under `v000903`, or a documented exception. | The AN-18 request-path test against a route table generated from `server/`. |

## Exclusions

AN-19 (release), widgets, iOS, the #2651 restyle and server changes are outside the original parity baseline.

## Native home-screen widgets (#3048)

The [widget extension](https://github.com/WizardFactory/TodayWeather/issues/3048) adds four picker entries to the TodayWeather app: current conditions, forecast, clock and weather, and air quality. Each instance follows the app selection or pins an enabled place. Resizing adapts the content; instance settings select daily or hourly forecasts and yesterday comparisons.

For [city clocks](https://github.com/WizardFactory/TodayWeather/issues/3062), show the selected place’s local time and calendar date, including midnight and daylight-saving changes while offline. Use the handset’s 12/24-hour preference. A missing overseas time zone shows a dash until the next ordinary update. Domestic KMA readings use Asia/Seoul. The weather retrieval stamp uses handset time.

Regular forecast cards enlarge the hour or day, temperature and weather artwork by about 20 percent. Compact cards retain a layout that fits the available height, including the 50 dp single-row form.

Each placement defaults to automatic hourly refresh, including widgets added before refresh settings were introduced. Manual mode shows a refresh control next to the last successful retrieval time. Tapping the widget body opens the main app at its place. When no weather is available yet, an eligible manual widget can still request its first reading.

All widget types and modes on a device share one weather request budget per place. A widget can send one request when both the last widget attempt and the last successful cached retrieval are at least an hour old. Recording the attempt before sending protects against repeated taps, failures and process restarts. A failed attempt leaves the last reading and its timestamp on screen. Main-app requests retain their own refresh policy.

A foreground visit to the main activity enables all widgets for the next 120 hours. A missing visit, a visit in the future, or an age of 120 hours or more requires the user to open the app. The prompt replaces cached weather and air readings. Configuration, background startup and widget refresh do not renew access. A scheduled redraw works offline; Android can defer its delivery during idle periods. A subsequent main-app visit renews all installed widgets. The new providers have different component names from the historical Cordova providers; users of those versions may need to add their widgets again.

## Assumptions and risks

- Current Compose libraries require compileSdk 37; the app still targets API 36 as #2877 requires.
- Screenshot comparisons between Compose and WebView renderings need tolerances; each comparison records its tolerance.
- Emulator checks use Google APIs images; physical-device checks belong to AN-14 (alarm delivery) and AN-19.
