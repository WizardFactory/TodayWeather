# Spec: KMA warnings from WthrWrnInfoService and zone-coded town warnings — issue 2609

Revision 3, 2026-09-27. r3 (independent verification F1–F3, AK decision on F2): shared zone `제주도산지` for 제주시/서귀포시 towns; legacy city names; no province-wide fallback for provinces; full comparator in the controller sort. Revision 2: Consumes [intent](../intent/issue-2609.md) r1 and the issue's Decisions 1–9. r2 records build-time refinements: numeric event order fields, the `warnVar`/`warnStress` mapping in `kmaWarningZones`, a `baseUrl` requester option for local smoke servers, readable location text, and an issue older than a zone's all-clear being stored inactive.

## R1 Requester (`server/lib/kmaWarningRequester.js`, new)

- Base `http://apis.data.go.kr/1360000/WthrWrnInfoService/<operation>` (overridable with `baseUrl` for local smoke servers), `dataType=JSON`, `pageNo`, `numOfRows`, optional `stnId`, `fromTmFc`, `toTmFc` (KST `YYYYMMDD`).
- Keys: candidate list from `config.keyString` in the #2587 order (`normal`, `test_normal`, then `dongnae_forecast_keys` entries), skipping unset defaults (< 20 characters or `You have to set…`) and duplicates. A key is decoded once and re-encoded as a query component, so a stored percent-encoded key is sent unchanged in effect and never double-encoded.
- Classification of one response: transport error → `error`; gateway body `OpenAPI_ServiceResponse.cmmMsgHeader` or XML `<returnReasonCode>` → `error` with `returnCode`; HTTP 401/403 or codes 20, 30, 31, 32 → `isAuthError`; HTTP 429 or code 22 → `isQuotaError`; `resultCode` `03`/`NODATA` or no items → `noData`; other non-`00` → `error` (includes `99`); otherwise `items` (always an array).
- Auth error rotates to the next key within the same request (at most one pass over the keys). A quota error fails immediately without trying other keys or retrying (#2604). No other retries inside a cycle; the next poll is the retry.
- `getAll(operation, params)` pages with `numOfRows` 1,000 until a page shorter than `numOfRows`, capped at 20 pages (the 60-day bootstrap took 5 pages on 2026-09-27); `totalCount` is ignored. Messages never contain the key.

## R2 Collector (`server/lib/kmaWarningCollector.js`, new; `KmaScraper.gatherSpecialWeatherSituation` delegates to it)

One `gather(callback)` per scrape cycle; the existing 3-minute scheduler and the `'skip'` convention are unchanged. Steps, each independent so one failing operation does not block the others:

1. `getPwnStatus` → latest item by (`tmFc`, `tmSeq`). If no type 1 document has that announcement, the announcement is pending:
   - `getWthrWrnMsg` (`stnId=108`, from/to = date of `tmFc`); pick the item with the same `tmFc` (and `tmSeq` when present). Absent → not ready.
   - `getPwnCd` window sync (R3). The window must contain at least one row with this `tmFc`, unless `t6` is "없음" and the state has no active zone. Absent → not ready.
   - Ready → apply events, store the type 1 document `{announcement, type: 1, situationList(t6), comment: other, bulletin: {title: t1, areas: t2, effectiveTimes: t3, releaseOutlook: t4}}`. Not ready → store nothing; it is retried on the next cycles. After 20 not-ready cycles (about one hour) the document is stored without `bulletin` (warning logged) so that a permanently missing bulletin cannot stall the national status.
2. Hourly resync: when the last `getPwnCd` sync is older than 60 minutes, sync again even without a change (late or corrected rows).
3. `getWthrPwn`, `getWthrInfo`, `getWthrBrkNews` (`stnId=108`, from = yesterday, to = today, KST): latest item by `tmFc`; store type 2 `{situationList(pwn), comment: rem || ''}`, type 3 `{comment: t1}`, type 4 `{comment: ann}` when no document with that announcement/type exists.
4. Callback `'skip'` when nothing was stored and no step failed; an error summary when a step failed; otherwise nothing.

`announcement` is the KST wall-clock value stored as UTC (`Date.UTC(y, m-1, d, h, min)`), which equals what the scraper stored on a UTC host; the served `announcement` is unchanged (`-9 h` in `getCurrent`), now host-independent. Text fields have `\r` removed. Upsert key `{announcement, type}` as before; `imageUrl` omitted.

## R3 Zone state (`server/models/modelKmaSpecialWeatherZone.js`, new) and replay

- Document per (`areaCode`, `warnVar`): `{areaCode, areaName, warnVar, warnStress, active, command, eventTmFc (number YYYYMMDDHHmm), eventTmSeq, eventRank (0 release, 1 issue), updatedAt}`; unique index on (`areaCode`, `warnVar`). `warnVar 0` holds a zone's latest all-clear. A sync marker document (`areaCode: '_sync'`, `warnVar: -1`) records the last sync time and window.
- Window: empty state → 60 days (bootstrap); otherwise from (date of the previous sync − 1 day) to today, capped at 60 days. Rows are normalized (numbers; trimmed strings), deduplicated by (`areaCode`, `warnVar`, `tmFc`, `tmSeq`, `command`, `warnStress`, `cancel`, `endTime`, `allEndTime`), sorted ascending by (`tmFc`, `tmSeq`), releases before issues within one announcement.
- Rules: `cancel` 1 → ignored. `command` 1, 3, 6, 7 → active with `warnStress`. `command` 2, 8 → inactive. Nonzero `allEndTime` → every `warnVar` of the zone inactive. An event is applied to a key only if its (`tmFc`, `tmSeq`, rank) is newer than the key's stored event, so replaying the overlap is idempotent and older late rows cannot override newer state; an issue older than the zone's all-clear is stored inactive.
- After a sync the collector compares the state with `t6`: an active warning whose `weatherStr + levelStr` does not occur in `t6`, or any active zone while `t6` is "없음", logs one warning with counts (no correction).

## R4 Town mapping (`server/lib/kmaWarningZones.js`, new; data `server/utils/data/kma_warning_zones.csv`)

- CSV: Sheet 2 land rows (`REG_ID` starting `L`) of the KMA 특보구역코드 spreadsheet (2026-06-01): `REG_ID, TM_ST, TM_ED, REG_SP, REG_UP, REG_KO, REG_NAME`; rows whose `TM_ED` is past are ignored.
- Province: `town.first` normalized to the zone table's first-level names (for example `강원특별자치도` → `강원도`, `전북특별자치도`/`전라북도` → `전북자치도`, `제주특별자치도` → `제주도`).
- Island overrides first, matched on city and town names so that same-named towns elsewhere (부산 대청동, 인천/울산 삼산동) do not match: 울릉 → 울릉도.독도; 신안+흑산 → 흑산도.홍도; 제주시+추자 → 추자도; 여수+삼산 → 거문도.초도; 옹진+백령/대청 → 백령도.대청도; 옹진+연평 → 연평도.우도.
- City/county: in the province subtree, the zone whose `REG_NAME` without a parenthetical equals `second` or is a prefix of it (`수원시장안구` → `수원시`). The selected set is that zone, its descendants and its ancestors.
- Shared zones spanning several cities are added to those cities' towns: `제주도산지` for 제주시 and 서귀포시 (AK decision after verification F2).
- Legacy city names map to current zones (`청원군` → `청주시`). A province town whose city is not in its province is matched nationwide (`경상북도/군위군` → 대구 `군위군`); an unknown city gets only the province's own zone and ancestors.
- Region-level request (`second` empty): the province and all descendants. Metropolitan district without its own zone: the child named like the city (`인천광역시`, `대전광역시`, `광주광역시`, `세종특별자치시`) when present, else every child that is not a separate county or city (서울 4 권역, 부산 3 zones, `대구중부`; over-warn by decision 8).
- `getSpecialInfo(town, stnName, cb)` reads active zones in the set and returns `[{weather, weatherStr, level, levelStr, locationName: areaName}]`, unique per (`weather`, `level`, `locationName`), sorted by `weather` descending, then `level` descending, then zone name; the controller's `_sort` uses the same full comparator because Node 10's `Array#sort` is unstable. Empty → `[]` (the route then omits the field as today).

## R5 Codes (`server/models/modelKmaSpecialWeatherSituation.js`)

- `parseSituationType`: 폭풍해일 (7) and 지진해일 (8) tested before 해일 (6); add 열대야 (13).
- `strArray2SituationList`: 중대경보 → `level 4`, tested before 경보.
- Text parsers `parseSpecialText` (t6) and `parsePreliminaryText` (pwn/t7) keep the provider's spacing in `location`/`timeStr`.
- `warnVar` → `weather` (in `kmaWarningZones`): 1→1, 2→3, 3→9, 4→5, 5→7, 6→2, 7→10, 8→4, 9→11, 12→12, 13→13; others 0. `warnStress` → level 0→1 주의보, 1→2 경보, 2→4 중대경보.

## R6 Controller (`server/controllers/kma.specialweather.controller.js`)

`getCurrent` passes `bulletin` through (with `\r` removed) and treats a missing `comment` as `''` (no 501 for a type 2 without `rem`). `getSpecialInfo` uses R4. The text-matching helpers become unused and are removed.

## Failure behavior and observability

Any error of an operation leaves its documents and the zone state unchanged; logs name the operation, `returnCode`, HTTP status and whether it was quota/auth, never the key. Quota errors log one warning per cycle and skip the remaining operations of that cycle.

## Alternatives rejected

- Rebuilding state from a full 60-day window on every change: the window cannot see warnings older than 60 days and costs up to five pages per change.
- Scraping the redesigned site: undocumented markup, same failure mode.
- Mapping towns to sub-zones by nearest station: 100+ split zones without an authoritative station list.

## Verification strategy

Offline VM tests for R1–R6 with recorded live fixtures (keys removed); an integration smoke with real Mongo (Docker `mongo:3.4.15`) that runs the real collector against a stub provider server and serves the real `/v000903/kma/special` route and the town controller's `getSpecialInfo`; a `client/www` Playwright E2E against that server; one live collector run (AC11).
