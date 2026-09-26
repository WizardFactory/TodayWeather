# Spec: Overseas weather on Visual Crossing instead of Dark Sky — issue 2585

Revision 1, 2026-09-26. Consumes [intent](../intent/issue-2585.md) r1 and the investigation report. No source changes at this stage.

## Requirements

| ID | Requirement | AC |
| --- | --- | --- |
| R1 | New `server/lib/VC/vcRequester.js`. **Request:** `getTimeline({lat, lon, range}, key, callback)` calls `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/{lat},{lon}/{yesterday/next7days \| today/next7days}` with `unitGroup=us`, `lang=en`, `include=days,hours,current` and a fixed `elements` list. It uses a keep-alive `https.Agent`. **Timeouts and retry:** a 2.5 s overall timeout per attempt. A 429 is retried once after 300 ms, only while under 1.5 s has elapsed. **Validation:** fails on HTTP ≥ 400, unparsable JSON, or a body without `days[]`/`timezone`/numeric `tzoffset`. **Logging:** one info line per call with range, status, `queryCost` and latency. **Key safety:** an empty or placeholder key fails before any network call; the key never appears in logs or error messages. | AC2, AC4 |
| R2 | New `server/lib/VC/vcConverter.js` exports `toDarkSkyDocs(vc, now)`. It returns Dark Sky-format documents `{timezone, offset, currently, hourly:{data}, daily:{data}}` for `yesterday` (combined range only), `today` and `current`. **Day assignment:** days are matched by the local date string of `now` at `tzoffset`. **Record times:** yesterday and today use local midnight computed from `now` and the offset; current uses `now` truncated to seconds. **Content:** yesterday/today hold that day's hours and one daily row; current holds hours from the current hour to +48 h and daily rows today…+7. **Units:** as Dark Sky `us`: °F, mph, miles, hPa, in/h, fractions for humidity/cloud/probability. **Daily fields:** `precipIntensity` = day total / 24; max/min temperature, apparent temperature and precipitation times are derived from the day's hours. | AC1, AC2 |
| R3 | **Summary vocabulary** for `makeWeatherType`, applied per hour, current and day. **Wet** means the Visual Crossing icon is `rain`/`snow`, or observed precipitation > 0. **Precipitation type:** `snow` together with rain/freezing rain/ice gives `sleet`; freezing rain or ice alone gives `sleet`; otherwise `snow` or `rain`. **Intensity** (hourly in/h, daily in/day ÷ 24) selects the text: < 0.098 → `light <type>` (`possible light <type>` for a forecast with no amount), < 0.3 → `<type>`, else `heavy <type>`. **Otherwise:** thunder in `conditions` → `thundershowers`; `fog` icon or visibility < 0.62 mi → `fog`; `wind` icon → `windy`; else cloud cover ≤ 20 `clear`, ≤ 50 `partly cloudy`, ≤ 80 `mostly cloudy`, else `overcast`. **Icon:** Visual Crossing's icon, with `rain`/`snow` changed to `sleet` for sleet; the icon for observed wet hours becomes the precipitation type. | AC1 |
| R4 | `DsfController.getDsfData`. **Freshness:** unchanged DB read and 15-minute current rule. `yesterday` is any stored record in yesterday's local 00:00–01:00 window; the missing-hour drop and refetch loop are removed. **Fetch decision:** no provider call when current, today and yesterday exist. Otherwise it fetches `combined` when yesterday is missing, else `forecast`. Returned documents go through the existing `_parseData`/`_makeDbFormat` (offset from `tzoffset`, `address.country` = IANA zone) and are upserted. **Google:** the time-zone lookup is not called. **Failure:** if the fetch fails but current and today exist, the output is returned without yesterday. | AC1, AC2 |
| R5 | **Single-flight.** New model `VcFetchLock` (`_id` = location key, `expireAt` with TTL index). **Acquire:** insert. On a duplicate key, take over only when `expireAt` < now. **Holding the lock:** 10 s. The holder re-reads the DB before fetching and releases in all paths. **Non-holders:** re-read every 250 ms for up to 2.5 s until current and today exist. On timeout they return what exists, or an error if there is no current. | AC3 |
| R6 | **Response source.** `dataSort` sets `source = "VC"`, and the merge functions write `pubDate.VC` instead of `pubDate.DSF`. Internal names (`req.DSF`, `/dsf/coord`, `type:'DSF'`) are unchanged. | AC1 |
| R7 | **Push.** `controllerPush.requestDailySummary` routes `VC` and `DSF` to the overseas summary. `alert.push.controller` maps `VC`/`DSF` to the `/dsf/coord` path and parses both. Model comments list `VC`. | AC6 |
| R8 | **Legacy requester and config.** `server/lib/DSF/dsfRequester.js` has no Dark Sky URL and returns a "retired" error without network. Config adds `keyString.vc_key` from `VC_SECRET_KEY`; `.env.example` lists the name. `v000803` `route.geo.js` accepts `VC` in its length check. | AC4, AC5 |
| R9 | **Apps** (`client/www`, `tw.ios`, `ta.ios`): `pubDate.VC` sets `source = "VC"`. Templates show a tappable "Weather Data Provided by Visual Crossing" that opens `https://www.visualcrossing.com/` when `source == 'VC'`. The `tw.ios` default source is `VC`. | AC7 |
| R10 | **Web.** `packages/weather-core` has source type `"KMA" \| "VC"`, recognises `VC` (or a missing source with `pubDate.VC`) and takes `publishedAt` from `pubDate.VC`. `web/src/state.ts` whitelists `VC`. `Weather.tsx` shows "해외 날씨 (Visual Crossing)" and the linked attribution. `App.tsx` info text, demo data and tests are updated. | AC7 |
| R11 | **Docs.** `weather-collection.md` (DSF section), `mobile-api.md`, `docs/rewrite/external-providers.md` (W1, W4/W5, X2), `configuration-inventory.md`, `web-client.md`, the world-cache sequence Archify JSON/HTML and the webapp diagram label. The offline README lists the new tests. | AC9 |

