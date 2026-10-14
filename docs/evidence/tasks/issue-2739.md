# Issue 2739 verification — 2026-10-14

Base: `112b4d048bbf4b236edfcfcf5a57e49776388f90` (origin/master after #2737; first built on `44d76a0f` and rebased, all checks below re-run after the rebase). Candidate changes are identified by the PR commit containing this record; review/CI receipts belong to the PR and are bound to its head. This record reports builder execution only. Keys were read from a local environment file into the process environment and never printed; the evidence logs were scanned for key strings afterwards (none found).

Provider observations (read-only, HTTPS, one key unless noted):
- Retired host: `http://newsky2.kma.go.kr/service/ForecastZoneInfoService/ForecastZoneCodeDataInfo` (no key) → 307 `Location: /503.html` → 503 `text/html`.
- `getFcstZoneCd`: `numOfRows=1000` → 755 items, `totalCount 755`; `numOfRows=500` → pages of 500 and 255 items with matching `totalCount`, page 3 → `resultCode "03"` `NO_DATA`; `numOfRows=10` page 77 → `03`; `numOfRows=1` → one-element `items.item` array. A dummy key → HTTP 403 JSON `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`.

Land-zone file: generated from the 240715 xlsx; 176 `육상` rows minus `11H10603` (`2023.11.30. 종료`) plus the continuation row `11H10707` (`2023.11.30. 신설`). The result equals the 176 land codes of the guide's embedded 231130 list.

Executions (Node v24.19.0; isolated deps: mocha 2.5.3, async 2.6.4, mongoose 5.1.2, request 2.88.2 and the CI offline set; mongodb-memory-server-core 10.1.4 with MongoDB 4.4.29):
- Red: `node server/test/offline/forecast-zone.test.js` on the base controller → exit 1, 9 of 24 failing for the missing behavior (old `resultMsg` check, no retirement filter, no 군위 mapping, no land list, Manager still requesting unlisted zones). The failure-path cases already rejected on the base because it rejects every getFcstZoneCd body.
- Green and post-refactor: the same file → 24/24.
- `npm --prefix server run test:offline` → exit 0 (includes the adapted `data-go-kr-keys.test.js`, 33/33).
- `data-go-kr-keys-smoke.js` and `gather-quota-smoke.js` → PASS.
- `forecast-zone-smoke.js` (real `request` over loopback, real mongod 4.4.29, Mongoose 5.1.2): 307 not followed, one request, no writes; key 1 rejected (403/30), key 2 pages 1000 + 5; 1,005 active rows; legacy `11H10603` retired; seven town cases; seven listed mid-temperature zones; sanitized logs.
- `forecast-zone-live-check.js` against the real service with an isolated mongod: `{"storedZones":755,"activeCityZones":219,"retired":["11H10603"],"midTempZones":176,"requests":1}`; town mapping 서울특별시 강남구 → `11B10101`, 광주광역시 북구 → `11F20501`, 경기도 광주시 → `11B20702`, 강원특별자치도 고성군 → `11D20402`, 경상남도 고성군 → `11H20404`, 경상북도 군위군 and 대구광역시 군위군 → `11H10707`.
- `rg newsky2 server --glob '!server/test/**'` → no match.
- Archify `finalize` (validate, deliver, check, browser-check) and `visual-check` for `weather-collection` → pass; captures inspected.

Limitations: no production gather run, deployment or CI-equivalent Node 22 run locally (CI runs Node 22.22.2 and the Node 16 container job). A truncated but internally consistent provider page cannot be detected. server2 S13a still targets newsky2 and is handled in a separate task.
