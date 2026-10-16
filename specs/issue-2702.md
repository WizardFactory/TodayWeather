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

## S17b: direct routes and town

`server2::api::DirectRoutes` answers the legacy direct public routes before the gateway routes
when their entry is listed: `kma` (`/v000903/kma/addr`), `kma-v000901` (`/v000901/kma/addr`) and
the new `town` entry (`/v000803/town`, `/v000705/town`). Mounts and route literals match
case-insensitively, as in Express, and `req.baseUrl` keeps the requested spelling (an upper-case
`/V000901/KMA/ADDR` drops `req.version`, so the reply has no `location`). The mount itself (with
or without a trailing slash) answers the legacy usage JSON of `router.get('/')` (v000901 address
and both town routers). Unlisted paths keep the previous 404; other methods are never claimed. Direct `/v000902/kma/addr` is zero-observed and not claimed.

- **Town router lists** (`routes/v000803/routeTownForecast.js`, `routes/v000705/routeTownForecast.js`):
  no `checkQueryValidation` (no query defaults, no `req.version`), `insertSkyIcon` (upper case),
  `getSummary` (ControllerTown: yesterday and `makeSummary` before any unit conversion,
  `controllerTown.js:2316`). v000803 ends with `makeResult` (no `location`, since `req.version` is
  unset) and `sendResult`. v000705 adds `dataToFixed` (`controllerTown.js:3142`) and has no
  `makeResult`, so `sendResult` answers `res.json(undefined)`: 200, `Content-Type:
  application/json`, an empty body and no ETag. The v000705 sub-routes `/mid`, `/short`,
  `/shortest`, `/current` run their own lists; the report's `{location}` normalization cannot
  show them unused.
- Without query defaults, `makeSummary`'s `rn1 + units.precipitationUnit` is JavaScript `+` with
  `undefined`: `NaN`, written as `null`.
- **Express envelope** (Express 4.13.4): `res.json` with `application/json; charset=utf-8` and a
  weak ETag; `res.status(400).send(text)` with `text/html; charset=utf-8` and an ETag;
  `fresh` 0.3.0 revalidation for 2xx GET/HEAD (exact tag or `W/` + tag, `*`, `no-cache` and
  `If-Modified-Since` without `Last-Modified` never fresh) with Express's 304 headers; HEAD
  without a body (`res.json(undefined)` then has no Content-Length, which Node adds only to a
  GET); `cors()` and `X-Powered-By`. The locale is i18n 0.8.3 `init` (`twcookie`
  cookie, then Accept-Language). The app-wide session cookie is not emitted (S12 precedent).
- **Forwards.** An outcome legacy must answer (`Outcome::Legacy`: the S15b forwards S15b-4a
  kept, such as a town absent from the town list, the S15 `next(err)`/uncaught-exception
  forwards, a panic) or a path no native route
  parses takes the legacy hop unchanged (method, path, query, end-to-end headers; legacy status,
  headers and body back; hop-by-hop headers, including those a `Connection` header lists, are
  dropped in both directions; the request target is written verbatim, without resolving `..`
  or `%2e` segments, so direct routes require the plain-HTTP loopback legacy origin and an HTTPS
  `SERVER2_GATEWAY_LEGACY_URL` with a direct entry refuses startup). The v000705 `/short`, `/shortest`, `/current` replies without
  `midData` are legacy 500s from `next(err)` and are forwarded like every S15 `next(err)`;
  reproducing Express's 500 natively remains open.

## S17c: nation composition

`kma` also claims GET/HEAD `/v000903/nation/:nation`; `kma-v000901` claims
`/v000901/nation/:nation`. Express case-insensitive mounts and the optional trailing
slash remain supported. The legacy route returns `nation: "KR"` for every decoded
nation parameter; the server does not invent a country-validation rule.
Uppercase `V000903` is claimed but defaults child version to v000901, matching legacy
query validation. Child locale comes only from `Accept-Language`, defaulting to English
without the header; the parent locale cookie is not forwarded to child requests.

Fifteen city responses use native KMA backends and legacy version rules with one absolute
three-second deadline. City `airInfo` and `airInfoList` are removed, preserving all
other fields and legacy city order. A real failed child request gives the legacy
500 rendered-error response (AK's approved option b); successful dependencies give
200. Missing provider branches remain the existing KMA partial-data contract.
No native nation request contacts legacy. URI decoding failures give a rendered
400 response. Error output omits the legacy session ID because native routes do
not run legacy session middleware; no cookie or arbitrary identifier is invented.

NationAir reuses the process S3 source and the existing nationwide acquisition.
Only the newest urban-observation hour within each province contributes, with
per-pollutant denominators and legacy rounding/schema selection. The shared raw
records also retain the national province label in memory. `전남광주` is separated
using the station-list address; an unresolved label is not guessed. Fresh stored
province means take priority. Missing, invalid, future or eight-hour-old means
fall back to the legacy fixed representative points, at most four concurrently,
with the correct coverage label and enumerated per-province reasons. Deadline
release returns available rows; owned acquisition continues and feeds later
requests. No new provider call method, mode, endpoint setting or durable derived
weather store is introduced.
