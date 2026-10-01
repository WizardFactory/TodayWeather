# TodayWeather retention and deletion proposal (#2660)

AK confirmed on 2026-10-01 that no documented retention periods exist. The operator is **주식회사 플라잉**, privacy contact **김동환 / 제품팀**, confirmed support/deletion inbox **todayweather@wizardfactory.net**. Scope: Cordova TodayWeather Android/iOS, general audience; TodayAir/PWA excluded. These are proposed operational limits, not an assertion that cleanup is deployed.

## Proposed limits and acceptance evidence

| Data | Proposed limit | Required implementation/evidence |
| --- | --- | --- |
| Saved cities, preferences, Analytics choice | On-device until user removal/reset/uninstall | Verify storage migration and withdrawal/restart; cloud-backup restoration may retain old app data |
| Weather/geocode request/access/error logs | 30 days from creation | Inventory CloudFront/API Gateway/Lambda/EC2/application logs and backups; configure expiry/rotation; avoid logging full coordinates/UUID/token |
| Notification registrations | While service remains enabled; delete on verified request or user unregister; remove invalid tokens | Trace both alarms and alerts plus SQLite/Mongo deployment; prove exact-key deletion and no later worker re-creation. Do not equate app inactivity with non-use of notifications |
| Firebase Analytics event/user-level retention | 2 months | Read/write actual GA4 property settings and disable reset-on-new-activity where appropriate; Google aggregate reporting differs from event/user-level retention |
| BigQuery analytics event exports | 90 days from event date | Partition/table expiration, existing-table policy, views/copies/materializations/backups; test age boundaries and export lag |
| Support correspondence | 1 year after resolution | Confirm inbox owner, closure date, mail/attachment cleanup and mailbox backups; delete unnecessary device diagnostics earlier |
| Crashlytics/FCM/Remote Config/AdMob data | Actual service-specific retention | Confirm provider-controlled durations and deletion mechanisms; do not apply the GA4 period to all Firebase services |
| Deletion audit | 1 year after completion, proposed | Store case ID, category/outcome/date and authorized role only; omit raw location, UUID, push token and original payload |

Any documented statutory preservation exception needs its exact record category, legal basis, duration and restricted access; do not invent a blanket retention exemption. Effective date follows actual configuration and verified cleanup, not draft creation date.

## Existing-source limitations

[Push controller](../../server/controllers/controllerPush.js) `_removeOldList` removes **selected alarm rows** whose `updatedAt` predates60days during its send pipeline; missing dates are updated. The [schemas](../../server/models/modelPush.js) and [alert schema](../../server/models/alert.push.model.js) do not define a universal TTL. This code is neither a30day log limit nor a verified production-wide deletion job. Verify selection/startup wiring and the deployed store; no cleanup or test may run against production based on this source-only observation. Existing removal selectors are not proof of secure requester identity.

## Deletion intake procedure

1. Product team receives mail at the confirmed inbox. Acknowledge and identify the requested categories; request only information required to locate and verify the relevant registration. Do not request government ID, account passwords or a raw push token by email.
2. Lack of an account does not remove the need for verification. A device UUID is a lookup value, **not authentication**. Prefer a challenge confirmed from the still-installed app/device against its registration; define a safe manual fallback for lost/uninstalled devices before promising deletion of any supplied UUID.
3. Authorized operator performs a dry run showing bounded matching categories/counts, not payloads. Resolve both alarm/alert records and worker state, then delete only verified rows. User permission changes/uninstall alone do not erase server registrations. Prevent retry/refresh workers from recreating withdrawn records.
4. Handle related diagnostic/analytics requests according to each provider's deletion APIs and identifiers actually available. Do not claim a device UUID can locate a Firebase app-instance ID; user-level analytics consent withdrawal stops future collection and is not a guaranteed purge of earlier server data.
5. Check retention exceptions/backups and expiry; document remaining restricted records and the actual deletion result. The completion response must distinguish deleted, absent, provider-controlled and retained categories.
6. Maintain a restricted minimal audit trail. Do not send mail automatically from the app/agent. Run synthetic isolated-record checks for wrong-device/no-match/duplicate/worker-retry cases before enabling an operational deletion tool.

## Release gates

- [ ] Inventory actual logs, stores, provider processing countries/roles and retention settings.
- [ ] Apply approved limits and verify expiry on synthetic data without deleting customer records.
- [ ] Implement secure device ownership verification and operator deletion tooling; validate both current and legacy notification registrations.
- [ ] Confirm backup/copy handling and support mailbox cleanup.
- [ ] Replace proposed-period language in all3policy translations only after the above evidence exists.
- [ ] Review final binary network/SDK behavior, then submit accurate Play/Apple declarations and retry Play screenshots.

References: [PIPC2026.4 drafting guide](https://pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=D010030020&nttId=12018), [Firebase privacy](https://firebase.google.com/support/privacy), [GA4 retention](https://support.google.com/analytics/answer/7667196). Periods above are a product proposal; they are not mandated by those sources.
