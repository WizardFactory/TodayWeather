# S13a domestic format fixtures

Test data only; the server2 runtime never reads these files or any legacy file.

| File | Origin | Notes |
| --- | --- | --- |
| `airkorea-stations.json` | Copied byte for byte from `server/test/offline/fixtures/airkorea/stations.json` at `45e9193b` | Legacy offline fixture for the supported B552584 `getCtprvnRltmMesureDnsty` client (#2636); not a live recording |
| `airkorea-sido.json` | Copied byte for byte from `server/test/offline/fixtures/airkorea/sido.json` at `45e9193b` | Legacy offline fixture for `getCtprvnMesureSidoLIst` (24:00 data time); not a live recording |
| `kasi-area-seoul.json` | **Synthetic.** Built from the legacy test helper `kasiItem` in `server/test/offline/riseset-uv.test.js` (field names, `locdate` number, `------` moon form) for 서울/20261013, plus the documented `numOfRows`/`pageNo`/`totalCount` body fields and the `latitude`/`longitude` text fields | No live KASI recording exists in the repository |
| `forecast-zone.json` | **Synthetic.** Built from the legacy parser contract in `server/controllers/kma/kma.forecast.zone.controller.js` (`resultMsg` `OK`, `items.item` array, `regId`, `regName`, `regSp`, `lat`/`lon`) with the newsky2 `0000` result code | No live newsky2 recording exists; live reachability is unverified |

Multi-page and invalid AirKorea pages are generated in the tests from the station fixture's row shape.
