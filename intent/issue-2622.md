# Intent: WAQI fallback for domestic air and short WAQI station names — issue 2622

Revision 1, 2026-09-27. Owner: main agent for AK. Source: issue [#2622](https://github.com/WizardFactory/TodayWeather/issues/2622); AK: "pre-merge까지 진행"; amendment during intake: "측정소 이름이 너무 긴경우 가장 작은 단위로 전달할 수 있게 조정" (screenshot: overseas air detail with the WAQI station `Sasazuka, Shibuya, Tokyo, Japan (甲州街道大原渋谷区)`).

## Problem

When no nearby AirKorea station has an observation within eight hours, the v000903 KMA response has no `current.arpltn` and no `airInfoList`, so the app shows no air data (#2581 recorded this for Seoul, Gwangju, Daegu and Busan). WAQI, already used for overseas air, returned fresh observations for Korean coordinates on 2026-09-27. Separately, WAQI station names can be long multi-part addresses that do not fit the air detail row.

## Desired outcome and acceptance criteria

- AC1: With no fresh AirKorea observation and a fresh WAQI observation from a station inside the distance limit, `GET /v000903/kma/coord/…` returns `current.arpltn.source === "aqicn"`, numeric `pm10Value`/`pm25Value`, grades for the requested `airUnit` (`airkorea`, `airnow`), a non-empty `current.summaryAir` and `airInfoList[0].source === "aqicn"`.
- AC2: With a fresh AirKorea observation, WAQI is not called and `current.arpltn` equals the output without this change.
- AC3: WAQI error/timeout, `status !== "ok"`, an observation older than 8 h, a station beyond the distance limit, a missing `WAQI_SECRET_KEY`, and a failing `getArpLtnInfo` each leave `current.arpltn` absent and `summaryAir` omitted, and the route completes.
- AC4 (amended r1a): WAQI results are cached so that a second request for the same location within the cache period reuses them without calling WAQI — also when the second request is served by a different API worker process (shared Mongo cache); concurrent requests in one worker share one call.
- AC5: `/v000903/kma/addr/…` produces the same fallback result as the coordinate route for the same town.
- AC6 (amendment): A WAQI station name longer than the display limit is delivered as its smallest unit (first comma-separated part, without the parenthesized native name), in the domestic fallback and in the overseas DSF response `current.arpltn.stationName`; short names are unchanged.
- AC7: `npm --prefix server run test:offline` and the air response smoke pass on Node 16.20.2 and 22.22.2; PR CI passes.
- AC8: `docs/architecture/mobile-api.md` describes the fallback conditions, `arpltn.source`/`airInfo.source` values and the station-name rule.

## Scope

In scope: v000903 KMA route air middleware (`controllerTown.getKeco`, new fallback step, `controllerTown24h.makeAirInfoList`/`_getAirForecast`), a WAQI fallback module, a WAQI station-name helper used by it and by `controller.ww.units._makeArpltn`, offline tests/smoke, CI workflow for the smoke, docs.

Out of scope: the AirKorea collection cause and `_checkDateTime` timezone (#2581), per-pollutant merging with partial AirKorea data, older API versions and widget paths, client/web changes (attribution UI), WAQI terms review, deployment.

## Constraints

Service runtime Node 16.20.2 (ES5/ES2015 style like surrounding files); no key in logs or docs (public repository); KMA middleware order preserved; no change to existing Mongo collections or DB_DATA_VERSION (one new cache collection, identical for DB 1.0 and 2.0); tests use no production host or provider.

## Authority and endpoint

Endpoint pre-merge: implementation, tests, local smoke, commits, push to `ak-fork`, PR to `WizardFactory/TodayWeather` master, CI, independent verification and review/corrections. Excluded: merge, auto-merge, merge queue, deployment, permission or account changes, secrets.

## Risks and open questions

- WAQI republishes AirKorea data; an AirKorea outage is not covered.
- WAQI pollutant values are US EPA sub-indices; concentrations are approximations.
- In-process cache is per PM2 worker; WAQI request volume scales with workers × distinct locations.
- WAQI terms (attribution, commercial use) are unverified — recorded in the issue as a check for AK.

## Amendment 2026-09-27 (r1a)

Source: AK during intake — "캐시하여 두번째 호출에서 재사용할수 있게 설계시에 감안해줘". The service host runs ten PM2 cluster workers (`docs/architecture/ec2-internals.md`), so an in-process cache would rarely serve a second request. AC4 now requires a cache shared across workers: a new Mongo collection with an expiry (TTL) index, plus in-process sharing of in-flight calls. Scope adds the cache model; existing collections and `DB_DATA_VERSION` handling are unchanged.

## Amendment 2026-09-27 (r1b)

Source: build findings. (1) AC3 lists "a failing `getArpLtnInfo`" among no-air cases; with the fallback in place a failing AirKorea lookup is exactly when WAQI should be used. AC3 now reads: a failing `getArpLtnInfo` never breaks the route; with WAQI unavailable the response has no air, with WAQI available the fallback is used. (2) The observed service host runs Node 10.15.3 (`docs/architecture/ec2-internals.md`, CI `vc-node10`), while `server/.nvmrc` targets 16.20.2. AC7 adds a Node 10.15.3 check of the fallback module, cache and middleware (`waqi-air-node10-check.js`), in addition to Node 16.20.2 and 22.22.2.
