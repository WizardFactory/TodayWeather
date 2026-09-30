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
| `weather_load` | Tab `updateWeatherData` | `outcome=success|network_error|invalid_response`, `duration_ms` | Tab parse/application result. Not a second request counter. |
| `favorite_change` | `WeatherInfo.addCity/removeCity` after persistence invocation | `action=add|remove` | New saved city or removal. Current-position initialization is excluded. Does not certify async persistence completion. |
| `location_permission` | Existing diagnostic authorization check | `outcome=granted|denied|unknown` | Authorization observation, not a count of permission dialogs. No provider/location payload. |
| `ad_lifecycle` | AdMob emi adapter | `action=request|loaded|failed|impression|show|hide|consent_failed`, `ad_format=banner` | Diagnostic lifecycle, never revenue. SDK refresh may create more loaded/impression events than app load requests. |
| `ad_policy_exposure` | TwAds first eligible display opportunity | `delay_seconds` integer 0..120 | Once per WebView lifetime; describes applied local policy. Native Firebase A/B membership is authoritative. |
| `ad_impression` | Firebase/AdMob SDK automatic integration | Native ad platform/source/unit, currency/value where provided | App JS must not manually log this event. Confirm account linkage and value coverage on devices/export. |

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
is applied through the SDK. No ad-consent result is treated as an Analytics grant.

Firebase native event collection and Crashlytics collection settings are still
the existing build defaults. This change does not add a consent UI or infer a
new consent policy. Review the applicable collection settings/disclosures before
release; SDK presence is not privacy validation.
