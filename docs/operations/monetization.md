# TodayWeather Google monetization (#2654)

TodayWeather Cordova uses Firebase Analytics/GA4 as its measurement layer, AdMob
as the revenue source and Crashlytics for crash health. Remote Config controls
the existing banner; PostHog remains deferred to [#2655](https://github.com/WizardFactory/TodayWeather/issues/2655).
No new interstitial, purchase or widget flow is introduced.

AK decided on 2026-11-26 that no new Cordova build will be released on any store, including a fallback or rollback build. Cordova-specific steps below (banner policy, experiments, the #2871 store-release step) apply only to installed 1.x versions. Remote Config changes still reach those installed builds; code changes reach users only through the native apps.

## Repository behavior and assets

- [Event dictionary](../../client/analytics/events.md): fixed enum/field allowlist, no raw location/identity/error labels, route-screen deduplication.
- [Remote Config parameter fragment](../../client/analytics/remote-config-defaults.json): merge these two parameters into the existing template; never replace an account template wholesale.
- [Experiment specification](../../client/analytics/banner-experiment.json): a draft 0-vs-30-second first-banner-delay experiment, not a deployable Firebase REST payload.
- [Daily monetization query](../../client/analytics/daily-monetization.sql) and [retention query](../../client/analytics/retention.sql): GoogleSQL templates requiring the actual dataset and parameters. The daily query counts impressions, not revenue; see [measurement sources](#measurement-sources).

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

### Native apps (Android and iOS 2.0.x)

The native apps read the same pair plus per-format switches (#3041, #3059, #3211). Remote Config applies at app open from the stored activated values, then after the fetch; iOS also activates published changes to the format switches and `tw_banner_enabled` in an open app (Realtime API), and applies them from a fetch that answers after the 12-second deadline; the delay stays as it was at the deadline.

| Parameter | Local default | Accepted values | Effect in the native apps |
| --- | --- | --- | --- |
| `tw_banner_enabled` | `true` | `true`/`false` (whole pair) | Every ad format off when `false` (native card, interstitial, anchored banner). iOS builds from #3061 to before #3216 apply it to no format; Cordova clients apply it to their banner. |
| `tw_banner_delay_seconds` | `0` | integer 0..120 (whole pair) | Android: every format waits this long after the app opened. iOS: the anchored banner only. |
| `tw_app_banner_enabled` | `false` | `true`/`false`; anything but `true` is off | The anchored adaptive banner under the tab bar (#3211). |
| `tw_native_enabled` | `true` | `true`/`false`; anything but `true` is off | The in-content native card. |
| `tw_interstitial_enabled` | `true` | `true`/`false`; anything but `true` is off | The forecast interstitial. |
| `tw_interstitial_chance` | `30` | integer 0..100 (ASCII digits); anything else uses `30` | Chance in percent that an eligible repeat Hourly/Daily transition shows the forecast interstitial (#3213); `0` never, `100` every eligible transition, still at most one display per day. Each draw reads the current value: Android from the activated values at opening and from a fetch that answers after the 12-second deadline; iOS also from published changes in an open app (Realtime API). A chance-only change does not restart ad loading. |

The apps do not arbitrate between the banner and the native card: both `true` shows both. A release build needs the banner's ad unit (`TW_ADMOB_BANNER_ANDROID`, `TW_ADMOB_BANNER_IOS`, private inputs) for the banner switch to serve.

On Android, UMP consent starts as soon as the tabs open (after the start page), while the Google Mobile Ads SDK start (`MobileAds.initialize`, traced as `ads.startSdk`) is deferred until after the activity's first content draw, a 1-second minimum delay (not waiting for user input), and a main-thread idle point (capped at 3 seconds total after the first content draw, even if the post-frame delay runs late) so `WebViewChromium.init` does not block early post-launch interactions (#3234). `tw_banner_delay_seconds` is still measured from app open, and consent, native-card, interstitial and analytics rules are unchanged; because the SDK becomes ready later, more first visits to a tab can finish without a preloaded native card (`specs/android-native-slot-reach.md`).

The native-card builds released before #3216 (merge `c460c76c5`) have no banner and do not read `tw_app_banner_enabled`. These are Android 2.0.0 and 2.0.1, and the iOS builds from #3061 (merge `39385687a`, which removed the early banner) up to but excluding `c460c76c5`. They still read `tw_native_enabled`, so `false` published to every user leaves them without any in-content ad. To serve the banner instead of the native card:

1. Identify the banner-capable release of each app by an identifier the older builds do not share. Firebase conditions evaluate the app version and the build number, one condition per Android or iOS app. `master` at `c460c76c5` still carries Android `2.0.1`/`200010`, the same as the store release, so the banner-capable Android release needs a new `versionCode` (Firebase's build number), and usually a new version name as well. For iOS, take the version and build from the release record, because the archive step sets them. If no identifier separates the builds, keep the native card until such a release ships.
2. Publish `tw_app_banner_enabled=true` and `tw_native_enabled=false` as conditional values under that condition only. Keep the defaults (`false` and `true`) for everyone else.
3. Roll back the switch on the same condition. Either remove both conditional values, or publish `tw_app_banner_enabled=false` and `tw_native_enabled=true` under it. Changing only the default, or only the banner value, leaves the conditional native-off value in force.

Keep the condition and the defaults while the banner is served. Removing the condition reverts the banner-capable builds to the defaults, the native card, so it is a rollback. Publishing `tw_native_enabled=false` as the default turns the card off in every older build still in use, which have no banner to replace it. That is a separate decision to give up in-content ads in those builds, not a cleanup step.

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
- Confirm one `ad_lifecycle` `impression` per SDK impression for each ad format.
  The automatic `ad_impression` in DebugView confirms AdMob/Firebase linkage only;
  it never reaches BigQuery. Test ads may yield zero/no eligible revenue;
  production revenue evidence requires real eligible traffic, not fabricated data.
- Rotate twice while a destroy/create callback is pending; recreation stays serialized.
  Native load failure must release the pending callback, and a stale callback must
  not show after disabling ads. AdMob banner requests retain five-second spacing
  in JS; the native silent-return interval is disabled so every issued load can
  settle by event/error. Removing a banner cancels any scheduled load.
- A/B test devices report native experiment assignment and the applied parameter.
  Exposure is an opportunity diagnostic, not proof of physical impression.

## Metrics and experiment interpretation

### Measurement sources

GA4 does not export the automatic AdMob `ad_impression` event to BigQuery, and the
default integration passes no value or currency with it
([GA4 automatically collected events](https://support.google.com/analytics/answer/9234069)).
A BigQuery query over `ad_impression` therefore returns no rows and no revenue even
when AdMob reports impressions and earnings. Each number has one source:

| Number | Source | Split by |
| --- | --- | --- |
| Estimated earnings, impression RPM (eCPM) | AdMob report or API | Date, platform, ad format (`FORMAT`) |
| Requests, matched requests, impressions, match rate, show rate | AdMob report or API | Date, platform, format, app version (`APP_VERSION_NAME`) |
| Impressions per reporting installation | [daily query](../../client/analytics/daily-monetization.sql) over the apps' `ad_lifecycle` `impression` events | Date, platform, version group (`cordova` = 1.x, `native` = 2.0+, `other` = older or missing), format |
| Next-day return rate | Same daily query | Date, platform, version group (not format) |

The `ad_lifecycle` events come from the Mobile Ads SDK impression callbacks and
are exported because the apps log them. They cover only installations with
Analytics collection on (an opt-in, or the native apps' region default since
#2660), so their totals are lower than AdMob's; use them for
per-installation rates, not totals. Do not use show rate (impressions/matched)
as an engagement metric: it depends on how many ads an app preloads, not only on
what users see. Placement and frequency decisions use impressions per reporting
installation with the next-day return rate as the guardrail.

Use the GA4 property's `event_date` timezone; the retention and daily queries
assume Asia/Seoul for completed-window checks and must be changed if the property
differs. Active installations are distinct non-null installation pseudonyms with
`is_active_user=true` in completed daily exports; they are not a person count.
Rates divide by reporting installations: active installations that sent at least
one event carrying `measurement_version` that day (any value type; iOS Cordova
stores it as a double). Automatic events also come from installations that can
never report `ad_lifecycle`: Cordova builds before 1.1 (on 2026-11-14..25 most
of the Cordova actives, Android 1.0.8 and iOS 1.0.10) and sessions without the
apps' measurement events. Counting them would understate impressions per
installation. `active_installations` stays in the output for context.
The next-day return rate is the share of a day's reporting installations active
again the next day on the same platform, with any event; it stays NULL until the next day's export table
exists (read from the dataset's `INFORMATION_SCHEMA.TABLES`, so the query needs
metadata read access) and that day has ended. Late events can still raise it, so rerun the last
three days. A return counts in either version group, so an update from 1.x
to 2.x counts as a return when the installation pseudonym survives it (not
verified on devices). Exclude known developer installations (the templates
exclude installation pseudonyms carrying `traffic_type=development` or integer
`debug_mode=1`, including their native automatic events). Consent loss,
identity reset/reinstall and filtered samples limit comparison with AdMob.

eCPM and ARPDAU come from AdMob earnings, not from BigQuery: ARPDAU = AdMob
estimated earnings / Firebase active users for the same date range and platform.
Reconcile by identical date range, timezone, currency, app and ad unit; AdMob
estimated earnings are not the final payout. Diagnostic banner load counts do
not yield AdMob fill rate because SDK refresh requests are not observed by the
app; use AdMob reports/API for true request/match/show-rate metrics.

Experiment minimums in the draft (14 days/1000 assigned users per variant) are
initial planning thresholds, not a statistical power guarantee. Define the
minimum detectable effect and size using measured baseline variance. Analyze
all assigned active users; do not compare only users who saw ads. Firebase's
estimated-revenue objective is not the custom ARPDAU ratio. Retention/crash
guardrails and rollback take precedence over a revenue improvement.

## AdMob eligibility recovery (#2871)

The [2026-11-07 evidence](../evidence/tasks/issue-2871/README.md) records the fixed client
defects: an endless location spinner after a permission denial, and an Android first
session without an Ads SDK start. It also records the unchanged configuration (iOS
`npa=1`, Android `AD_ID`). The developer website and `app-ads.txt` are in the
[store runbook](cordova-store-release.md#developer-website-and-app-adstxt). Do not
claim restoration until each AK step below is recorded in #2871:

1. No further Cordova release carries these fixes: AK decided on 2026-11-26 that no Cordova build is released on any store (2026-11-26).
   Installed builds keep the behaviour they shipped with, and users move to the native
   apps. Older builds keep both defects. iOS 1.0.10 (GMA 7.49.0 per the #2871 AdMob report) stays on a deprecated SDK until users update.
2. Confirm app-ads.txt authorization for both apps in AdMob.
3. In the AdMob Policy center, request a review for each weather app's "Site Behavior:
   Navigation" restriction for the apps as published now (native 2.0.x)
   ([AdMob help](https://support.google.com/admob/answer/10448709)). Record the
   request date and the outcome. A pending or rejected review keeps #2871 open.
4. Report before/after cohorts with an explicit date range and timezone, app version,
   GMA SDK, ad unit, country and consent mode. Keep match rate (matched/requests)
   separate from show rate (impressions/matched). Put policy and authorization status
   in their own columns, not in client metrics. `ad_load_error` codes from consenting
   Analytics users show the client-side no-fill/network mix; they are not fill rate.

## iOS App Tracking Transparency measurement (#2945)

The app asks for ATT through UMP from the release that contains #2945. Report its effect with two sources and keep
them in separate tables.

1. **AdMob report (authoritative for requests, match rate, show rate and eCPM).** Filter platform iOS and the weather
   app. Dimensions: date, app version (`APP_VERSION_NAME`) and serving restriction (`SERVING_RESTRICTION`). Metrics: ad
   requests, matched requests, match rate, show rate, impressions and impression RPM (eCPM), as defined by the
   [AdMob report API](https://developers.google.com/admob/api/reference/rest/v1/accounts.networkReport/generate).
   AdMob has no ATT status dimension, and serving restriction is not ATT status. Personalized rows come only from
   users who allowed tracking. Non-personalized rows mix every other ATT status with users who allowed tracking but
   whose stored consent does not permit personalization (where GDPR applies). The personalized share is therefore a
   lower bound of the ATT allow rate; take the status mix from the Analytics query below. Keep match rate
   (matched/requests) and show rate (impressions/matched) in separate columns.
2. **Analytics query (ATT status detail).** [ios-att-monetization.sql](../../client/analytics/ios-att-monetization.sql)
   groups iOS active and reporting installations, initial banner requests, load failures, `ad_lifecycle` impressions per
   format and impressions per reporting installation by date, app version and the `att_status` user property. It covers only
   installations with Analytics collection on (an opt-in, or the native apps' region default since #2660), so use it
   for the status mix and per-status impressions, not for totals.
   It cannot give revenue, eCPM, match rate or show rate (see [measurement sources](#measurement-sources)).

Before/after comparison: use the last full 14 days of the previous iOS version and the first full 14 days after the ATT
release reaches most active users, same weekdays, same countries, same ad unit. State the date range and timezone, app
versions, GMA SDK version and the consent-message state (IDFA message published or not). Report the share of
personalized requests next to match rate and eCPM, and do not label it as the ATT allow rate. The device console line
`{"component":"admob","operation":"request_policy",...}` shows the status and request mode of one installation.

## Verification commands and remaining gates

```sh
npm --prefix client run test:monetization
node --test client/test/payment-removal.test.cjs client/test/provider-notice.test.cjs
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

## Usage analytics on by default (2026-11-24, #2660)

AK decided on 2026-11-24 to turn usage analytics on by default in the native apps, with these rules (cross-platform contract: `specs/analytics-default-on.md`, added by PR #3178):

- Outside the EEA, the United Kingdom and Switzerland, a device without a stored choice collects by default. In those regions, and when the device region is unknown, collection still needs the user's consent.
- A stored choice wins: an earlier decline or withdrawal stays off. Applying the default writes no choice.
- Analytics storage is granted only while collecting; ad storage, ad user data and ad personalization stay denied.
- The menu row is "이용 통계" / "Usage analytics" / "利用状況分析" with on/off status.
- AK, 2026-11-24: EU territories with their own ISO codes (GF, GP, MQ, RE, YT, MF, AX) count as EEA. A decline kept only in Cordova WebView storage, or a withdrawal made in a Cordova fallback build, is not carried over: those users get the region default, with no new consent prompt. The opt-in consent popup is shown in every app language (no English fallback).
- AK approved the privacy, terms and support wording on 2026-11-24 (#3188). Publish the pages together with the first app release that has this behavior, not before.
- A withdrawal that cannot be saved keeps collection off for that session and shows the save-failed notice; if it still cannot be persisted, the region default can apply at the next start (accepted residual).

The privacy, terms and support pages state the same rules. Before a release with this behavior ships: publish the updated pages, update the Play Data safety answers (analytics data is collected by default outside the opt-in regions, with an opt-out) and re-check the App Store privacy answers. The section below records the earlier opt-in behavior, which still applies in the opt-in regions.

## Optional Analytics choice (2026-10-01, #2660)

Usage analytics now starts off in native defaults and the JavaScript gate. The app settings menu persists an explicit consent choice and offers withdrawal; earlier unconsented screen/events are not replayed on a new grant. Analytics storage can be granted while ad storage, ad-user-data and ad-personalization remain denied. UMP continues to gate ads separately; turning Analytics off does not turn Ads/Crashlytics/FCM/Remote Config off. Event metrics and automatic ad revenue are available only where consent/SDK configuration actually permits measurement. Preserve this boundary in any experiment; Remote Config cannot enable analytics consent. See [privacy review](store-privacy-review.md) and [retention/deletion](store-data-retention.md).

### Consent write failure and restart behavior (PR #2662)

Analytics grants originate from the settings choice. The compatibility opt-out
facade only withdraws. Native collection/consent writes are serialized, including
failure compensation; the latest pending choice runs after the active callback.
A delayed grant cannot race a newer denial. Grant failures attempt collection off
and all consent modes denied, then report failure without raw SDK errors.

WebView persistence is read back; write failures attempt removal of a stale grant.
Startup restores a stored grant only if the native persisted collection flag is
also true (Android returns 1). False, absent or failed native reads require fresh
explicit consent. The installed FirebaseX 2.0.2 setters persist this flag before
acknowledging, so a successful native withdrawal protects restart even if WebView
writes and removal fail. If both persistence mechanisms fail, durable withdrawal
is unverified and settings asks the user to retry. No historical data deletion is
implied. Tests assert native state across restart, deferred consent/enable ordering,
failed grants, latest-choice behavior and settings grant/refusal/dismissal.

Android source defaults remain the pinned plugin variables; repeating plugin
manifest entries is unnecessary. Final merged manifest and signed-device/upgrade
network checks remain required release evidence, independently of these JS tests.
