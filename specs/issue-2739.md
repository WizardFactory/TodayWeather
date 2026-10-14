Task: issue-2739; base 44d76a0f; date 2026-10-14. Intent: [issue-2739](../intent/issue-2739.md).

# Specification

## Refresh (`KmaForecastZoneController.getFromKma`)

Request: `GET https://apis.data.go.kr/1360000/FcstZoneInfoService/getFcstZoneCd?serviceKey=<key>&numOfRows=1000&pageNo=<n>&dataType=JSON`, `json: true`, `followRedirect: false`, 10 s timeout. The key comes from `DONGNAE_SECRET_KEYS` (`dataGoKrKeys.parse/encode`).

Per request (`_request`):

| Observation | Result |
| --- | --- |
| transport error, HTTP >= 500, other 4xx | failure; up to 3 attempts with the same key |
| HTTP 3xx | failure, not retried, no redirect followed |
| HTTP 401/403/429 or body code 20/30/31/32/22 | key rejection; next key, each key once per request |
| otherwise | body passed to page validation |

Page `n` (`_parsePage`) succeeds only if `response.header.resultCode === "00"`, `response.body.items.item` is an array, `totalCount` equals its length, and the echoed `pageNo`/`numOfRows` equal the request (numbers or digit strings). Every item needs nonempty string `regId`, `regName`, `regSp`; any other `regSp` value and missing coordinates are accepted. Review Z-R1-001: each item is normalized to the model fields before any write (`regEn`/`regUp`/`stn*` string or finite number → String; `tmEd`/`tmSt` non-negative integer or digit string → String; `seq`/`ht` numeric; `lat`/`lon` numeric when present); any other type fails the fetch and unknown fields are dropped. Review Z-R1-002: provider codes appear in errors only when they match `^\d{1,4}$`, otherwise as `invalid`. A `regId` repeated within or across pages fails the fetch.

Paging: stop after a page with fewer than 1000 items. After a full page, request the next one; `resultCode "03"` on that next page ends the fetch. `03` on page 1, any other code, or more than 10 pages fails the fetch. A failure on any page aborts before any database write.

## Storage and retirement

Each fetched item is upserted by `regId` with `$set` of the provider fields (`tmEd`, `tmSt`, `stnF3` cast to the existing String fields) and `$unset` of `retired`/`retiredAt`. `geo = [lon, lat]` when both are finite and nonzero; otherwise `geo` is unset. After every upsert succeeds, rows with `regId` not in the fetch and not already retired receive `retired: true`, `retiredAt: <now>` (`updateMany`). No row is deleted. An upsert error rejects before retirement.

`findForecastZoneCode(query)` adds `retired: {$ne: true}`; rows without the field stay visible. `findForecastZoneByName`, `findForecastZoneNear`, mid-temperature selection and `midRssKmaRequester` all read through it.

Model (`kma.forecast.zone.model.js`): add `retired: Boolean`, `retiredAt: Date`. Existing fields and indexes are unchanged; `ht` remains declared for older rows.

Log lines name the page, key index, counts and failure check; never the URL or key.

## Town mapping

In the 광역시 branch, `대구` with city `군위군` maps to regName `군위`. Other behavior is unchanged: 광주광역시 → `11F20501`, 경기 광주 → `11B20702`, 고성 by province, 인천 강화군 → 강화, 울릉 → 울릉도.

## Mid-temperature zones

`server/utils/data/kma_forecast_land_zones.csv` lists the 176 land zones (`REG_ID,REG_NAME,REGION`) with a `#` header naming the guide file, the 240715 edition and the 종료/신설 rule (`11H10603` removed, `11H10707` added). `KmaForecastZoneController.landZoneIds()` loads it once and fails on a duplicate or malformed row. `findMidTempZones(callback)` returns active `regSp "C"` rows whose `regId` is listed, and logs the listed IDs missing from the active rows. `Manager.getMidTempByForecastZone` uses it in place of the city query and the hard-coded `unsupportList`; the publication check and request steps are unchanged.

## Alternatives not selected

- Deriving land zones from `regSp "C"` or `getMidTa` probing: no field distinguishes the 43 non-land city zones (issue).
- Deleting absent rows: prohibited by the issue; retirement keeps history and rollback simple.
- A grand-total check: the provider reports `totalCount` per page.
- Requiring every listed land zone in the fetch: a future KMA retirement would block every refresh until the file changes.

## Verification

Offline (`node:test`, harness, synthetic responses): page sequencing (1000+1000+5, 1000+`03`), failures (307, `01`, `03` on page 1, malformed body, per-page mismatch, duplicate, page limit, second-page transport error) with zero model writes and sanitized logs, key rotation, retirement/visibility, 군위 mapping, land list content, Manager selection excluding `11A00102`. Smoke: real `request` over loopback for the refresh path; real mongod (mongodb-memory-server) with the live provider for AC3. Documentation: artifact policy and Archify checks.
