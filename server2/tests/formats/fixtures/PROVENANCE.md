# S13a domestic format fixtures

Test data only; the server2 runtime never reads these files or any legacy file.

| File | Origin | Notes |
| --- | --- | --- |
| `airkorea-stations.json` | Copied byte for byte from `server/test/offline/fixtures/airkorea/stations.json` at `45e9193b` | Legacy offline fixture for the supported B552584 `getCtprvnRltmMesureDnsty` client (#2636); not a live recording |
| `airkorea-sido.json` | Copied byte for byte from `server/test/offline/fixtures/airkorea/sido.json` at `45e9193b` | Legacy offline fixture for `getCtprvnMesureSidoLIst` (24:00 data time); not a live recording |
| `kasi-area-seoul.json` | **Synthetic.** Built from the legacy test helper `kasiItem` in `server/test/offline/riseset-uv.test.js` (field names, `locdate` number, `------` moon form) for 서울/20261013, plus the documented `numOfRows`/`pageNo`/`totalCount` body fields and the `latitude`/`longitude` text fields | No live KASI recording exists in the repository |
| `airkorea-forecast.json` | Copied byte for byte from `server/test/offline/fixtures/airkorea/frcst.json` at `ae21b6cc` (added by #2737, `604643cc`) | Legacy offline fixture for the supported B552584 `getMinuDustFrcstDspth` client (S13b); not a live recording |
| `airkorea-station-list.json` | Copied byte for byte from `server/test/offline/fixtures/airkorea/msrstn.json` at `ae21b6cc` (added by #2737, `604643cc`) | Legacy offline fixture for `getMsrstnList` (`dmX` latitude, `dmY` longitude); not a live recording |
| `forecast-zone.json` | **Synthetic (S13b).** Built from the legacy test helpers `item`/`page` in `server/test/offline/forecast-zone.test.js` at `ae21b6cc` (`resultCode` `00`, `NORMAL_SERVICE`, `dataType`, per-page `totalCount`, numeric `tmEd`/`tmSt`) and the [#2739 evidence](../../../../docs/evidence/tasks/issue-2739.md) (군위 `11H10707`, the aggregate `11BD0000` with `regSp` `0` and zero coordinates) | Replaces the S13a newsky2 fixture; no live `getFcstZoneCd` recording exists in the repository |
| `airkorea-quota-429.json` | **Live recording (S13c, #2745).** Exact body of `getCtprvnRltmMesureDnsty` for 서울 at 2026-10-14 14:56:12 UTC (23:56 KST), answered with HTTP 429 and `Content-Type: application/json` for a key at its daily limit | Contains no key or URL; the HTTP status is set by the test |

Multi-page and invalid AirKorea pages are generated in the tests from the station fixture's row shape;
multi-page forecast, station-list and zone pages are generated from the fixtures above.
