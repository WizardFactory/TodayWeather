# TodayWeather measurement contract v1

Only the allowlist in `service.monetization.js` is emitted. Custom events carry
`measurement_version=1` and `traffic_type=development|production`. Development
means debug mode or Google test-ad-unit configuration. Firebase native automatic
events do not carry these custom fields; exclude developer installations/builds
in downstream queries, not just individual custom events.

| Event | Producer | Parameters | Meaning |
| --- | --- | --- | --- |
| `screen_view` | Ionic state change via `Util.ga.trackView` | `screen_name` fixed route, `screen_class=Cordova` | Consecutive same-route calls deduplicated; returning counts again. Native Activity/ViewController automatic reporting disabled. |
| `weather_fetch` | `WeatherUtil.getWeatherByGeoInfo` | `outcome=success|network_error|invalid_input`, `duration_ms` | One logical request result, after existing retries. Success is HTTP completion, not parser correctness. Startup/search/tab consumers share it. |
| `weather_load` | Tab `updateWeatherData` | `outcome=success|network_error|invalid_response`, `duration_ms` | Tab parse/application result; local input errors are invalid_response, HTTP rejections are network_error. Not a second request counter. |
| `favorite_change` | `WeatherInfo.addCity/removeCity` after persistence invocation | `action=add|remove` | New saved city or removal. Current-position initialization is excluded. Does not certify async persistence completion. |
| `location_permission` | Existing diagnostic authorization check | `outcome=granted|denied|unknown` | Authorization observation, not a count of permission dialogs. No provider/location payload. |
| `ad_lifecycle` | AdMob emi adapter; the native 2.x apps' ad code | `action=request|loaded|failed|impression|show|hide|consent_failed`, `ad_format=banner` (native apps also `native`, `interstitial`, and `consent` with `consent_failed` only) | Diagnostic lifecycle, never revenue. `impression` is logged from the SDK impression callback and is the impression count in the BigQuery queries. SDK refresh may create more loaded/impression events than app load requests. |
| `ad_load_error` | AdMob emi adapter, native banner load failure | `ad_format=banner`, `error_code` integer 0..999 | The Google Mobile Ads error code only (for example no fill or network). Native messages, response IDs and ad unit IDs are dropped. Failures without a numeric code still count as `ad_lifecycle action=failed`. Every failure also writes a structured console line with the code, independent of Analytics consent. |
| `ad_policy_exposure` | TwAds first eligible display opportunity | `delay_seconds` integer 0..120 | Once per WebView lifetime after bounded config completion; before the delay expires if eligible. Describes retained/fetched local policy. Native Firebase A/B membership is authoritative. |
| `ad_impression` | Firebase/AdMob SDK automatic integration | Ad platform/source/unit; no value or currency with the default integration | App code must not log this event. GA4 does not export it to BigQuery; use it in DebugView to confirm AdMob linkage only. Revenue comes from the AdMob report ([measurement sources](../../docs/operations/monetization.md#measurement-sources)). |

User property `att_status` (iOS, #2945): `authorized|denied|restricted|not_determined|unavailable`, the App Tracking
Transparency status read after the consent flow. It is set through `Monetization.setAdTrackingStatus` only while
Analytics collection is enabled, and again after a later opt-in. It carries no identifier. Exported events, including
`ad_lifecycle`, carry it, so [ios-att-monetization.sql](ios-att-monetization.sql) can split impressions by status.

Durations are integer milliseconds in 0..600000. Unknown parameters, event names,
enum values and invalid durations are rejected/dropped. No precise coordinates,
address/city labels, raw errors, URLs, tokens, device UUIDs or user IDs are sent
by the custom bridge. Legacy UA/Fabric arbitrary-label methods remain inert.

Analytics availability does not gate weather or ads. The bridge retains only the
latest fixed screen name until platform readiness and drops other pre-ready
events. Native Firebase SDK collection/consent owns actual delivery, including
persisted opt-outs. The FirebaseX query API reads unset wrapper preferences as
false even when native collection defaults are on; it is not used as a second
collection gate and collection is never forced on during initialization.
`Monetization.setCollectionEnabled(false)` (also
`Util.ga.setOptOut(true)`) stops custom emissions immediately; native persistence
is applied through the SDK, including an explicit request made before SDK readiness.
An asynchronous opt-in replays only the latest allowlisted screen after its matching
SDK callback succeeds; stale callbacks cannot reopen the JS gate. No ad-consent result is treated as an Analytics grant.

Firebase native event collection and Crashlytics collection settings are still
the existing build defaults. This change does not add a consent UI or infer a
new consent policy. Review the applicable collection settings/disclosures before
release; SDK presence is not privacy validation.
