# Spec: Daily KMA weather without sunrise, sunset or UV — issue 2587

Revision 1, 2026-09-26. Consumes [intent](../intent/issue-2587.md) revision 1. No source changes at this stage.

## Requirements

| ID | Requirement | AC |
| --- | --- | --- |
| R1 | New `server/lib/sunRiseSet.js` exports `compute(lat, lon, 'YYYYMMDD')` → `{sunrise, sunset}` as KST `YYYY.MM.DD HH:MM` strings (seconds truncated, as the KASI conversion does). It uses the NOAA solar-position equations with the −0.833° standard altitude and two refinement passes. Results do not depend on the host time zone. It returns `undefined` for invalid input or when the sun does not cross the horizon. | AC1, AC2 |
| R2 | `ControllerTown.getRiseSetInfo` keeps KASI store values where present. Afterwards, every `dailyData` row without `sunrise` or `sunset` gets the missing value from R1 for `req.geocode` (fallback `req.gCoord`). Store/lookup errors are logged with the right variable and the waterfall callback is not called twice. | AC1, AC5 |
| R3 | The KASI requests use a key list: `normal`, then `test_normal` (configured, distinct, not the placeholder). An HTTP 401/403 or a data.go.kr auth code (20, 22, 30, 31, 32) moves to the next key for the same request; the chosen key is kept for later requests. Error messages and logs carry the API name, status and reason code, never the URL with the key. | AC3 |
| R4 | `gatherAreaRiseSetFromApi` continues with the remaining areas after one area fails, logs each failure and fails only when every area failed. | AC3 |
| R5 | UV collection (`taskLifeIndex2('ultrv')`) uses `http://apis.data.go.kr/1360000/LivingWthrIdxServiceV5/getUVIdxV5` with `serviceKey`, `pageNo`, `numOfRows=1000`, `dataType=JSON`, empty `areaNo` (all areas) and `time=YYYYMMDDHH`. Time candidates are the current KST three-hour slot and the four earlier slots. Result code `03` or no items → next candidate. Other pages follow until `totalCount`; any page failure fails the run without saving. Key rotation on the R3 auth failures across the key list `cert_key`, `test_cert`, `normal`, `test_normal`. A run whose issuance equals the last saved issuance does not save again. | AC4 |
| R6 | V5 items become daily records `{areaNo: Number, date, indexType: 'ultrv', index, lastUpdateDate: item.date}` saved with the existing `saveLifeIndex2`. Hour `hN` is `item.date` (KST) + N hours. A date's index is the maximum non-empty value on that date, emitted only when the item has a non-empty 12:00 KST value for it; partly covered days keep their earlier value. `date` uses the existing `kmaTimeLib.convertStringToDate('YYYYMMDD')` encoding so `appendData2` reads it unchanged. | AC4 |
| R7 | Failure keeps the response shape: route status 200; UV/rise-set failures only omit `ultrv*`; other daily fields are unchanged. `fsn` keeps the legacy request. | AC5 |

## Interfaces and data

No route, middleware order, query or client contract change. `lifeIndexKma2` and `kasiRiseSet` schemas unchanged. Daily rows now always carry `sunrise`/`sunset`; KASI-only fields (`moon*`, twilight, `suntransit`, `locationName`, `locationGeo`) stay absent for computed rows — no consumer was found in `client/`, `tw.ios/`, `applewatch/`, `packages/` or `web/`.

## Normal and failure behavior

- KASI row present → KASI values (unchanged). KASI row missing or store error → computed values.
- V5 unavailable, key not approved or no data in any slot → error logged, earlier stored UV (≤10 days) remains, response omits UV when no row matches.
- Night/empty values (`""`) are skipped; non-numeric values are skipped.

## Security, UX, observability

Keys never appear in error messages; the existing debug log of the full KASI URL is replaced with a keyless description. UX: sunrise/sunset and night icons return for every day. Logs: key rotation (index only), per-area KASI failures, selected UV issuance and saved count.

## Compatibility and migration

DB 1.0/2.0 unaffected (these collections are shared). Old UV rows expire through `_removeOldData`. Rollback: revert; no migration.

## Verification strategy

