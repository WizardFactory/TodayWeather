# Scheduled alarm preparation retry (#2677)
Owner: AK. Builder: Claude Sonnet 5.5 (Anthropic). Source: [issue 2677](https://github.com/WizardFactory/TodayWeather/issues/2677).
AK requested implementation through pre-merge on 2026-10-04. This authorizes scoped code/tests/docs, commits, push, PR, CI and independent review/correction using configured accounts. Merge, auto-merge, queue entry, production actions, client updates, store migration and coordinator restarts remain excluded.

On 2026-10-02 11:20 UTC the coordinator's weather requests to the service's own `/v000902/kma/` returned 13 HTTP 200 and 46 HTTP 499 (all cancelled at 5 s). A rejected weather fetch ends alarm preparation as terminal `failed/preparation` with no retry, although nearly all of the five-minute campaign deadline remains. `engine.js` also discards the dispatcher's error and attempt counts.

- AC1: A transient weather timeout followed by recovery submits each still-eligible scheduled alarm to FCM exactly once before its deadline; shared weather requests and preparation concurrency stay bounded.
- AC2: Persistent preparation failure ends at the configured attempt/deadline bound. A disabled or changed registration and an ambiguous FCM send are not resent.
- AC3: Campaign readback distinguishes preparation failure from FCM rejection with safe stage/reason and separate preparation/transport attempt counts; a regression proves tokens, credentials, locations and provider payloads are excluded.

Out of scope: proving the origin latency cause in production (cohort evidence only; AK's device is unmatched), blanket timeout increase, client, store layout migration, deployment. Production verification (affected campaign readback and controlled iOS receipt, separately from FCM acceptance) needs separate deployment authorization.