## Interfaces and data

- **Response shape unchanged** except `source` (`DSF` → `VC`) and the `pubDate` key.
- **`DsfForecast` documents:** same shape, and they coexist with old Dark Sky documents until `maintainDB` purges them (2 days).
- **New collection** `vc.fetch.locks`: `{_id: "<lon>,<lat>", expireAt}` with a TTL index.
- **Visual Crossing call:**
  - Key via `?key=`.
  - `elements=datetime,datetimeEpoch,temp,tempmax,tempmin,feelslike,feelslikemax,feelslikemin,humidity,precip,precipprob,preciptype,snow,windspeed,winddir,pressure,visibility,cloudcover,conditions,icon,source,sunriseEpoch,sunsetEpoch,moonphase`.

## Normal and failure behavior

| Situation | Provider calls | Result |
| --- | --- | --- |
| Cache fresh (current ≤ 15 min, today, yesterday) | 0 | Stored data |
| First request of a local day | 1 combined (25 records) | Three records saved |
| Stale current, yesterday stored | 1 forecast (1 record) | today/current upserted |
| Concurrent requests, same location | 1 | Others wait ≤ 2.5 s, then read the stored result |
| Provider error, stored current/today exist | 1 (failed) | Stored data, no yesterday |
| Provider error, nothing stored | 1 (failed) | Error → existing 5xx path; the Lambda retry reads after completion |
| Missing key | 0 | Error, logged without the key |

## Security, UX, observability

- **Key safety:** only `VC_SECRET_KEY` holds the key. It never appears in errors, logs or fixtures; fixtures are checked for the key string when recorded.
- **Attribution:** as required by the Free/Metered plans.
- **Logs:** `VC>` lines with range, status, cost and latency; lock contention and takeover; fetch fallbacks.

## Compatibility and migration

- **Released apps** do not recognise `VC`: no attribution, and new push registrations carry no overseas source (the server routes them by geo). This is accepted by AK; updated apps are required.
- **Existing push registrations** stored with `DSF` keep working.
- **No DB migration.**
- **Rollback:** revert. The old code would call the retired Dark Sky again.

## Verification strategy

- **Unit tests** (`server/test/offline/vc-weather.test.js`, production modules loaded in a VM):
  - R1: URL, parameters and elements; timeout; one 429 retry; missing key; no key in logs/errors.
  - R2/R3: live-recorded fixtures for Tokyo, London and New York (combined), Tokyo forecast-only; synthetic snow/sleet/fog/thunder rows; DST-independent day assignment.
  - R4/R5: fake model/requester; call counts, fresh/stale/yesterday cases, contention, takeover, failure fallback; Google not called.
  - R7: push URL and parser.
  - R8: no `darksky.net` in runtime sources; fail-fast requester.
