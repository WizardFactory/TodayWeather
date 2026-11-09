# Spec: Android-native TodayWeather app (#2877)

Consumes the [intent](../intent/android-native.md). Requirements authority: #2877 and its sub-issues #2880–#2897 (AN-01..AN-18); this spec records the cross-cutting contracts and how parity is judged, and does not restate each sub-issue.

## Behavior to retain

The native app reproduces the Cordova 1.1.1 app (`client/`, Android build) for users:

- **Parity oracle.** The Cordova source at the PR's base revision, the [Cordova user manual](../docs/user/cordova-app/README.md) and the [rewrite specification](../docs/rewrite/README.md) (older baseline; the manual lists the differences). Where they disagree, the current source wins. S14 (guide) is unreachable in 1.1.1 and is not built.
- **Server.** The legacy server as deployed, without changes. Every request uses path version `v000903` (option A in #2877): `/weather/v000903/coord/{lat},{long}`, `/geocode/v000903/{coord,addr}/…`, `/v000903/kma/addr/…`, `/v000903/nation/KR`, `/v000903/kma/special`, `/v000903/push`, `/v000903/push-list`. Headers match the Cordova app where the server reads them (`Device-Id`, `Accept-Language`).
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
| R7 | An update from the Cordova build keeps places, settings, alarms, push registration and `Device-Id`, and analytics stays off without opt-in. | Emulator upgrade test (AN-03, AN-04), extended by later issues. |

## Exclusions

AN-19 (release), widgets, iOS, the #2651 restyle and server changes.

## Assumptions and risks

- Current Compose libraries require compileSdk 37; the app still targets API 36 as #2877 requires.
- Screenshot comparisons between Compose and WebView renderings need tolerances; each comparison records its tolerance.
- Emulator checks use Google APIs images; physical-device checks belong to AN-14 (alarm delivery) and AN-19.
