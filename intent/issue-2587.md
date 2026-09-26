# Intent: Daily KMA weather without sunrise, sunset or UV — issue 2587

Revision 1, 2026-09-26. Owner: main agent for AK. Source: issue [#2587](https://github.com/WizardFactory/TodayWeather/issues/2587) and AK ("이슈 SDLC에 따라 진행, 다른 provider model을 통한 리뷰는 skip, 필요하면 이슈에 댓글 작성").

## Problem

All 17 `midData.dailyData` rows of the Seoul v000903 coordinate response lack `sunrise`, `sunset`, `ultrv` and `ultrvStr`; Gangneung, Gwangju, Daegu and Busan behave the same. The apps and web cannot show sunrise, sunset or UV, day/night icons fall back to 07:00/18:00 and the current UV summary never appears.

- Sunrise/sunset: request time reads only the `kasiRiseSet` collection, filled by the `/gather/gatherKasiRiseSet` job. The job stops at the first failing area, and the deployed service host had replaced the `normal` data.go.kr key with `test_normal` under an "expired key" comment ([reconciliation](../docs/architecture/gather-source-reconciliation.md)). Gangneung, the first area in the list, is also missing, which matches a job-wide stop.
- UV: the collector calls `203.247.66.146/iros/RetrieveLifeIndexService`, which now answers 307 → `/503.html`. `LivingWthrIdxServiceV3`/`V4` are retired (`NO_OPENAPI_SERVICE_ERROR`); `LivingWthrIdxServiceV5/getUVIdxV5` exists.

Service log reading over SSH was denied in this session (production read). The key-expiry cause is therefore inferred from repository evidence, not confirmed from logs.

## Desired outcome and acceptance criteria

- AC1: `GET /weather/v000903/coord/37.567,126.978` returns `sunrise` and `sunset` as `YYYY.MM.DD HH:MM` on every `midData.dailyData` row, including when the KASI store has no row for a date.
- AC2: Locally computed times match KASI reference values within ±1 minute (Seoul 2017-06-16 05:10/19:55, 2024-12-21 07:43/17:17), independent of host time zone.
- AC3: The KASI gather tries the next configured data.go.kr key on an authorization failure and continues with the remaining areas when one area fails. Error messages do not contain the service key.
- AC4: The UV collector requests `getUVIdxV5` for all areas with a `time` slot, pages through `totalCount`, falls back to earlier slots on no data, and stores daily `ultrv` per area. An offline test parses a V5-format fixture into `ultrv` and `ultrvGrade` for the requested area.
- AC5: When the rise/set store or UV provider fails, the route still returns 200 and the other daily fields are unchanged (offline route smoke, DB 1.0 and 2.0).
- AC6: `test:offline`, existing RSS/air/daily smokes and the new tests pass on Node 16.20.2 and 22.22.2.
- AC7 (post-deployment, human-owned): during UV publication hours the Seoul response has `ultrv` and `ultrvStr` on today's row. This needs the gather host deployed with a data.go.kr key approved for `LivingWthrIdxServiceV5`.

## Scope

In scope: `getRiseSetInfo` error handling and computed fallback, KASI gather key fallback and per-area continuation, UV collection via V5, offline tests and smoke, CI registration, architecture docs, issue comment.

Out of scope: food-poisoning index `fsn` (V5 has no equivalent; unchanged), UV offer-month gating, Gwangju 501 at `35.160,126.851`, world weather, client/widget changes, key issuance or approval, deployment.

## Constraints

Node 16.20.2 runtime; `DB_DATA_VERSION` 1.0 and 2.0; existing `lifeIndexKma2` and `kasiRiseSet` schemas; no provider/DB access in tests; no secrets in code, logs, docs or commits.

## Authority and endpoint

Endpoint pre-merge. Covered: implementation, tests, commits, push to the `ak-ongyeol/TodayWeather` fork, PR to `WizardFactory/TodayWeather` `master`, CI reading, issue comment. Excluded: merge, deployment, production reads/writes, key changes. AK decision: skip the other-provider review.

## Risks and open questions

- The actual KASI failure is unconfirmed without logs. The computed fallback makes sunrise/sunset independent of it; the key fallback only helps if `test_normal` is valid.
- Which data.go.kr account has V5 approval is unknown; the collector tries every configured key.
- V5 publication slots are not documented in the repository; the slot fallback covers both two-per-day and three-hourly publication.

## Consumers

Spec, plan, builder, verifier, PR description, issue comment.