- Unit (`riseset-uv.test.js`, VM-loaded production modules): R1 reference values under three host time zones; R2 fill-in with store rows, store error and missing geocode; R3 key rotation and keyless errors; R4 continuation; R5 slot fallback, pagination, rotation, same-issuance skip; R6 parsing of a V5-format fixture into `ultrv`/`ultrvGrade` via `appendData2`.
- Route smoke (`riseset-uv-smoke.js`, existing harness): DB 1.0/2.0 × KASI partial/empty/error × UV present/error; all middleware run, 200, formats, unchanged other daily fields.
- Regression: `test:offline`, RSS/air/weather-desc/daily smokes, Node 16.20.2 and 22.22.2.
- Live: not possible here (no keys; production reads denied). Recorded fixture from a keyed V5 call and AC7 are operator follow-ups.

## Alternatives

- Only swap the KASI key: rejected as sole fix; the cause is unconfirmed and the store stays a single point of failure.
- Request-time KASI coordinate API: rejected; up to 17 calls per request on ten workers.
- Keep KASI and drop the store: rejected; changes gather contract and loses the reference source.
- Per-area V5 requests: rejected; about 3,800 requests per run versus four pages.

## Risks

Computed times can differ from KASI by up to a minute. Unknown V5 publication slots (mitigated by the slot fallback). A key approved for V5 must exist on the gather host.

## Amendment 1 — 2026-09-26

Source: independent verification (fresh context), PASS_WITH_NOTES. R3/R5: authorization codes are also read from XML gateway bodies (HTTP 200). R5: only a provider result code (no data or another code) moves to an earlier slot; a transport or page failure fails the run, and a slot older than or equal to the last saved issuance is never saved. The legacy fsn request no longer logs its URL with the key.

## Amendment 2 — 2026-09-26

Source: AK ("한국천문연구원_출몰시각 정보 사용 허가받음", then supplied the gather configuration export) and keyed provider calls. The key values were not logged.

- The deployed `DATA_GO_KR_TEST_NORMAL_KEY`, which is the same value as `DATA_GO_KR_TEST_CERT_KEY` and is also the first `DONGNAE_SECRET_KEYS` entry, gives KASI 401 with reason 31 (expired key) and V5 403 with reason 30 (key not registered). This confirms the rise/set cause. The second `DONGNAE_SECRET_KEYS` entry returns `00` for both services.
- R3 and R5 (revised): key candidates add the `DONGNAE_SECRET_KEYS` entries after the existing keys, and duplicates are skipped.
- A live `getUVIdxV5` check found that:
  - The service issues every three hours, and a request for any hour returns the latest issuance at or before that hour.
  - `areaNo=` returns 3,851 areas, paged at 1,000 rows.
  - Night values are `"0"`, and `h60`–`h75` can be empty.
- `fixtures/uv-idx-v5.json` is now a live recording.
- The real collectors ran against live providers with the DB writes intercepted:
  - UV: 5 requests, 3,851 areas, 11,553 day values; Seoul 26th 4, 27th 7, 28th 6.
  - KASI: Seoul 06:23/18:24; the computed values are 06:22/18:23.
- The KMA API Hub UV observation service (`kma_sfctm_uv.php`, seven stations, observed UV-B index) was reviewed and not adopted: it cannot supply forecast days or area coverage.

## Amendment 3 — 2026-09-26

Source: [PR #2596 review](https://github.com/WizardFactory/TodayWeather/pull/2596#pullrequestreview-5324736798), required items 1–2 and recommended items 3–4.

- **R5, schedule:** after the current slot's issuance is saved, or is already saved, `ultrv.nextTime` moves to the next three-hour KST slot +10 min (`updateTimeTable` `[0,3,…,21]` UTC). A failure, or an issuance older than the current slot (not published yet), leaves `nextTime` unchanged; the next tick then costs one page request.
- **R5, issuance:** the issuance comes from `item.date`, because a request time returns the latest issuance at or before it.
- **R5, season:** UV collection is year-round (`offerMonth` `{start: 0, end: 11}`).
- **R3/R5, keys:** candidate keys shorter than 20 characters are skipped (unset defaults such as `["key1","key2"]`). Each request tries each key once, starting from the current one, and keeps the key that works. If every key is rejected, the previous choice is kept, and the KASI `async.retry` stops through `errorFilter`.
- **Verified live, DB writes intercepted:** after the save, the next get was 15:10 KST and a second run before that made no request. A forced rerun of the same issuance requested one page and saved nothing.
