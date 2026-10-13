# Contract: AirKorea key selection and supported metadata/forecast/nearby operations
Inputs: [intent](../intent/issue-2636-r2.md), [issue-2636 spec](issue-2636.md), AirKorea documents (air pollution information v1.4, station information v1.2, statistics v1.3) and 2026-10-13 read-only probes. Base: `8c3a703c`.

## Key selection (AC1)
`airkoreaObservation.create()` gains a key-selecting request path used by all five operations. Input: the configured key list (raw or percent-encoded). Order: start from the remembered working index, otherwise the last configured key (the previous behavior). On an invalid-credential failure, try the next untried key in descending order, wrapping once, until every key was tried. Invalid-credential failures are:

- provider codes `20` (access denied), `30` (key not registered), `31` (key expired) and `32` (unregistered IP), from a JSON envelope, an `OpenAPI_ServiceResponse` gateway body or an XML body;
- HTTP 401 and 403, classified from the body when possible;
- a placeholder, empty or malformed key (`NO_KEY`, `INVALID_KEY_ENCODING`).

Quota (`22`), other provider codes, transport errors, timeouts, HTTP 5xx and payload validation errors return immediately after the existing single transient retry; they do not change the key. When every key fails as invalid, the error code is `NO_VALID_KEY` and carries no key text. The remembered index is per client instance and is updated only after a successful envelope. Logs record operation, key index and stable codes only.

## Supported operations (AC2)
| Operation | Service path | Parameters | Validation |
| --- | --- | --- | --- |
| station realtime | `ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty` | unchanged | unchanged |
| sido hour | `ArpltnStatsSvc/getCtprvnMesureSidoLIst` | unchanged | unchanged |
| station list | `MsrstnInfoInqireSvc/getMsrstnList` | `numOfRows=100`, paged; no `ver` (keeps the long-standing `dmX`=latitude, `dmY`=longitude order that `parseMsrstnList` and the swap guard expect) | complete pages; every item has a string `stationName`; returns `{list}` |
| dust forecast | `ArpltnInforInqireSvc/getMinuDustFrcstDspth` | `searchDate=YYYY-MM-DD`, `ver=1.1` | resultCode `00`, `items` array; pagination fields are not enforced because the provider ignores paging for date searches; item count ≤ 200; returns `{list}` |
| nearby station | `MsrstnInfoInqireSvc/getNearbyMsrstnList` | `tmX`, `tmY`, `ver=1.1` | resultCode `00`, `items` array; returns `{list}` |

All requests use HTTPS, `returnType=json`, the existing whole-attempt timeout, byte limit and single transient retry. Response bodies, URLs and keys are not logged. The legacy domain constants, `_jsonRequest`, `_checkLimit` and key-index recursion are removed. `getStationNameFromMsrstn` keeps its behavior for `{list:[...]}`.

Forecast parsing keeps `_parseFrcst` and `_saveFrcst` (filter by `dataTime`, `informGrade` split, nine image URLs). `ver=1.1` adds images 7–9 with no schema change: `imageUrl` stays an array.

## Failure behavior
- Station list failure at startup: logged with a stable code; gather startup continues (unchanged).
- Forecast failure: `getMinuDustFrcstDspth` returns the error; `AirkoreaHourlyForecastCtrl` still runs (unchanged).
- Nearby failure: `_appendFromKeco` returns the error (unchanged; no current production caller of `appendData` was found).

## Verification
Offline (node:test, injected transport): invalid-key skip order and memory, wrap-around, quota stop without rotation, all-invalid `NO_VALID_KEY`, HTTP 401/403 gateway body classification, no key in logs/errors, URL/parameters per operation, forecast/station-list/nearby envelopes and failure paths, consumer shapes through `getAllMsrStnInfo` parsing, `_getFrcst` + `_parseFrcst`, `getNearbyMsrstn` + `getStationNameFromMsrstn`, and a source check that no `openapi.airkorea.or.kr` request URL remains.
Real: read-only call of the five operations through the new client using the configured key list (expired/unregistered keys included, so failover is exercised), and an isolated local run of station/sido collection, station metadata and forecast against local Mongo with readback through `kecoController`.

Rejected alternatives: rotating keys on quota (quota bypass, rejected in the issue-2636 spec); config-only reordering (leaves collection broken whenever the last key expires, which is how it failed); hostname-only replacement (different contract).
