# Intent: Granular KMA weather warning zone matching — issue 3084

Revision 1, 2026-11-21. Owner: main agent for AK. Source: issue [#3084](https://github.com/WizardFactory/TodayWeather/issues/3084) and AK instruction: "전체 일괄 (권장 — 단일 이슈)로 발행하되, server2용 이슈를 하위 이슈로 발행하고 병렬 진행" -> "#3084 / #3085 각각 별도 PR을 pre-merge까지 병렬 진행".

## Problem

KMA warning state is collected and stored per granular `areaCode` (235 land zones from KMA's 2026-06-01 reform, e.g. `L1100200` 서울동북권 and `L1100300` 서울서남권), but `zonesForTown` in `server/lib/kmaWarningZones.js` maps any town inside a split metropolitan area or split city/county to every child sub-zone (#2609 Decision 8). As a result, a warning active only in `서울동북권` and `서울서남권` also appears in `current.specialInfo`, forecast summaries, and severe-warning push alerts for users in `서울동남권` and `서울서북권`, and the same over-warning affects other split metropolitan areas, 평지/산지 zones, directional city/county zones, and island-split counties.

## Desired outcome and acceptance criteria

- AC1: A provenance-recorded mapping dataset (`server/utils/data/kma_warning_subzones.json`) covers every split parent in `server/utils/data/kma_warning_zones.csv` against KMA's official 2026-06-01 subdivision guide (`warning_zone_detailed_guide_2.pdf`, SHA-256 `eaf04636385cfc475dc2f7c6d5980ce00e8383f4c2442e6c6a5b61a9d5e38086`), and every `server/utils/data/areaNoKma.csv` town row resolves to a non-empty valid `areaCode` set preserving parent/ancestor codes.
- AC2: Offline tests verify exact sub-zone separation (target sub-zone included, sibling sub-zones excluded) across Tier A (서울·부산·울산·광주 districts including `#3078` `전남광주통합특별시`), Tier B (인천 including pre/post-2026-07-01 district names and `인천영종`, 세종, 강원 11 & 경북 3 평지/산지, 21 directional city/county splits, `영광낙월면`, `부안위도면`), and `제주시 우도면`.
- AC3: Offline tests verify safe over-warn fallback with zero under-warning for empty-`third` lookups, unrecognized `second`/`third`, 행정동/법정동 straddling (`속초시 대포동`), altitude-mixed zones (`구례군` mountain townships, 제주도 coastal+mid-mountain+mountain townships), and 리-level island townships (`강화군 서도면`, `보령시 오천면`, `군산시 옥도면`, `완도군 청산면`), while non-boundary townships in those jurisdictions exclude sibling/island/mountain zones.
- AC4: Local smoke verifies town weather responses (`current.specialInfo` and summary text) and push region resolution (`server/lib/pushCoordinator/region.js`) reflect narrowed zone sets (active 건조주의보 in `서울동북권` + `서울서남권` appears for `노원구`/`영등포구` and is absent for `강남구`/`종로구`), and `server/test/offline/kma-warning-node10-check.js` (including Docker Node 10.15.3) plus offline warning/push test suites pass.
- AC5: Affected documentation (`specs/issue-2609.md`, `docs/rewrite/server-response-assembly.md`, `docs/architecture/push-s3-design.md`) is updated to reflect the amended Decision 8 granular mapping and remaining over-warn boundaries.

## Scope and exclusions

- In scope: `server/utils/data/kma_warning_subzones.json`, `server/lib/kmaWarningZones.js`, offline tests (`kma-warning.test.js`, `kma-warning-node10-check.js`, `kma-warning-smoke.js`, `push-s3.test.js` / push region check), documentation updates, SDLC artifacts (`intent/`, `specs/`, `plans/`).
- Out of scope: `server2/` runtime code/data (tracked in parallel sub-issue `#3085`), client/app UI changes, GPS polygon/DEM altitude resolution, production deployment or merge.

## Constraints and authority

- Node.js 10.15.3 compatibility on service host (`kma-warning-node10-check.js` verified on Docker `node:10.15.3-stretch`) and Node 16/22 compatibility.
- Wire JSON contracts for `specialInfo`, `/v000903/kma/special`, and push region lookup remain unchanged.
- Endpoint: `pre-merge` (`WizardFactory/TodayWeather` PR targeting `master`, push via `origin` or configured fork, CI + independent PR review, `merge_authorized: false`).