- **Route smoke** (`vc-weather-smoke.js`):
  - Real v000903/v000902, v000901 and `/ww/:version/:category/:days` routers, full middleware, in-memory `DsfForecast` and lock.
  - Fixture requester; asserts the response contract, units, `source`/`pubDate`, yesterday/current, and zero provider calls on the second request.
  - Optional `TW_VC_LIVE=1` switches to the real requester with `VC_SECRET_KEY` (additional live smoke).
- **Regression:** `test:offline`, RSS/air/weather-desc/daily/precipitation/riseset smokes on Node 16.20.2 and 22.22.2; `npm test` (vitest) for weather-core and web.
- **Not run here:** EC2 latency, a real Mongo TTL/lock under ten workers (unit-tested with the model contract), mobile builds.

## Alternatives

- **Keep Dark Sky's per-day Time Machine pattern** (up to 5 calls): rejected. It costs more and is slower.
- **New storage schema/response model** (Phase 2): deferred; it needs a contract change.
- **In-process single-flight only:** rejected. Ten PM2 workers and the Lambda retries hit different processes.
- **Open-Meteo:** rejected by AK (not observation-based for yesterday).

## Risks

- **Weather text:** the wording is derived and may differ from the Dark Sky wording.
- **Lock waiters:** can time out on a slow provider. The next Lambda attempt reads the saved result.
- **Free-plan concurrency:** with the Free plan's concurrency of 1, fetches for different locations at the same moment can still 429. They are retried once; the launch-plan triggers cover the switch to Metered.

## Amendment 1 — 2026-09-26

Source: independent verification (fresh context), CHANGES_REQUIRED: F1 HIGH, F2 MEDIUM, F3–F6 LOW (`reports/sdlc/issue-2585/independent-verification.md`, local).

- **R1:** the 2.5 s timeout covers the whole call. The 429 retry runs only while time remains within that budget, instead of starting a fresh 2.5 s timer (F4).
- **R2:** the top-level `tzoffset` is the offset at the **start of the requested range** (verified live for Pacific/Auckland: 12 for a range from 09-26, 13 from 09-28). The offset used for day assignment, record midnights and `timeOffset` is now the one in effect at `now`, taken from the latest hour row at or before `now` (local `datetime` against `datetimeEpoch`); `tzoffset` is the fallback (F1). Exact 0 temperatures are emitted as 0.01 °F, which displays as 0.0 °F / −17.8 °C, because `_parseData` maps 0 to the −100 sentinel (F2).
- **R4:** a yesterday record counts only when its `pubDate` is at or after the end of that local day. The previous day's last `today` refresh holds forecasts for its later hours, so the first request of a day makes one `combined` call (F5). This matches intent AC2.
- **R5:**
  - `_acquireLock` returns an owner token (its `expireAt`), and `_releaseLock` deletes `{_id, expireAt: token}`, so a late holder cannot delete a lock another worker took over (F3).
  - After a failed fetch the lock is not released and expires after 10 s. This limits a failing location to one provider attempt per 10 s (F6). Superseded by Amendment 2.
- **Known limitation, unchanged:** the world merge displays all hours with one fixed offset. On the day after a DST change, the hour before the change can be missing from "yesterday at this hour" for the first hour (placeholder).

## Amendment 2 — 2026-09-26

Source: independent verification iteration 2 (PASS_WITH_NOTES), finding N1 MEDIUM. With a 10 s backoff, waiters cannot see a failure, so every request in those 10 s waits about 2.5 s and fails; the gateway's retry after 3 s also falls inside the window.

**R5 (revised):** after a failed fetch, the holder moves its lock's `expireAt` to 2 s ahead (`updateOne` matching its own token) instead of releasing it. A failing location makes at most one provider attempt per 2 s, and the gateway's next attempt (after its 3 s timeout) can take over and fetch.

N2 (DST display limitation), N3 (a fetch at exactly local 00:00:00 costs one extra `forecast`) and N4 (25 records per location per local day, as intended by AC2) are accepted and recorded in the PR.
