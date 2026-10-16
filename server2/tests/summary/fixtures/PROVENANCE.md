# S16 summary fixtures

| File | Source | Acquired | Notes |
| --- | --- | --- | --- |
| `asos-daily-108-20251012-20251018.json` | data.go.kr `1360000/AsosDalyInfoService/getWthrDataList` (dataset 15059093), `dataCd=ASOS`, `dateCd=DAY`, `stnIds=108`, `startDt=20251012`, `endDt=20251018`, `pageNo=1`, `numOfRows=999`, `dataType=JSON` | 2026-10-15 (KST) by the S16 builder, one call with a key from the legacy `DONGNAE_SECRET_KEYS` list loaded in-process | Response body byte for byte (`resultCode` `00`, 7 items, 8,187 bytes, 0.30 s). Public observation data; the request key is not part of the body. |

VC Timeline bodies and grid rows in the tests are synthetic and built in the test code.
