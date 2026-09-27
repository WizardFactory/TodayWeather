# Spec: WAQI fallback for domestic air and short WAQI station names — issue 2622

Revision 3, 2026-09-27 (r2: shared Mongo cache per intent r1a; r3: cache document keyed by `_id` with `expireAt`, following `vc.fetch.lock.model.js`). Consumes [intent](../intent/issue-2622.md) r1a and `reports/sdlc/issue-2622/investigation.md`.

## Requirements

- R1 `getKeco` error path: when `_getTownInfo` or `getArpLtnInfo` fails (or returns no object), log and call `next()` without dereferencing; record `req.airGCoord = townInfo.gCoord` when available.
- R2 New middleware `ControllerTown24h.getWaqiAirFallback`, inserted after `getKeco` in the v000903 KMA router list. It runs only when `req.current.arpltn` has no finite `pm10Value`, `pm25Value`, `o3Value`, `no2Value`, `coValue`, `so2Value` or `khaiValue`. Coordinate: `req.gCoord` (`{lat, lon}`), else `req.airGCoord`; without one it is a no-op.
- R3 New module `server/lib/AQI/waqiAirFallback.js`:
  - Key from `config.keyString.aqi_keys[0].key`; empty or the placeholder (`You have to set key of WAQI`) disables the fallback (reason `no-key`, no request).
  - Request `GET https://api.waqi.info/feed/geo:<lat>;<lon>/?token=<key>` with axios, timeout `REQUEST_TIMEOUT_MS = 3000`, no retry. Logs never include the token.
  - Accept only `status === "ok"` with `data.time.iso` (or `s`+`tz`) within `FRESHNESS_HOURS = 8` before the request time (and not more than 1 h in the future), and `data.city.geo` within `MAX_STATION_DISTANCE_KM = 30` of the request point (haversine).
  - Map to the AirKorea `arpltn` shape: `source: "aqicn"`, `stationName` (R5), `dataTime` KST `YYYY-MM-DD HH:mm`, `pm10Value`, `pm25Value`, `o3Value`, `no2Value`, `coValue`, `so2Value` from `iaqi` via `AqiConverter.extractValue` (+ `ppb2ppm` for o3/no2/so2), dropping missing or negative values. No grades: `recalculateValue` computes them for the requested unit. Reject when neither pm10 nor pm25 is present.
  - Cache (AC4, shared by all API workers): new model `server/models/waqi.air.cache.model.js` (collection `waqi.air.caches`, same style as `vc.fetch.locks`) with `{_id: cell, outcome: 'ok'|'failed', reason, feed: {name, geo: [lat, lon], time: ISO string, iaqi: {code: number}}, fetchedAt: Date, expireAt: Date (TTL index, expires 0)}`. The cell is the coordinate rounded to 0.01° (`"37.57,126.98"`); request coordinates are the town's stored `gCoord`, so every request for a town uses one cell. Read `find({_id: cell}).limit(1).lean()` and use the row only while `expireAt > now` (the TTL monitor deletes lazily). On a miss, fetch once and `updateOne({_id: cell}, {$set: row}, {upsert: true})`. TTLs: `CACHE_TTL_MS = 30 min` for an `ok` feed (WAQI publishes hourly; freshness/distance are evaluated per request on the cached feed), `FAILURE_CACHE_TTL_MS = 2 min` for transport, timeout, HTTP or non-`ok` status. Concurrent calls for the same cell in one process share one in-flight fetch. Cache read/write errors are logged and treated as a miss / ignored. The collection is the same for DB 1.0 and 2.0.
  - API: `getArpltn(gCoord, requestTime, callback(err, arpltn, reason))`; never passes an error for provider failures (reason instead). Tests inject `axios`, the model and `Date` through the module loader; no test-only exports.
- R4 When the fallback returns an observation: `req.current.arpltn = arpltn`, `req.arpltnList = [arpltn]`, `req.arpltnStnList = [[arpltn]]` (replacing stale AirKorea station lists). `makeAirInfoList` sets `airInfo.source = last.source === 'aqicn' ? 'aqicn' : 'airkorea'`. `_getAirForecast` returns the airInfo unchanged for `source === 'aqicn'`. The daily AirKorea dust forecast (`midData.dailyData[].dustForecast`) is still attached.
- R5 `server/lib/AQI/waqiStationName.js` `shorten(name)`: if `name` is longer than `STATION_NAME_MAX_LENGTH = 20` characters, return the first comma-separated part of the name with any parenthesized part removed, trimmed; if that is empty return the original. Otherwise return the name unchanged. Used by R3 and by `controller.ww.units._makeArpltn` for `arpltn.stationName`.

## Interfaces and data

- Response additions: `current.arpltn.source` and `airInfoList[].last.source` = `"aqicn"` only for WAQI-derived objects; `airInfoList[].source` = `"aqicn"` for those. AirKorea objects keep their shape and `source: "airkorea"` on airInfo.
- One new Mongo collection (cache only; safe to drop). No change to existing collections, DB version or clients. Older API versions unchanged. Overseas: only `stationName` text changes for long names.

## Failure behavior

Every WAQI failure yields today's no-air response. Added latency is bounded by one 3 s request per location per 2–10 min per worker. A thrown exception inside the middleware is caught and logged; `next()` is always called once.

## Security and observability

Token only in the request URL; log lines contain lat/lon, reason, station name and age. One `info` line per fallback use, `warn` for provider failures.

## Alternatives rejected

- Reusing `controllerAqi.requestAqiData`: Mongo writes keyed by exact coordinate, `request`+TLSv1 with up to 5 retries (≈18 s), deletes old rows per call.
- In-process cache only: with ten PM2 workers a second request usually lands on another worker (AK asked for reuse on the second call).
- Reusing the world `aqi` collection: keyed by exact request coordinate and measurement time, pruned by the world path; different semantics.
- Always shortening names: AK asked for shortening only when too long.

## Verification strategy

- Unit (node:test, VM-loaded modules): mapping, freshness, distance, key missing, status, errors, Mongo cache hit/expiry/failure TTL and in-flight sharing, station name rule, `makeAirInfoList` source, `_getAirForecast` skip, `getKeco` error path, ww.units station name.
- Route smoke (real v000903 router in the offline harness; real axios HTTP to a loopback fake WAQI): AC1–AC5 on DB 1.0 and 2.0 for `airkorea` and `airnow` units.
- Real-Mongo cache smoke: two separately loaded fallback module instances (two workers) against mongodb-memory-server and a loopback WAQI → one HTTP call; TTL index present.
- Optional live smoke against api.waqi.info (read-only, local only).
- Node 16.20.2 and 22.22.2; `test:offline`; CI.

Design (Archify): the mobile API air flow gains a conditional provider edge. Decide in plan after checking whether an existing diagram shows air providers.
