Task: issue-2741-s13b; owner: Claude builder (S13b worktree); revision/base: ae21b6cc6525d4b51fd879469f9b573ebceb4fe6; date: 2026-10-14.
Authority: AK authorized S13b on 2026-10-14 (relayed by the root coordinator); endpoint pre-merge.
Criteria: AC1-AC3 from [intent](../intent/issue-2741.md). Paths: [S13b declaration](../server2/config/tasks/S13b.json).

# Specification: legacy AirKorea and forecast-zone source changes (S13b)

Legacy sources at master `ae21b6cc` (after #2737 `112b4d04` and #2740 `437baccb`):
`server/lib/airkoreaObservation.js`, `server/lib/kecoRequester.js`,
`server/controllers/kma/kma.forecast.zone.controller.js`, `server/models/modelMsrStnInfo.js`.

## Requests (AC1)

| Request | Path below `https://apis.data.go.kr/` | Family query (the transport appends format and key) | Pages |
| --- | --- | --- | --- |
| `AirKoreaRequest::dust_forecast(date)` | `B552584/ArpltnInforInqireSvc/getMinuDustFrcstDspth` | `searchDate=YYYY-MM-DD, pageNo, numOfRows=100, ver=1.1` | <=20, total <=2000 |
| `AirKoreaRequest::station_list()` | `B552584/MsrstnInfoInqireSvc/getMsrstnList` | `pageNo, numOfRows=100` (no `ver`: `dmX` latitude, `dmY` longitude) | <=20, total <=2000 |
| `ZoneRequest` | `1360000/FcstZoneInfoService/getFcstZoneCd` | `numOfRows=1000, pageNo` | <=10 |

AirKorea uses `ResponseFormat::ReturnType` (`serviceKey`, `returnType=json`); the zone list uses
`ResponseFormat::DataType` (`serviceKey`, `dataType=JSON`). The newsky2 root,
`Endpoints::with_newsky` and the newsky2-only `ResponseFormat::Type` (with its `0000` success
code) are removed. `publication::dust_forecast_announcement(now)` ports `_checkDataTime`: KST
hour <5 → previous day 23시, <11 → 05시, <17 → 11시, <23 → 17시, else 23시; the search date is
the announcement's date.

## AirKorea key selection (AC1)

All four AirKorea operations (station, sido, dust forecast, station list) share legacy
`withKeys` through the AirKorea `KeyRing`: start with the key that last answered successfully,
otherwise the last configured key. A credential rejection (executor `Auth`: HTTP 401/403 or codes
20/30/31/32) moves to the previous key, wrapping, and restarts the operation from page 1 under
the same caller deadline. When every key was rejected the call fails with `Provider(Auth)`.
Quota (HTTP 429, code 22), other provider codes, transport failures and invalid bodies stop
without changing the key. A success records that key. Each page call offers one candidate, so
the S08 executor never rotates AirKorea itself. For `ReturnType`, an HTTP 401/403 whose body
carries an explicit code other than 20/30/31/32/22 is `Rejected` (legacy `rejectionCode`); an
unread 401/403 body is a retryable download failure; a 401/403 or 200 gateway body without a
1-3 digit code other than `00` is read for the legacy expired/unregistered (credential) and quota
markers (review S13B-R1-02/03, round 2).

## Validation and records (AC2)

Every AirKorea page needs `response.header.resultCode` `"00"`, an `items` array of objects, a
digit `totalCount` <= 2000 that is the same on every page, echoed `pageNo`/`numOfRows`, and
`min(100, total - before)` items. `totalCount 0` on page 1 is terminal NoData. An item with a
non-empty string `serviceKey` is invalid: legacy deletes the echo before storage, but a raw
record must keep the provider bytes, so the page is not stored. A repeated item (identical
JSON) across the pages is invalid.

- Dust forecast item: nonblank string `dataTime`, `informCode`, `informData`; string
  `informGrade`. The record period is the newest `YYYY-MM-DD HH시 발표` announcement on the
  search date; a body without one is invalid (legacy would store no row from it).
- Station list item: nonblank string `stationName`; `dmX`/`dmY` string or finite number; `addr`
  absent, null or string. The record period is the KST fetch day.
- Zone page: `resultCode` `"00"`, `items.item` array, `totalCount` equal to the item count
  (per page), echoed `pageNo` and `numOfRows=1000` (numbers or digit strings), and items that
  pass legacy `normalizeZone` (nonblank string `regId`/`regName`/`regSp`; text fields string or
  finite number; `tmEd`/`tmSt` nonnegative integer or digit string; `seq`/`ht`/`lat`/`lon`
  finite decimals; nonzero coordinates within longitude [-180, 180) and latitude [-90, 90]);
  `regId` unique across pages. A page of 1000 items continues; a shorter page ends the list,
  as does a regular JSON `response.header.resultCode "03"` after a full page (a gateway or XML
  `03` fails the list, review S13B-R1-01); `03` on page 1 is NoData; a full tenth page fails. An empty
  list is not recorded. Period: KST fetch day.

| Kind | Key (`ProviderKey::Named`) | Period | Partition |
| --- | --- | --- | --- |
| `airkorea-dust-forecast` | `dust-forecast` | newest announcement `YYYYMMDD`/`HH00` | search date `YYYYMMDD` |
| `airkorea-station-list` | `stations` | fetch day `YYYYMMDD`/`0000` | `YYYYMMDD` |
| `forecast-zone` | `forecast-zones` | fetch day `YYYYMMDD`/`0000` | `YYYYMMDD` |

Records keep the provider bytes, `Pagination{page, pages, complete: true}` in request order and
one group per acquisition. Any later-page failure discards the whole set.

## Recorded differences

At most one funded retry per page (legacy: one transient retry for AirKorea, three attempts per
key for the zone list); a zone 3xx is retried once and other 4xx stop (legacy: the reverse).
A zone page tries at most two keys through the #2604 ring, which does not return to its starting
key after a failure (legacy: every key once per request, then back to the start; S13B-R1-04).
The empty zone list (legacy would retire every zone) and a forecast without a parseable
announcement on the search date are not recorded. Live HTTPS behavior of these services is
unverified; fixtures are legacy offline fixtures or labelled synthetic pages.

## Verification

Red tests first (new requests, key order, zone paging); then fmt, fresh clippy
`--workspace --all-targets -D warnings`, `cargo test --locked --workspace`, the release-mode
`formats` smoke with the loopback provider stub and the S3 test peer, the placement gate and
`test_placement.py`, and the artifact policy for staged content and the outgoing range.
