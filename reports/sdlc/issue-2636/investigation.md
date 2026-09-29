# Investigation
Inputs: issue #2636/comment 5891956425, intent, base 39a3336.

- `server/lib/kecoRequester.js` getUrlCtprvn builds retired URLs and `_jsonRequest` has no deadline. Keys and URLs are logged. Supported official services are HTTPS `apis.data.go.kr/B552584/ArpltnInforInqireSvc` and `ArpltnStatsSvc`, using `serviceKey` and `returnType=json`, nested response/header/body/items, resultCode 00.
- Station collection uses `getCtprvnRltmMesureDnsty`; city statistics use `getCtprvnMesureSidoLIst` in statistics service. Station rows include mangName for urban-only province aggregation. Complete pagination must be checked before writes.
- `parseRLTMCtprvn`/`parseSidoCtprvn` parse host-local dates and permissive numbers. Grade mapping (24h versus 1h) and schema keys must remain. `saveAvgSidoArpltn` is not awaited and can fail after the run reports success.
- `cbKecoProcess`/`cbKecoSidoProcess` retry a whole failing province up to ten times, including terminal errors; request-level bounded retry must not be multiplied by these wrappers.
- `kecoController.getSidoArpltn` reads cityName empty for each of 17 names and silently drops both DB errors and absent rows. Nation route converts units after lookup, then fetches weather. Route reused by v000903 and earlier versions.
- `lib/AQI/airFallback.js` is the existing shared provider chain/cache/budget entry; normalized fallback retains provider, attribution and KST dataTime. Use it without writing substitute observations into AirKorea collections. Global air response deadline is in config/air.js.
- Existing AirKorea wall-time parser handles 24:00 and rejects invalid calendar dates. Extract to a shared small time module or reuse a matching pure parser without controller dependency.
- Prior operator evidence (`../issue-2581/operations.md`) shows auth rejection on 2026-09-29. Current entitlement not proven. Portal operation AJAX endpoint returned 404 during specification lookup; base service contract is verified in official public pages.

Sources (accessed 2026-09-29): https://www.data.go.kr/data/15073861/openapi.do ; https://www.data.go.kr/data/15073855/openapi.do . Public portal requires distinct development/operating approval; no secret values are included here.
Decision: PROCEED with supported offline contract and explicit operator verification gate. Do not claim production recovery.
