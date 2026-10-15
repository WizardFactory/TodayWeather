Task: issue-2702-s17; owner: Claude builder (S17 worktree); revision/base: 1d60f728; date: 2026-10-15.
Authority: AK authorized S17 on 2026-10-15 (relayed by the root coordinator); endpoint pre-merge.
Issue: [#2702](https://github.com/WizardFactory/TodayWeather/issues/2702). Declaration record:
[intake comment](https://github.com/WizardFactory/TodayWeather/issues/2702#issuecomment-6193953948).

# Specification

## Scope and split

S17 ports the used older weather versions, nation and town. It reuses the S15 KMA assembly
(`server2::domestic::kma`) and the S15b S3 input source; no family adds a legacy forward of its own
beyond the S15 `Native::Forward` that S15b-4 removes for every KMA version together.

| Slice | Public paths (2026-08-23..09-22 requests) | Legacy handler |
| --- | --- | --- |
| S17a | `/weather/coord` (155,998, backend v000901), `/weather/v000901/coord` (51), `/weather/v000902/coord` (47) | gateway -> `/v000901/kma/addr`, `/v000902/kma/addr` |
| S17b | `/v000901/kma/addr` (1,853), `/v000803/town` (205), `/v000705/town` (12) | `routes/v000901/route.kma.addr.js`, `routes/v000803/routeTownForecast.js`, `routes/v000705/routeTownForecast.js` |
| S17c | `/v000903/nation/KR` (139), `/v000901/nation/KR` (1, failure only) | `routes/v000803/route.nation.js` |

Zero-observed public routes in the accepted report scope are not ported: direct
`/v000902/kma/addr` (its router is still needed as the `/weather/v000902` backend), the v000901 and
v000902 `/kma/coord` forms and `/weather/.../addr`.

## S17a: v000901 and v000902 address assembly

`assemble(request, store, now, config)` selects the router list by `KmaRequest::version`
(`req.baseUrl` segment). v000901 and v000902 share the first 23 v000903 steps (through `getKeco`)
and continue with:

`getKecoDustForecast, getRiseSetInfo, insertIndex, makeAirInfo, AirForecast, <icon>, setYesterday,
convertUnits, insertStrForData, getSummaryAfterUnitConverter, makeResult, sendResult`

where `<icon>` is `insertSkyIcon` (`_parseSkyState`: `Sun`, `MoonSmallCloud`, `CloudRain`, ...) for
v000901 and `insertSkyIconLowCase` for v000902. They have no `getAirFallback` and no
`getSpecialInfo` step (legacy route files, master `1d60f728`).

- `makeAirInfo` (`controllerTown24h.js:1017`): one `req.airInfo` from the fresh rows of the first
  station (`req.arpltnList`, `_freshAirDetailRows`) and the daily dust forecasts; exceptions are
  logged only.
- `AirForecast` (`controllerTown24h.js:1243`): `_getAirInfo` creates `{source: "airkorea"}` when
  absent, then `_getAirForecast` for that object (the S15 `air_forecast` store call); a failure is
  logged only. `makeResult` then emits `airInfo` (no `airInfoList`).
- `makeResult` adds `location` for `version >= "v000901"` as in S15.

`backend::parse_path` accepts `/{v000901|v000902|v000903}/kma/addr/{region}[/{city}[/{town}]]`.
`select_native_versions(dispatcher, source, versions)` registers one `KmaBackend` for each listed
version. The S15b `S3Source` is version independent (`_findTown`, grid/RSS/mid, air, life,
warnings), so the same snapshot serves every version; a v000901/v000902 assembly never calls
`air_fallback` or `special_zones`.

## Routing (S17a)

`SERVER2_NATIVE_FAMILIES` gains `kma-v000901` and `kma-v000902` beside `kma` (v000903). Any of the
three builds the one S3 input source (S3 settings and `DONGNAE_SECRET_KEYS` then required) and
selects only its own version; unknown or repeated entries refuse startup. Removing an entry and
restarting is its rollback. No other setting or mode is added.

## History catch-up (O-1/O-11)

The older versions read the same `KmaStore` calls as v000903 (`town_model` current rows,
`stn_hourly_and_min_rns`, `city_hourly`, `history`). Their history coverage is therefore the S14
coverage plus the S15b-2 ASOS composition; the v000901/v000902 recording includes the ASOS
`history-*` cases. No version-specific history store exists.

## Parity contract

- A pinned Node 16.20.2 oracle records both routers through the maintained offline harness
  (S15 driver with only the router, mount and scenario list changed), with every store answer and
  argument in order. Each recording replays to the same bytes and ETag with every recorded call
  used, or forwards for the two S15 declared reasons.
- The S02 goldens `domestic-v000901`, `domestic-v000901-db1`, `domestic-v000902`,
  `domestic-v000902-db1` equal their recordings; `gateway-default-domestic`,
  `gateway-v000901-domestic`, `gateway-v000902-domestic` match on the wire (status, body, headers
  except `date`/`connection`) with the native switch, the legacy default and the rollback.
