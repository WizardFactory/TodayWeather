# TodayWeather Google monetization (#2654)

TodayWeather Cordova uses Firebase Analytics/GA4 as its measurement layer, AdMob
as the revenue source and Crashlytics for crash health. Remote Config controls
the existing banner; PostHog remains deferred to [#2655](https://github.com/WizardFactory/TodayWeather/issues/2655).
No new interstitial, purchase or widget flow is introduced.

## Repository behavior and assets

- [Event dictionary](../../client/analytics/events.md): fixed enum/field allowlist, no raw location/identity/error labels, route-screen deduplication.
- [Remote Config parameter fragment](../../client/analytics/remote-config-defaults.json): merge these two parameters into the existing template; never replace an account template wholesale.
- [Experiment specification](../../client/analytics/banner-experiment.json): a draft 0-vs-30-second first-banner-delay experiment, not a deployable Firebase REST payload.
- [Daily monetization query](../../client/analytics/daily-monetization.sql) and [retention query](../../client/analytics/retention.sql): GoogleSQL templates requiring the actual dataset and parameters.

The pinned `cordova-plugin-firebasex-config@2.0.2` shares Firebase SDK versions
with existing modules. Config is fetched once per WebView service lifetime with
a 10-second SDK timeout, one-hour minimum interval and 12-second application
deadline. Activated cache is read before fetch. First show and the once-per-WebView
exposure wait for fetch completion, failure or that deadline; a disabled cache
can hide immediately. Delay is still measured from service creation, so both
experiment arms share the same bounded config wait. Failure retains the valid cache
or local defaults; callbacks after the deadline cannot change policy. Missing
SDK leaves defaults. Invalid pairs are rejected atomically.

| Parameter | Local default | Accepted values | Effect |
| --- | --- | --- | --- |
| `tw_banner_enabled` | `true` | `true`/`false` | Remote kill switch; can only restrict existing SDK/screen eligibility. |
| `tw_banner_delay_seconds` | `0` | integer 0..120 | Earliest banner opportunity since service creation. Guide/start hiding remains authoritative. |

Rollback: end the experiment and restore `true`/`0`; restart/fetch on the client.
Emergency hide: publish `tw_banner_enabled=false`. Offline clients retain their
last activated policy, so remote rollback is not instantaneous. Normal fetch
may be cached for an hour. No claim of a remotely immediate global kill switch.

## Console/account verification

Browser inspection on 2026-10-01 KST identified the TodayWeather Firebase project
and an existing Blaze plan. At initial inspection its Integrations screen showed
Google Analytics disabled and BigQuery linked but exporting no data. These are
dated observations, not evidence that revenue integration already works.

During authorized setup on that date, GA4 was enabled under the existing
TodayWeather Analytics account and native Android/iOS streams were created.
Analytics export was enabled for both streams in the existing BigQuery project
using the console's US region default; daily export was enabled while streaming
and advertising-ID export remained disabled. New export settings do not prove
that daily event tables or monetary values have arrived.
The linked GA4 property's reporting timezone was verified as Korea (GMT+09:00)
and its display currency as USD, matching the query assumptions. Dataset region
and reporting timezone are separate settings.

1. Link the intended GA4 property/account, verify Android/iOS streams against the
   release config, and record property timezone/currency. Do not create a second
   production property accidentally. Confirm existing AdMob app IDs/ad-unit IDs
   map to the same native apps. Do not copy keys into reports or Git.
2. Link each TodayWeather AdMob app to the verified Firebase app. Ensure Analytics
   is enabled; follow the official [automatic revenue integration](https://firebase.google.com/docs/analytics/measure-ad-revenue).
   Do not bridge native paid callbacks to `ad_impression` as a second source.
3. Enable Analytics BigQuery daily export for the intended app streams in the
   existing project/dataset. Confirm region, storage/scan billing and access
   before new provisioning. Verify completed daily tables, not just a linked card.
4. Verify Crashlytics Android/iOS app registrations and release symbols/mapping
   upload. Check crash-free users and sessions separately from Analytics revenue.
5. Merge parameter defaults without altering unrelated parameters/conditions.
   Prepare an inactive Firebase A/B draft, exclude development/test builds and
   verify SDK/device assignment before publishing/starting. Start only after
   baseline data exists.

## Device acceptance

Use test ads for development and never click production ads for verification.
Record app version, platform, stream ID, timestamp and sanitized evidence:

- Android and iOS physical devices: DebugView screen transitions, location
  authorization observations, weather fetch/load outcomes and favorite changes.
- Consecutive same route emits once; navigation away/back emits again. No raw
  address/coordinates/token appears in custom params.
- Analytics collection disabled/consent denied: no delivered custom events,
  weather still usable, ad eligibility follows UMP independently. Restart to
  verify persisted collection settings. Audit native automatic events separately.
- Test crash in a dedicated debug build (SDK `FirebasexCrashlytics.sendCrash`):
  restart and confirm Crashlytics receipt/symbolication. Do not expose a crash
  button in production.
- Offline config startup, invalid config, timed-out callback, guide hide while
  delay is pending, orientation recreation and remote hide/restore all preserve
  screen intent. Validate native layouts on devices.
- Confirm one automatic `ad_impression` per native impression and monetary values
  after AdMob/Firebase linkage. Test ads may yield zero/no eligible revenue;
  production revenue evidence requires real eligible traffic, not fabricated data.
- Rotate twice while a destroy/create callback is pending; recreation stays serialized.
  Native load failure must release the pending callback, and a stale callback must
  not show after disabling ads.
- A/B test devices report native experiment assignment and the applied parameter.
  Exposure is an opportunity diagnostic, not proof of physical impression.

## Metrics and experiment interpretation

Use the GA4 property's `event_date` timezone; the retention query currently
assumes Asia/Seoul for completed-window checks and must be changed if the property
differs. Report revenue in USD through `event_value_in_usd`. Missing revenue
values remain NULL; check value coverage before interpreting eCPM/ARPDAU.
DAU is distinct non-null installation pseudonyms with `is_active_user=true` in
completed daily exports; it is not a person count. Restrict to the intended
app version/streams and exclude known developer installations (both templates
exclude installation pseudonyms carrying `traffic_type=development` or integer
`debug_mode=1`, including their native automatic events). Consent loss,
identity reset/reinstall and filtered samples limit comparison with AdMob.

eCPM = estimated revenue / impressions * 1000. ARPDAU = estimated revenue / DAU.
Reconcile by identical date range, currency, native app, ad unit and reporting
lag against AdMob estimated reports; select a tolerance after baseline analysis.
Final payout is a separate accounting value. Diagnostic banner load counts do
not yield AdMob fill rate because SDK refresh requests are not observed by the
app; use AdMob reports/API for true request/match/show-rate metrics.

Experiment minimums in the draft (14 days/1000 assigned users per variant) are
initial planning thresholds, not a statistical power guarantee. Define the
minimum detectable effect and size using measured baseline variance. Analyze
all assigned active users; do not compare only users who saw ads. Firebase's
estimated-revenue objective is not the custom ARPDAU ratio. Retention/crash
guardrails and rollback take precedence over a revenue improvement.

## Verification commands and remaining gates

```sh
npm --prefix client run test:monetization
node --test client/test/payment-removal.test.cjs
```

Unit/VM checks do not establish native build compatibility, console account
linkage, BigQuery query execution, physical-device receipt or production
experiment assignment. Keep #2654 open until those acceptance gates have real
evidence. Console setup and privacy disclosures are prerequisites for release.

Local verification performed: scoped JS regressions, existing Ionic/Angular
browser smoke with external requests blocked, and an isolated Android debug APK
build and iOS simulator build including the config module. The advertising diagram passed all nine
artifact checks and automated browser containment/theme checks; light/dark
large screenshots were reviewed. No Android physical device was attached.
The console's Android/iOS AdMob Firebase link controls reported insufficient
Firebase permission despite the active user being a Firebase owner and GA4
Administrator. The cause was a Chrome profile mismatch: the inspected AdMob
profile had the Manager role. The separate existing Administrator profile has
the Users tab and enabled Firebase linking controls. The user completed the
final connection clicks for both reviewed TodayWeather apps in the existing
Firebase project. The Administrator console's refreshed list confirmed both
Android and iOS **linked**. The iOS success notice states that AdMob user metrics may take up to 48 hours to
appear. No live event or revenue receipt is implied. No user roles were changed.

AdMob account impression-level ad revenue was enabled and the console reported
that revenue data is being reported. App-specific Firebase links are now
confirmed in the console; eligible event/value receipt remains an end-to-end
verification gate.
Remote Config version 1 contains the published default `true`/`0` pair. The
console also contains an **unpublished** Android version >=1.1.0 experiment draft
with 10% exposure, 0-vs-30-second variants, `ad_policy_exposure` activation,
estimated-ad-revenue objective and 4–7-day retention/crash-free-user secondary
metrics. D1 guardrails are evaluated separately through the cohort query.
The draft must not be published/started until native assignment and monetary
collection are verified; iOS experimentation follows the Android pilot.
No production experiment has been activated. Real revenue/export table checks require actual
eligible traffic after app linkage and release.

Official sources: [Analytics collection settings](https://firebase.google.com/docs/analytics/configure-data-collection),
[Remote Config A/B setup](https://firebase.google.com/docs/ab-testing/abtest-config),
[GA4 export schema](https://support.google.com/analytics/answer/7029846),
[config plugin](https://github.com/dpa99c/cordova-plugin-firebasex-config).

## Files changed for #2654

Existing release, provider-notice, README and signing work was preserved.

| Files | Change |
| --- | --- |
| [workflow](../../.github/workflows/client-offline.yml), [monetization tests](../../client/test/monetization.test.cjs), [payment regression harness](../../client/test/payment-removal.test.cjs) | Run the new scoped suite; provide the new dependency in the existing harness. |
| [package](../../client/package.json), [lock](../../client/package-lock.json), [Cordova config](../../client/config.xml) | Pin Config 2.0.2, add test command/plugin variables, disable native duplicate screen reporting. |
| [index](../../client/www/index.html), [app](../../client/www/js/app.js) | Register/load the new Angular module. |
| [Monetization](../../client/www/js/service.monetization.js), [Util](../../client/www/js/service.util.js), [Firebase facade](../../client/www/js/service.firebase.js) | Whitelist events, preserve native collection/consent enforcement, remove raw-label forwarding to retired UA/Fabric. |
| [TwAds](../../client/www/js/service.twads.js), [emi adapter](../../client/www/js/service.admobemi.js) | Apply bounded cached banner policy and record diagnostic lifecycle without manual revenue. |
| [weather request](../../client/www/js/service.weatherutil.js), [tab controller](../../client/www/js/controller.tabctrl.js), [WeatherInfo](../../client/www/js/service.weatherinfo.js) | Count common HTTP outcomes, parsed tab results and real saved-city changes without location labels. |
| [events](../../client/analytics/events.md), [defaults](../../client/analytics/remote-config-defaults.json), [experiment](../../client/analytics/banner-experiment.json), [daily SQL](../../client/analytics/daily-monetization.sql), [retention SQL](../../client/analytics/retention.sql) | Versioned measurement/operations assets and query templates. |
| [this runbook](monetization.md), [mobile architecture](../architecture/mobile-api.md), [diagram JSON](../architecture/diagrams/cordova-advertising.sequence.json), [generated HTML](../architecture/diagrams/cordova-advertising.html) | Explain contracts, console observations, checks and remaining gates; regenerate through Archify. |

Local-only records: `.planning/.active_plan` and `task_plan.md`, `findings.md`,
`progress.md` in `.planning/2026-10-01-2654-monetization-implementation/`.
Ignored verification artifacts remain in `reports/verification/client/monetization/`
and Archify sidecars; isolated native build inputs/output are under the task's
temporary directory. They are not prerequisites for maintained document links.
