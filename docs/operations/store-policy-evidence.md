# TodayWeather policy and disclosure evidence (#2660)

Source review: 2026-10-03, revision `e0b126c8f5c0872ae03c4e82f1d381feac3cbf52`.
Scope: Cordova TodayWeather Android/iOS 1.1.0; widgets/purchases removed, AdMob retained.
This is a review handoff, not approval, a submitted declaration or a final-binary receipt.
The [privacy worksheet](store-privacy-review.md), [retention procedure](store-data-retention.md)
and [release runbook](cordova-store-release.md) remain the maintained operating sources.

## Reconciled decisions and document control

Issue intake predates several completed preparations. Operator **주식회사 플라잉**,
privacy contact **김동환 / 제품팀**, inbox **todayweather@wizardfactory.net**, optional
default-off Analytics with withdrawal, separate ad choices and KO/EN/JA documents
were recorded in the [2026-10-01 decision log](https://github.com/WizardFactory/TodayWeather/issues/2660#issuecomment-5925373802).
The operator confirmed 90-day server request/error logs on 2026-10-02; the
[source update](https://github.com/WizardFactory/TodayWeather/issues/2660#issuecomment-5946365764)
does not establish operational expiry. Do not ask for these decisions again.

All nine document sources are committed: [privacy](../../client/fastlane/privacy/privacy.html),
[terms](../../client/fastlane/privacy/terms.html), [support](../../client/fastlane/privacy/support.html)
and their `.en.html`/`.ja.html` translations. Prior issue receipts record publication
under `https://todayweather.ai/mobile/`; current remote bodies require fresh readback.
They remain review drafts. The visible 2026-10-01 draft date is neither an effective
date nor a policy version. Before finalization, record the document version, effective
date, translation parity and revision history. On 2026-10-03 AK named **김동환** as
the final document approver and policy/store-disclosure maintenance owner. The same
decision confirmed 2-month Analytics event/user-level retention, 90-day BigQuery events,
1-year resolved support correspondence and 1-year completed deletion audits. Settings,
cleanup and expiry verification remain outstanding; this is not final-text approval.
Mailbox reachability/access and secure deletion matching still need operational checks.

Material changes require an updated revision history, policy/support notice and any
necessary in-app notice. Choose the notice and acceptance requirements during final
terms review; no weather-lookup consent wall is authorized by this worksheet.
Standard platform EULA versus custom terms, supported markets/ages, governing law
and dispute clauses remain unresolved. Provider agreements/permissions remain tracked
as a deferred deployment gate; deferral is not approval. Do not accept agreements.

## Paragraph-to-evidence map

Numbered sections align across KO/EN/JA drafts. Store classifications are review
topics, not a payload ready to submit. Every final answer needs its own purpose,
sharing/recipient, optionality, retention and candidate evidence.

| Draft sections | Repository evidence | Store review and missing evidence |
| --- | --- | --- |
| Privacy 1/11; terms 1/7; support 1 | Recorded operator/contact; [package](../../client/package.json) | Reconcile actual store operator, audience and app access; verify 김동환’s final approval and actual mailbox handling. |
| Privacy 2; terms 2/3/5; support 4 | [WeatherUtil](../../client/www/js/service.weatherutil.js), [API flow](../architecture/mobile-api.md) | Precise/coarse location and searches, purpose/optionality; active providers, request logs, retention, source/image rights and each network hop. Manual city lookup must work with GPS denied. Verify data-error/delay cautions and official safety guidance against provider notices. |
| Terms 2/3; support 4 | [release runbook](cordova-store-release.md), [purchase-removal checks](../../client/test/payment-removal.test.cjs) | The 1.1.0 scope excludes widgets and in-app purchases. Confirm removal in the final binary and reconcile screenshots, listings and document claims; source checks alone do not verify the signed release. |
| Privacy 3/9/10; support 2 | [client registration](../../client/www/js/service.push.js), [notification architecture](../architecture/push-notifications.md), [S3 registry](../../server/lib/pushCoordinator/registry.js) | Device-linked location/identifiers, FCM recipients and optionality; deployed Mongo/SQLite/S3 store, verified requester matching, full erasure and retry/restart behavior. |
| Privacy 4; terms 4; support 3 | [Monetization](../../client/www/js/service.monetization.js), [consent tests](../../client/test/privacy-consent.test.cjs), [native defaults](../../client/config.xml) | Optional product interactions and SDK sessions/installations; final compiled defaults, upgrade durability, consent denial/withdrawal/offline and actual network traffic. JS tests use synthetic bridges. |
| Privacy 5; terms 2/4 | [AdMob adapter](../../client/www/js/service.admobemi.js), [iOS hook](../../client/scripts/ios-no-tracking.js), [dependency pins](../../client/package.json) | Ads, identifiers, approximate IP location, interactions/diagnostics and sharing; final Android AD_ID, UMP behavior, iOS ATT/IDFA/IDFV and aggregate SDK privacy report. No ATT prompt does not prove no tracking. |
| Privacy 6/8/10 | [Firebase plugins](../../client/package.json), [retention runbook](store-data-retention.md) | Diagnostics/configuration/installation data are separate from Analytics consent; provider retention/settings, countries, processing roles and contractual evidence. |
| Privacy 7/9; support 1/2 | [email draft](../../client/www/js/service.util.js) `sendMail` | Optional contact/content/attachments; actual mail handling, identity verification, backups and deletion. User-editable UUID/UA prefill is not minimization. |
| Privacy 10; terms 6/7 | [retention controls](store-data-retention.md), nine draft sources | Logs, Analytics, BigQuery, support and audit periods are operator-confirmed; enforcement remains unverified. Verify actual settings, boundary checks, provider durations and backup handling. Record effective date only after accepted evidence. |

Native SDK collection must be reviewed alongside custom events. Apple device linkage
and Play sharing exceptions require separate per-category answers. Official definitions:
[Apple](https://developer.apple.com/app-store/app-privacy-details/),
[Play](https://support.google.com/googleplay/android-developer/answer/10787469),
[Firebase](https://firebase.google.com/support/privacy). Consult current official
guides and actual integrated SDK versions when preparing the payload.

## Remaining implementation gaps

- Client Push logs registration objects/lists. The reused v000902
  [batch route](../../server/routes/v000902/route.push.update.list.js) logs tokens and
  full bodies. Inventory/redact client, route, worker and error logs together; whitelist
  bounded outcomes/counts rather than stringify payloads or exception/request objects.
- S3 setting removal rewrites a device document containing endpoint/UUID metadata.
  There is no object-delete method in the [storage adapter](../../server/lib/pushCoordinator/storage.js).
  Do not promise complete deletion based on a successful setting DELETE. Test coordinated
  removal, persistence, restart and old object versions before operational use.
- No secure ownership challenge/operator deletion tool or whole-stack retention receipt
  was established by this reconciliation. UUID/token possession is not sufficient
  authorization for an email requester. Do not expose arbitrary device deletion.

## Final-candidate scenarios and receipts

Prerequisite for every scenario: freeze Git revision, signed Android AAB/iOS archive
hashes, app/build versions, SDK versions and relevant account configuration. Use a
controlled test device and synthetic records; retain sanitized counts/outcomes, never
raw tokens, coordinates, support mail or credentials in public evidence.

| ID / user goal | Ordered actions and expected outcome | Failure path / evidence |
| --- | --- | --- |
| P01 / weather user avoids optional collection | Clean install, deny GPS and Analytics, manually search a city, reopen. Weather works; Analytics remains denied; check native state and traffic. | Repeat offline and with missing SDK bridge. Review other SDK traffic separately; a successful weather response alone is insufficient. |
| P02 / user grants then withdraws Analytics | Grant in settings, observe permitted bounded event, withdraw, restart, repeat after upgrade from published app. Collection stops and choice persists; no unconsented replay. | Exercise delayed native callback, storage failure and offline restart. Capture pre-JS behavior and compiled defaults on both OSes. Local JS tests do not close this scenario. |
| P03 / user changes advertising choice | Open ad privacy choices where required, deny/withdraw, restart, verify allowed ad behavior and persisted UMP state. | Form unavailable/SDK failure/offline retains safe ad gate. Record device region/debug setup, effective request flags and permitted network traffic; Analytics grant must not grant ad categories. |
| P04 / user removes notification data | Create alarm and alert on controlled device, verify request identity, dry-run exact matches, remove only intended records; restart coordinator/worker and reopen as appropriate. | Wrong device/no match/duplicate/retry must not remove unrelated data. Distinguish setting removal, disabling and full device erasure; verify every active/legacy store, S3 versions and re-registration semantics. |
| P05 / operator enforces retention | Inventory each logging layer and approved SDK/mail/export period; check synthetic records immediately before/at/after expiry and backup restoration. | Configuration missing or data preserved beyond period blocks final retention claims. Record actual settings, observation time, tested age boundary and exceptions without customer data. |
| P06 / reviewer checks release disclosures | Match final documents and store payloads to binary/network receipts, all locales, no-login review access, age-rating answers and widget-free screenshot sets. | Unknown tracking, all-hop encryption, unanswered rating field or unresolved deletion blocks affected answers; never substitute a guess. Preserve reviewed payload hash and approval. |
| P07 / publisher verifies approved documents | After explicit approval, upload only intended mobile objects, read HTTPS bodies/links in all languages, compare source hashes and landing-root baseline; verify authorized rollback/update. | Draft markers, broken links, wrong cache body or root drift stop finalization. Store URLs require readback in every applicable locale; publication does not authorize store submission. |

Local source checks can be rerun without starting collection:

```sh
node --test client/test/privacy-consent.test.cjs client/test/monetization.test.cjs
git diff --check
python3 scripts/check-artifact-policy.py --staged
```

The staged checker only covers the actual index. Run it again after staging intended
files and check actual outgoing commits before push. These commands do not certify
physical-device behavior, retention enforcement, legal approval or store acceptance.

## Local reconciliation verification — 2026-10-03

- The two Node test files above passed **41/41** tests on the reviewed source. These
  tests use isolated JavaScript/native bridge fixtures and do not exercise real SDK traffic.
- Checked **50 relative Markdown targets** across this document, the privacy worksheet
  and retention procedure; all existed. Checked all **nine** draft HTML pages for local
  links, retained review notices and absence of script/iframe/form elements. No HTML
  source was changed, so existing visual receipts are historical, not renewed here.
  A final follow-up link check covering all four affected documents passed 61 targets.
- `git diff --check` passed. `python3 scripts/check-artifact-policy.py --staged` passed
  on the existing index; no changes were staged, so that result does not attest these
  unstaged edits. Relative-link checks above cover the new documentation directly.
- No app/server code, runtime setting, customer record, website object or store field
  was changed. Final signed builds, physical devices, mailbox/account/deployment
  evidence, policy approval and PR review were not exercised in this local preparation.
