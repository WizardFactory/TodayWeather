# Intent: KMA warnings from WthrWrnInfoService and zone-coded town warnings — issue 2609

Revision 1, 2026-09-27. Owner: main agent for AK. Source: issue [#2609](https://github.com/WizardFactory/TodayWeather/issues/2609), including its Decisions section, and AK: "6. 바뀔 때만 호출하되, 예정 시간보다 빠르게 혹은 늦게 나올 수 있으니 고려 / 7, 8, 9 okay / 이제 진행 그리고 client/www를 통해서 최종 end에서 제대로 표기 되는지까지 필히 확인 / 다른 provider 리뷰는 skip".

## Problem

The warning scraper requests `www.weather.go.kr/weather/warning/status.jsp`, which now redirects to the redesigned site; the parser finds none of its selectors, so `KmaSpecialWeatherSituation` stopped receiving documents. `/v000903/kma/special` (app screen S12, web) and `current.specialInfo` (summary text of every v000903 KMA response) serve stale warnings. Town matching scans national text for hard-coded zone names that KMA has since renamed (Jeju 2026-09-26), and the parser has no codes for 열대야 or 중대경보, while 폭풍해일/지진해일 are unreachable.

## Desired outcome and acceptance criteria

- AC1: A recorded `getPwnStatus` + `getWthrWrnMsg` pair stores one type 1 document: `situationList` codes from `t6` (폭풍해일 → 7), `comment` = `other`, additive `bulletin` = `t1`–`t4`.
- AC2: Recorded `getWthrPwn`, `getWthrInfo`, `getWthrBrkNews` store type 2 (`pwn`, `rem`), type 3 (`t1`) and type 4 (`ann`) documents.
- AC3: `tmFc` `202609271000` is served by `/v000903/kma/special` as `announcement` `2026-09-27T01:00:00.000Z` under `TZ=UTC` (and independent of host time zone).
- AC4: A second run on the same responses returns `'skip'`, calls neither `getWthrWrnMsg` nor `getPwnCd`, and adds no document. Per AK decision 6, a change in `getPwnStatus` is detected on the next poll regardless of schedule; when `getWthrWrnMsg` or `getPwnCd` does not yet reflect it, the announcement stays unprocessed and is retried on later cycles; `getPwnCd` windows overlap and resync hourly.
- AC5: A recorded `getPwnCd` sequence (issue, change-issue with higher stress, release, cancelled event, per-type release, duplicate boundary rows, unordered pages) yields the expected persisted active state.
- AC6: With 호우경보 active on `L1091430` (서귀포시동부), a 서귀포시 town gets `{weather: 3, level: 2, levelStr: '경보', locationName: '서귀포시동부'}`; a 제주시 town does not.
- AC7: Active 열대야주의보 (`warnVar 13`) and a `warnStress 2` 호우 event give `{weather: 13, weatherStr: '열대야', level: 1}` and `{weather: 3, level: 4, levelStr: '중대경보'}`.
- AC8: `t6: "o 없 음"` with an empty active state yields no `current.specialInfo`.
- AC9: HTTP 403 code 30, code 22, `resultCode 99` and `NODATA` responses leave documents and state unchanged, with no immediate retry.
- AC10: `server/lib/kmaScraper.js` no longer references `weather/warning/status.jsp`.
- AC11: One live collector run with the configured key completes for all four types and the active state; the PR records date, active zone count and the `t6` comparison, without the key.
- AC12 (AK): Served through the real route from a real database, `client/www` shows the new warnings: the S12 screen (`#/kma-special`) renders all four types with the new texts, and the main forecast summary shows the town warning (for example `호우경보`).

## Scope

In scope: WthrWrnInfoService requester and collector replacing the scraper path, zone-state model and replay, zone table data file and town mapping, model code fixes, controller changes (`getCurrent` bulletin/comment, `getSpecialInfo`), offline tests, Mongo smoke, `client/www` browser E2E, CI registration, architecture/rewrite docs and Archify diagram.

Out of scope: 읍면동-level sub-zone mapping (decision 8), app/widget/web rendering changes (the `bulletin` field is not rendered), the flash visibility window, #2604 key rotation for forecast products, key issuance, deployment.

## Constraints

Node 16.20.2 runtime (see amendment for the service host); mongoose 5.1.2; `DB_DATA_VERSION` 1.0/2.0 unaffected (warning collections are unversioned); `/kma/special` wire shape and `Cache-Control` unchanged except the additive `bulletin`; `getSpecialInfo` output shape unchanged; no provider or production database access in automated tests; no secrets in code, logs, docs or commits (public repository).

## Authority and endpoint

Endpoint pre-merge, matching the #2587 contract: implementation, tests, commits, push to the `ak-ongyeol/TodayWeather` fork, PR to `WizardFactory/TodayWeather` `master`, CI reading. The live read-only calls for AC11 use the approved key from the main checkout's `server/.env` (AK asked for key rechecks in this session). Excluded: merge, deployment, production reads/writes, key changes. AK decision: skip the other-provider review; independent verification uses a fresh-context verifier.

## Risks and open questions

- The shared key's daily quota is not documented; steady state adds about 1,950 calls per day.
- Unstable page order in `getPwnCd` could drop a boundary row; overlapping windows, deduplication and the hourly resync limit the exposure, and a `t6` comparison logs drift.
- Split parents over-warn by design (decision 8).
- The deployed scrape host's time zone is unknown; the new write path is host-independent.

## Amendment 2026-09-27 (r1a)

Source: rebase onto `master` `3ab19ca8` (#2585 merged during the build). Master documents Node.js 10.15.3 on the service host ([EC2 internals](../docs/architecture/ec2-internals.md)), which serves `/v000903/kma/special` and `current.specialInfo`. Constraint added: the warning modules run on Node 10.15.3; `kma-warning-node10-check.js` covers it in the `vc-node10` CI job. Acceptance criteria unchanged; downstream verification renewed on the rebased candidate.

## Amendment 2026-09-27 (r1b)

Source: independent verification `reports/sdlc/issue-2609/independent-verification.md` (CHANGES_REQUIRED) and AK's answer on F2 ("두 시 모두에 포함"): `제주도산지` warnings reach every 제주시 and 서귀포시 town. AC6 is extended accordingly: a 서귀포시 town also receives the `제주도산지` entries, which now lead its summary when the mountain has a higher level. F1 (legacy city names) and F3 (Node 10 sort) are corrected as defects within the existing ACs. F4/F5 (LOW) are deferred and recorded in the correction report.

## Amendment 2026-09-27 (r1c)

Source: AK request "목표에서 벗어나지 않는 상태에서 재검토 3회" and re-review round 1 (HIGH). The `allEndTime` zone-wide release rule dropped active warnings, for example 부산서부 폭염 for a day. The two phantom zones that motivated it came from release rows dropped by multi-page `getPwnCd` windows. Releases now apply per zone and type, and `getPwnCd` is fetched one KST day per request. AC5 now reads "per-type release" instead of "`allEndTime` release". Quota: the one-time bootstrap is 60 requests; each change or hourly resync is 2 requests.

## Amendment 2026-09-27 (r1d)

Source: PR review 5328551599 (ak-ongyeol), required item 1 and recommendation 3. The gather host runs `SERVER_MODE=gather` (docs/operations/kma-station-observations.md), where `startScrape` does not run, so warnings are collected there by a `KMA_WARNING_ENABLED` gather timer (as #2573 did for station observations). The 60-day bootstrap is split into at most 10 days per sync. Recommendation 2 (quota) is answered in the PR Operations section; no cadence change. ACs are unchanged. The deployment step now includes setting `KMA_WARNING_ENABLED=true` on the gather host.

