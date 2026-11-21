# Spec: Granular KMA weather warning zone matching — issue 3084

Revision 1, 2026-11-21. Consumes [intent/issue-3084.md](../intent/issue-3084.md) r1 and amends Decision 8 of [specs/issue-2609.md](issue-2609.md).

## R1 Authoritative mapping data (`server/utils/data/kma_warning_subzones.json`, new)

- Provenance: derived directly from KMA Weather Nuri's official 2026-06-01 27-page subdivision guide (`https://www.weather.go.kr/w/resources/pdf/warning_zone_detailed_guide_2.pdf`, SHA-256 `eaf04636385cfc475dc2f7c6d5980ce00e8383f4c2442e6c6a5b61a9d5e38086`), supplemented with Incheon's 2026-07-01 district reform (`영종구`, `제물포구`, `서해구`, `검단구`) and historical township/district names present in `server/utils/data/areaNoKma.csv`.
- Structure:
  - `provenance`: source metadata, URLs, PDF SHA-256, effective date, license.
  - `district_splits`: `{ [provinceName]: { [secondNormalized]: string[] } }` mapping metropolitan/city districts that resolve cleanly from `town.second` alone (`서울특별시` 25개 구, `부산광역시` 16개 구·군, `울산광역시` 5개 구·군, `광주광역시` 5개 구, `인천광역시` pre/post-2026-07-01 districts except pre-reform `중구`, `대구광역시` 7개 구 + `군위군`, `경기도` `용인시기흥구`/`용인시수지구`, `충청북도` `청주시서원구`/`청주시흥덕구`/`청주시청원구`).
  - `township_splits`: array of `{ province, seconds, by_third, fallback }` covering all 49 split cities/counties/districts (including `인천광역시 중구` with 2026-01-01 `운서1동`/`운서2동`, `인천광역시 강화군`/`옹진군`, `세종특별자치시`, `파주시`, `용인시처인구`/`용인시`, `여주시`/`여주군`, `양평군`, 강원 11 평지/산지 시·군, `청주시상당구`/`청주시`/`청원군`, `홍성군`, `보령시`, `군산시`, `부안군`, `나주시`, `고흥군`, `곡성군`, `해남군`, `구례군`, `무안군`, `완도군`, `영광군`, `신안군`, `여수시`, `대구광역시 달성군`, 경북 3 평지/산지 군, `경주시`, `안동시`, `김천시`, `하동군`, `산청군`, `함양군`, `거창군`, `합천군`, `제주시`, `서귀포시`). Verified 행정동/읍/면 and historical aliases are enumerated explicitly in `by_third` with no blind suffix narrowing.
- Every referenced `REG_ID` must exist in `server/utils/data/kma_warning_zones.csv`.

## R2 Resolution order (`server/lib/kmaWarningZones.js`)

Given `town = { first, second, third }`:
1. Normalize `provinceName` via `PROVINCE_ALIASES`, and for `전남광주통합특별시` classify via `gwangjuJeonnam.js` (`#3078`), returning `[]` if unclassified.
2. Normalize `second = toText(town.second).replace(/\s+/g, '')`, `third = toText(town.third)`, `thirdBase = third.split('/')[0].trim()`.
3. If `second.length === 0 && thirdBase.length === 0`, return `expand(table, [province])` (province-level lookup).
4. Look up `township_splits` by `(province.name, second)` (note: `세종특별자치시` accepts `second` in `["", "세종", "세종특별자치시"]` so `{first: '세종특별자치시', second: '', third: '조치원읍'}` resolves to `세종북부`). When matched:
   - If `thirdBase` is an explicit own property of `by_third`, select `by_third[thirdBase]`.
   - Otherwise (empty or unrecognized `thirdBase`, even when `third` contains an island substring such as `미확인백령면`) select `fallback` (conservative over-warn across all candidate child zones, including external-subtree island codes such as `추자도`, `백령도.대청도`, `연평도.우도`, `흑산도.홍도`, and `거문도.초도`).
   - Map selected IDs through `table.byId` and return `expand(table, zones)`.
