# TodayWeather 1.1.0 privacy review

This is a release review, not a published declaration. The original review inspected the Cordova release workspace on 2026-10-01. Source reconciliation on 2026-10-03 used committed revision `e0b126c8f5c0872ae03c4e82f1d381feac3cbf52`, including the #2654 measurement integration and the three-language terms/privacy/support drafts. This revision is not a signed final release candidate. TodayAir, the PWA and older store binaries are outside this candidate's scope. AK confirmed operator/contact and optional consent choices on 2026-10-01. Retention enforcement, international-processing details and final device/network evidence remain release gates before submitting answers. Use the [release evidence map](store-policy-evidence.md) to match policy sections, code and unresolved store answers.

The [privacy draft](../../client/fastlane/privacy/privacy.html) and [support draft](../../client/fastlane/privacy/support.html) assume a TodayWeather-specific document. Their visible review notices prevent treating these review pages as approved store policy documents. They have no scripts, analytics, embedded credentials or form submission. AK selected the existing todayweather.ai landing S3/CloudFront; [privacy](https://todayweather.ai/mobile/privacy.html) and [support](https://todayweather.ai/mobile/support.html) were uploaded as public review drafts on 2026-10-01. HTTPS bodies matched source hashes and browser navigation rendered correctly. The pages remain drafts until the operating details and controls are finalized. The old shared company policy is not the source of retention promises for this version.

## Observed data flows

| Data | Candidate evidence | Draft disclosure / purpose |
| --- | --- | --- |
| Device position, selected city/address and searches | [WeatherUtil](../../client/www/js/service.weatherutil.js) sends coordinates/address in weather/geocode paths. GPS positions are rounded to three decimals; searched locations can retain greater precision. | Location and search-related data for weather/geocoding. Three-decimal GPS still meets Apple's precise-location definition. Do not describe requests as anonymous or ephemeral without log/cache evidence. |
| Notification token, device UUID, city coordinates/name, settings/language | [Push](../../client/www/js/service.push.js) `_makePostObj` binds these in one payload. Mongo [push](../../server/models/modelPush.js) and [alert](../../server/models/alert.push.model.js) models have no TTL. Optional [SQLite](../../server/lib/pushStore/sqlite.js) and [S3 coordinator registry](../../server/lib/pushCoordinator/registry.js) also require review against the actual deployed store. | Device identifiers and location for notification functionality. Device linkage exists even without an account. Disabling a setting, deleting a registration and uninstalling are different operations. An S3 setting removal persists the device document; it does not prove erasure of the endpoint, UUID or object versions. |
| Screen, weather-load/fetch outcome, saved-city action, permission outcome, banner interaction | [Monetization](../../client/www/js/service.monetization.js) accepts bounded fixed fields; [Util](../../client/www/js/service.util.js) drops old raw labels/UUID forwarding. | Product interaction/performance for analytics. Native SDK installation/device/session information remains separate from the custom-event whitelist. |
| Ad interactions, approximate IP-derived location, identifiers, SDK diagnostics | [AdMob bridge](../../client/www/js/service.admobemi.js) uses UMP and retains the release ad gate on consent failures. Google describes automatic SDK collection/sharing. | Third-party advertising, analytics and fraud prevention. Do not declare “no data shared” merely because the app has no account or uses limited ads. |
| Crashes/device and installation information | [Package configuration](../../client/package.json) enables Firebase Crashlytics. | Crash/diagnostic data for app stability; actual delivery and retention settings still require account/device verification. |
| Installation and configuration information | Firebase Messaging auto-init and Remote Config are enabled; [Monetization](../../client/www/js/service.monetization.js) fetches two banner settings. | Identifiers/configuration metadata for notifications and app functionality. A configuration fetch is not an anonymous local setting. |
| Support email and diagnostic attachment | [Util.sendMail](../../client/www/js/service.util.js) opens a user-controlled email draft containing app version, device UUID and user agent. | Contact/support data if sent. The user can edit the draft. Verify the real inbox and deletion process before publishing support commitments. |

Weather/geocoding can be served through AWS and forwarded to provider services. Exact active fallback providers, processor status, international-transfer details and log retention need deployment/account evidence. See [existing source inventory](../rewrite/security-and-privacy-inventory.md#3-personal-and-device-data); its legacy UA/Fabric/receipt claims do not describe the new candidate. Fabric and app purchases are removed from the maintained client.

## Candidate configuration findings

- AK approved **주식회사 플라잉**, privacy contact **김동환 / 제품팀**, and **todayweather@wizardfactory.net**. General audience, not specifically children-directed; documents limited to KO/EN/JA for Cordova TodayWeather.
- Analytics native defaults and all four consent categories start disabled/denied. `Monetization` reads only the dedicated `twAnalyticsConsentV1` explicit choice, never treating prior SDK defaults as consent. The settings menu offers optional Allow and Decline/withdraw; malformed/missing choices remain off. JS events stop immediately on withdrawal, and native consent/collection updates guard stale callbacks. Advertising storage/user data/personalization remain denied even after analytics consent. Historical events are not automatically purged by withdrawal.
- FirebaseX2.0.2 install variables do not write iOS collection/consent Info.plist defaults. `config.xml` explicitly supplies them. Verify the built plist, not only package options. Existing SDK runtime preferences can override defaults on upgrades; validate the currently published app's upgrade path on physical devices before asserting absence of pre-JS traffic.
- Android requests disabled Analytics/ad-ID collection; inspect the final merged `AD_ID` permission and actual AdMob processing independently. Denied Analytics is not a claim that Ads, Crashlytics, Messaging or Remote Config collect no data.
- iOS selects Core Analytics, disables Analytics IDFV/ad-network registration and requests no ATT. The guarded `ios-no-tracking.js` prepare hook removes unused GTM from the generated Analytics package (it otherwise pulls IdentitySupport back in) and enforces nonpersonalized AdMob requests plus publisher first-party-ID off. A GTM container or unsupported plugin request/dependency anchor fails the build. This is current source/build intent, not a whole-app tracking certification; final archive/network/SDK manifest review remains required.
- App privacy manifest now marks location/device ID linked because push associates coordinates with UUID/token. SDK manifests remain separate evidence and must be reconciled for final declarations.
- No universal schema TTL exists. Source-only tracing also found 60-day cleanup for selected alarms in a send pipeline; it does not establish deployed cleanup for all alarm/alert records, optional SQLite/S3 storage or logs. See the [retention/deletion controls](store-data-retention.md). No customer record deletion or retention setting was applied in this phase.
- Raw notification logging remains a release gap: [client Push](../../client/www/js/service.push.js) logs registration objects and lists, and [batch registration route](../../server/routes/v000902/route.push.update.list.js) logs tokens and complete bodies. The custom Analytics whitelist does not redact these logs. The support email draft still includes UUID/user agent; minimizing that prefill remains separate from allowing the user to edit it.
- Existing AWS evidence includes HTTP origin hops. Current all-data transport encryption is not yet verified; client HTTPS/Google TLS does not establish every hop.

## Store answer worksheet

These are candidate selections, not submitted answers. Collection includes SDK behavior, and Apple/Play taxonomies differ.

| Field | Candidate answer | Outstanding confirmation |
| --- | --- | --- |
| Collect user data | Yes | Final SDK/version and traffic check |
| Precise location | Collected for weather/geocoding and optional notification features | Apple linked: yes for notification records. Play exact precise/coarse mapping and optionality must cover each actual flow. |
| Approximate location | Include IP-derived SDK advertising location | Exact SDK/settings and purposes |
| Device/other identifiers | Collected for notifications, configuration, analytics and advertising | Final Android AD_ID permission; iOS IDFV/IDFA/ATT and SDK tracking behavior |
| Product interactions / advertising data | Collected; advertising SDK sharing included | UMP choices, analytics consent and actual account integrations |
| Crash/performance diagnostics | Collected by enabled SDKs | Final archive privacy report and account retention |
| Support contact/content | Review optional-disclosure criteria before selection | Final inbox and support process; no in-app account registration |
| Linked to user (Apple) | Include data associated with device identifiers; lack of login is insufficient | Final per-data-type treatment |
| Tracking (Apple) | Unresolved | Choose and verify SDK configuration/consent before selecting yes/no |
| Shared (Play) | AdMob sharing must be included | Assess service-provider exceptions per recipient instead of applying them to every SDK |
| Ephemeral-only location | Not established | URL logs, caches and stored push coordinates prevent a blanket assertion |
| All data encrypted in transit | Not verified | Recheck every user-data network hop |
| Deletion request supported | Pending operating process | Confirm mailbox, identity matching, provider deletion and response handling |
| Account creation | No current weather-app account flow found | Correct old App Review `demoAccountRequired=true` in the next version |

Age-rating draft: advertising is present; no chat/social-network/user-generated-content feature was found in the inspected weather flow. Air-quality health guidance exists, so review the health/wellness question explicitly. New null fields are unanswered, not “No.” Do not automatically reuse the old rating.

## Decisions and remaining publication gates

AK answered all operator/contact/consent/scope questions on2026-10-01. The app changes and KO/EN/JA privacy/terms/support documents implement those directions; review banners remain because operating retention, recipient/country details, secure deletion verification and physical-device evidence are incomplete. The [retention runbook](store-data-retention.md) contains the operating limits, evidence gates and mailbox procedure. These choices do not approve guessed store declarations.

On 2026-10-03 AK named 김동환 as final document approver and policy/store-disclosure
maintenance owner, and confirmed the proposed Analytics 2-month, BigQuery 90-day,
resolved support 1-year and completed deletion-audit 1-year limits. The 90-day
server-log limit was already confirmed. Actual settings and cleanup still need
verification; do not remove review banners or claim final-text approval from these decisions.

- Verify actual consent grant/refusal/withdrawal/restart on native devices and the upgrade path; inspect compiled manifests/plists and SDK request behavior.
- Apply and verify actual retention/expiry and secure device ownership verification before final document promises.
- Finalize processing roles/countries/legal bases and any category-specific preservation exceptions.
- Confirm final privacy/support/terms pages and effective date, then review Play Data safety/Apple privacy/age answers. Play screenshot commit currently refuses missing Data safety; repeat only after that declaration exists.

## Official references

- [Apple privacy definitions and device linkage](https://developer.apple.com/app-store/app-privacy-details/): three-decimal location is precise; device-linked data can be linked to a user even without an account.
- [Google Play Data safety definitions](https://support.google.com/googleplay/android-developer/answer/10787469): disclose SDK and pseudonymous collection; classify sharing and transient processing separately.
- [AdMob Android disclosure](https://developers.google.com/admob/android/privacy/play-data-disclosure) and [iOS disclosure](https://developers.google.com/admob/ios/privacy/data-disclosure): SDK collection includes ad interactions, identifiers, diagnostics and IP-derived location. The current Android guide describes25.5.0; our configuration pins25.3.0, so verify the actual candidate rather than claiming exact runtime equivalence.
- [Firebase privacy](https://firebase.google.com/support/privacy): Messaging/Remote Config/Crashlytics process installation data; location and retention vary by service.
- [Analytics collection and advertising controls](https://firebase.google.com/docs/analytics/ios/configure-data-collection): collection and advertising uses have separate controls; persisted SDK choices must be respected.