5. Else look up `district_splits[province.name][second]`. When matched, map IDs through `table.byId` and return `expand(table, zones)`.
6. Else check `ISLAND_ZONES` (`울릉` -> `울릉도.독도`, plus legacy non-canonical second fallbacks).
7. Else run the existing `second.length === 0` / `cityZones` + `SHARED_ZONES` / cross-province / metropolitan fallback logic unchanged.

## R3 Safe over-warn invariants (zero under-warning)

- Empty or unrecognized `third` on any township-split city/county returns all candidate child zones (including external-subtree island codes for `제주시`, `옹진군`, `신안군`, `여수시`; e.g., `파주시` + `''`/`미확인동` → all 3 파주 zones; `보령시` + `미확인면` → both `보령(도서제외)` + `보령도서`).
- Straddling 행정동 (`속초시 노학동` containing part of 법정동 `교동`, and `속초시 대포동` containing 법정동 `설악동`), altitude-mixed townships (`구례군` `토지면`/`마산면`/`광의면`/`산동면`; 제주도 coastal+mid-mountain+mountain townships except `우도면`/`추자면`), and 리-level island townships (`강화군 서도면`, `보령시 오천면`, `군산시 옥도면`, `완도군 청산면`) return all overlapping candidate zones.
- Non-boundary townships in those same cities/counties cleanly exclude the sibling/mountain/island zone(s).
- `expand(table, zones)` always includes each selected zone's parent/ancestor codes (`서울특별시`, `경기도`, `전국`, etc.) so province-wide or nationwide warnings still apply.

## R4 Compatibility, consumers, and docs

- No new npm dependencies; `kmaWarningZones.js` loads `kma_warning_subzones.json` via `fs.readFileSync` + `JSON.parse` (Node 10.15.3 safe, ES5 syntax preserved in `kmaWarningZones.js`).
- `specialInfoFor`, `KmaSpecialWeatherController.getSpecialInfo`, `controllerTown.js`, `controllerTown24h.js`, and `server/lib/pushCoordinator/region.js` consume `zonesForTown` unchanged and automatically inherit narrowed zone sets.
- Update `specs/issue-2609.md`, `docs/rewrite/server-response-assembly.md`, `docs/architecture/push-s3-design.md`, and `docs/architecture/diagrams/kma-warnings.json` (+ regenerated HTML) to record the granular mapping and remaining over-warn boundaries.

## Acceptance mapping

| AC | Verification |
| --- | --- |
| AC1 | Automated test in `kma-warning.test.js` validating all `REG_ID`s in `kma_warning_subzones.json`, 100% split-leaf coverage in `kma_warning_zones.csv`, and non-empty valid resolution + ancestor closure across all 3,687 data rows of `areaNoKma.csv`. |
| AC2 | Unit tests in `kma-warning.test.js` for Seoul 4 zones, Busan 3, Ulsan 2, Gwangju 2 + `전남광주통합특별시`, Incheon pre/post-2026-07-01, Sejong, 강원/경북 평지 vs 산지, directional splits, `낙월면`, `위도면`, `우도면`. |
| AC3 | Unit tests in `kma-warning.test.js` for empty `third`, unknown district/township, `속초시 대포동`, `구례군` mountain vs flat, `보령시 오천면` vs `대천1동`, `군산시 옥도면` vs `중앙동`, `완도군 청산면` vs `완도읍`, `강화군 서도면` vs `강화읍`, 제주도 directional+altitude sets. |
| AC4 | Real Mongo 3.4.15 smoke (`kma-warning-smoke.js`) including Seoul `서울동북권`+`서울서남권` 건조주의보 scenario + push `region.js` verification + Docker Node 10.15.3 (`kma-warning-node10-check.js`) + `npm --prefix server run test:offline`. |
| AC5 | Updated `specs/issue-2609.md`, `docs/rewrite/server-response-assembly.md`, `docs/architecture/push-s3-design.md` checked with `scripts/check-artifact-policy.py`. |
