# Gather source reconciliation (#2555)

This is a source reconciliation against public `master` baseline `87b8855f308611a07897cd3a39c45fefb3088d77`, using the [issue's embedded source appendix](https://github.com/WizardFactory/TodayWeather/issues/2555). The investigator reported gather disk HEAD `57e5a242f06286389af5ae64a4c6a02a6297fb04` plus uncommitted changes, rechecked on 2026-09-24. These are issue-supplied observations, not this implementer's live inspection. The EC2 commit is not fetchable and was not imported. No production access is needed for this PR.

## Compatibility implemented

[collectTownForecast.js](../../server/lib/collectTownForecast.js) retains HTTP explicitly, as observed, and uses `apis.data.go.kr`:

| Product | Path |
| --- | --- |
| TOWN_CURRENT | `/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst` |
| TOWN_SHORTEST | `/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst` |
| TOWN_SHORT | `/1360000/VilageFcstInfoService_2.0/getVilageFcst` |
| MID_FORECAST | `/1360000/MidFcstInfoService/getMidFcst` |
| MID_LAND | `/1360000/MidFcstInfoService/getMidLandFcst` |
| MID_TEMP | `/1360000/MidFcstInfoService/getMidTa` |
| MID_SEA | `/1360000/MidFcstInfoService/getMidSeaFcst` |

Success is `00`. Every request starts with `pageNo=1&numOfRows=999`. Since #2590 a full first page whose `totalCount` is larger is followed by sequential requests for pages 2..n (only `pageNo` changes; at most 5 pages). Each continuation page must pass the same envelope checks, repeat `totalCount`, hold exactly the remaining rows up to 999, add no row already seen (same category/date/time/grid) and, when the body echoes `pageNo`/`numOfRows`, match the request. The merged rows must equal `totalCount` before any organizer runs. A first page shorter than 999 with a different `totalCount`, or any failing page, fails the grid without publishing or storing a prefix. The failure reason stays one of the static strings; the warning's metadata adds `page` and `check` (`pageNo`, `rows`, `limit`, `echo`, `duplicate`, `totalCount`, or `response` for a continuation page's transport/HTTP/XML/envelope failure), so repeated failures can be told apart in the gather log. The short forecast (`getVilageFcst`, issue-reported `totalCount` 1,016) therefore costs two requests per grid; single-page products are unchanged. No retry-policy change is introduced. Day-3–10 sea wave fields each read their own source field; distinct-value fixtures cover every field, including nonfinite values in days 4–7.

The existing service-key string interface accepts raw URI-unescaped strings or strings with exactly one layer of URI percent encoding. Normalize by decoding percent escapes once, then encoding the entire value as a query component; a raw `+` is a literal plus, never a space. A literal percent must be supplied as `%25`; malformed percent escapes and missing/empty strings are rejected with static diagnostics. Already encoded keys are not double-encoded. No form decoding or repeated decoding is performed, and no configuration values are inspected.

HTTP failures, invalid XML, missing envelopes/headers, invalid/nonpositive counts, malformed or empty items and invalid/empty organized batches use controlled failure events; request callbacks also report organizer failures. Logs use local diagnostic messages without request keys/URLs, raw transport/parser errors or raw response dumps. These offline checks establish no provider availability, authorization renewal or transport security improvement. Any HTTPS migration requires separate justification and operator verification.

PCP maps to `r06`, SNO to `s06`, TMP to `t3h`. Explicit `강수없음` and `적설없음` become zero. Complete finite decimal quantities (optional matching `mm` for PCP/RN1, `cm` for SNO, surrounding whitespace) are supported. Since #2583, category text such as `1~4`, `1.0mm 미만` or `50mm 이상` becomes a representative amount (midpoint, half the threshold, lower bound) and the text is stored in `r06Text`/`s06Text`/`rn1Text` so the service keeps the bounds ([parser](../../server/lib/kmaPrecipitation.js), [amount contract](mobile-api.md#forecast-precipitation-amounts-issue-2583)). Blanks, unknown strings, infinities and negative precipitation still become the existing `-1` missing sentinel. The deployed gather code in the #2555 appendix uses `parseFloat` (a category becomes its lower bound, and RN1 `강수없음` becomes `-1`); rows it stores have no text and are read as exact amounts. TMP accepts signed finite decimals or `-50` missing; invalid required temperature rejects the batch. All short/shortest groups are checked, not just the first. RN1 preserves zero, treats missing/invalid/negative values as `-1`, and cannot publish NaN. Legacy R06/S06/T3H categories remain supported.

## Period contract and consumer limitations

**The retained field names do not establish equivalent periods.** PCP/SNO describe hourly quantities in the observed compatibility mapping; a direct assignment cannot prove a six-hour total. TMP does not establish the old three-hour temperature cadence. #2555 did not multiply, accumulate, resample or infer conversion rules; #2583 (D45) repaired the precipitation consumers below. Temperature cadence is unchanged.

| Consumer | Preserved behavior / consequence |
| --- | --- |
| [v2 short controller](../../server/controllers/kma/kma.town.short.controller.js), `saveShort` / `getShortFromDB` | Stores/reads `shortData` fields without a period conversion. Offline XML-to-storage/read smoke verifies exact 1.5/0.5/12.5 values and date/grid/publication fields. |
| [legacy models](../../server/models/modelShort.js) and [manager](../../server/controllers/controllerManager.js), `saveShort` | Keep legacy field names and `DB_DATA_VERSION` routing; no storage schema migration or DB-version default change. |
| [controllerTown24h](../../server/controllers/controllerTown24h.js), `adjustShort` | Repaired by #2583: no split. Each slot keeps its total of hourly amounts; a complete shortest-window `rn1` total replaces `r06` only. The regression in `gather-code-drift.test.js` now asserts 1.5/0.5 stay in every slot. |
| [controllerTown](../../server/controllers/controllerTown.js), `getShort`, RSS merge, daily overlay and string conversion | Repaired by #2583: `getShort` sums hourly rows per 3-hour slot, RSS six-hour amounts are labelled and kept out of daily totals, daily amounts are day totals, and strings come from the category bounds. Temperature time-slot assumptions remain. |
| [controllerTown24h](../../server/controllers/controllerTown24h.js), `_convertWeatherData` | Snow cm-to-mm and requested-unit conversion are unit conversion, not period aggregation. `s06` now holds snow only. |

**Activation hold:** Do not activate the migrated hourly short feed in production until the legacy period consumers are repaired and verified under a separately reviewed contract. Existing source schedules stay unchanged; this document does not enforce a runtime feature gate. An operator must prevent activation through the approved deployment/job policy. #2583 repairs the precipitation consumers in source with offline verification; the hold can be lifted by the operator once the gather host and the service run that change. Temperature cadence (`TMP` under `t3h`) is not part of that repair.

The #2555 port itself included no downstream period repair. A separate design must establish provider publication/cadence, accumulation windows, mixed API/RSS provenance, API/widget compatibility and a migration contract before changing consumer formulas. Operator acceptance should examine raw stored timestamps/values and consumer responses separately; a field-name match is insufficient evidence of meteorological equivalence. #2554 RSS wind/fallback repair remains separate.

## Complete appendix disposition

Inventory is the union of 16 tracked EC2-touched paths, not 16 new features or full-tree parity. Fourteen non-config textual blocks plus one current-controller EOF-only difference are covered below. Configuration contents/backups are excluded, never reconstructed or imported.

| Path (under `server/`) | Hunk / observed difference | Disposition |
| --- | --- | --- |
| `app.js` | Disable `require('newrelic')` | Retained default: monitoring require stays enabled. |
| `controllers/airkorea.dust.image.controller.js` | Suppress two invalid-color warnings | Retained default; diagnostic policy deferred. |
| `controllers/controllerManager.js` | Replace rn1/reh/pty/lgt `>= 0` with `!== -1` | Already-upstream fix retained; EC2 regression excluded. |
| same | Eight retry budgets; invalid T1H retry; two recursive delays | Retained defaults; exact observed profile below is operator-deferred. |
| same | `async.series` callback blank lines | Formatting-only; not ported. |
| same | Disabled jobs, changed minutes/putAll, startup pass | Retained defaults; every observed condition listed below. |
| same | Remove `keco.setKakaoApiKeys(...)` | Already-upstream initialization retained. |
| `controllers/img.hourly.forecast.controller.js` | Suppress invalid-value warning | Retained default. |
| `controllers/kaq.hourly.forecast.controller.js` | Minimum images 4 → 2 | Retained default 4; configurable since #2588 (`GATHER_KAQ_MIN_MODEL_IMAGES`). |
| `controllers/kaq.modelimg.controller.js` | Three coordinate/grid info logs and result log → debug | Retained default; no diagnostic severity change. |
| `controllers/kasi.riseset.controller.js` | Comment about expired key; `normal` → `test_normal` | Retained default `normal`; authorization renewal is operator-owned. No secret values inspected. |
| `controllers/kma/kma.town.short.rss.controller.js` | Publication log info → debug | Retained default. |
| `controllers/kma/kma.town.shortest.controller.js` | Additional raw save-error log | Deferred; existing diagnostics unchanged. |
| `controllers/kma/kma.town.current.controller.js` | EOF-only, same line content | Already upstream; no port. Existing current-field merge verified behaviorally. |
| `lib/PastConditionGather.js` | `10` → `updateList.length/20` argument | Retained integer 10; since #2588 `GATHER_PAST_CONDITION_RETRY_DIVISOR` selects `ceil(length/divisor)`, which terminates where the fractional host value would not. |
| `lib/collectTownForecast.js` | Host/seven paths and success code | Ported with guarded failure handling. |
| same | SNO/PCP/TMP mappings | Ported with complete-number/unit/no-value parser and documented provisional periods. |
| same | `RN1: val ? val : -1` | Corrected, not copied: zero preserved, unsupported/nonfinite/negative input missing. |
| same | Remove reh/lgt current template sentinels | Retained upstream templates; regression test covers them. |
| same | Raw result/item logs, count log, numbered failure messages | Not imported. Existing key-bearing request diagnostics corrected to static messages/local metadata. |
| same | Current warning brace formatting | Formatting-only; retained. |
| same | Two request-index cutoffs | Retained defaults; exact boundaries below and tested. |
| `lib/kecoRequester.js` | Remove Kakao fields/methods and restore obsolete Daum | Already-upstream Kakao implementation retained; no Daum rollback. |
| `lib/log.js` | info/error → debug, transport info → debug; remove try/catch | Retained upstream levels and protection; throwing-transport test passes. |
| `routes/v000001/routeGather.js` | Extra short collection logs/indentation | Deferred; route unchanged. |
| `config/config.js` | Unknown config difference | Excluded from offline scope. Preserve public interface; injected dummy config only in tests. |

Untracked `config/config-backup.js`, `config/config.js.latest`, `config/config.js.old` are explicitly excluded. No values, hashes, backups or secret-bearing EC2 history are required or added. Added safety corrections reject empty organized batches/nonfinite values, validate every short/shortest group, preserve numeric validity before serialization and avoid raw response diagnostics. These are local corrections, not EC2 policy ports.

## Legacy-gather policy snapshot — documented, inactive

| Knob | Upstream retained | Observed EC2 source (not activated) |
| --- | --- | --- |
| Town short / shortest / current retries | 70 each | 180 each |
| Mid forecast / land / temp / temp-by-zone / sea retries | 70 each | 2 each |
| Invalid current T1H retry count | 50 | 40 |
| Failed-list recursion delay | 0 ms | 50 ms |
| Invalid-list recursion delay | 0 ms | 50 ms |
| `requestData` cutoff | `i > 100`: indices 0–100 eligible | `i > 20`: indices 0–20 eligible, not exactly 20 requests |
| `requestDataByBaseTimeList` cutoff | `i >= 200`: indices 0–199 eligible | `i >= 50`: indices 0–49 eligible |
| `PastConditionGather.start` update-list argument | 10 | `updateList.length/20`, possibly fractional; consumer termination not approved |

Indices describe eligibility, not a guarantee of simultaneous requests; request callbacks, failures and retries affect concurrency. No configurable profile was introduced here. Since #2588, the retry budgets, the invalid-T1H retry, both recursion delays and the `PastConditionGather` argument (divisor mode rounds up) can be set by environment; defaults stay upstream. See [gather runtime policy](../operations/gather-runtime-policy.md). The request cutoffs remain literals.

All minutes below are UTC; the air-forecast hour gate also uses UTC. Upstream's active schedule is documented in [weather collection](weather-collection.md#schedule-as-implemented).

| Job | Upstream retained | Observed EC2 condition (not activated) |
| --- | --- | --- |
| `past` | minute 2 or putAll | Commented out |
| Air-forecast block | minute 7 with existing hour gate or putAll | Commented out; source comment says another instance, not verified topology |
| `kecoSido` | 4/14/24/34/44/54 or putAll | Commented out |
| `kecoForecast` | 2 or putAll | 2 or putAll |
| `midtemp` | 2 or putAll | 40 or putAll |
| `midland` | 2 or putAll | 48 or putAll |
| `midforecast` | 2 or putAll | 30 or putAll |
| `midsea` | 2 or putAll | 58 or putAll |
| `midrss` | 2 or putAll | 2 or putAll |
| `shortrss` | 2 or putAll | 1 or putAll |
| `short` | 13 or putAll | 24 or putAll |
| `current` | 2/12/22/32/42/52 or putAll | 34 only, **no putAll** branch |
| `shortest` | 48/54/4/14 or putAll | 44/54/4/14 or putAll |
| Startup `checkTimeAndRequestTask(true)` | Active | Commented out |

All other scheduler behavior stays at upstream, including life/health, station air, hit-rate and sunrise/sunset work. No explanation for disabling production jobs is inferred. Since #2588, `GATHER_PAST_ENABLED` and `GATHER_AIR_FORECAST_ENABLED` can disable the `past` job and the air-forecast block, and `GATHER_KAQ_MIN_MODEL_IMAGES` sets the KAQ minimum. The minute changes, `kecoSido`, the `current` `putAll` branch and the startup pass are still not configurable ([gather runtime policy](../operations/gather-runtime-policy.md#remaining-drift-not-covered-by-2588)).

## Operator deployment and rollback handoff

After separate approval, an operator should:

1. Recheck current source/runtime drift and securely preserve existing deployment/config outside Git. Record a rollback revision/artifact; do not assume this appendix establishes runtime parity.
2. Provide valid KMA authorization through the existing `keyString.dongnae_forecast_keys` interface and existing manager key selection; retain required public config interfaces, `SERVER_MODE`, `DB_DATA_VERSION` and normal monitoring/Kakao configuration. This PR neither imports config nor renews provider keys. Verify HTTP transport policy independently before transmitting real credentials.
3. Keep hourly short collection inactive until the consumer-period repair is verified; confirm page completeness/capacity and the raw-versus-once-encoded key contract with authorized operator checks. This PR did not provide pagination beyond 999 items; bounded pagination was added later in #2590 (see [compatibility](#compatibility-implemented)). Before enabling it, record the gather keys' data.go.kr daily limit for `getVilageFcst` against the current grid count × runs per day × 2 (the 17:00 and 20:00 publications observed on 2026-09-26 had 1,052 and 1,016 rows, so they need two requests per grid; the 23:00–11:00 runs had 835–980 rows and need one), and watch the log for `KMA incomplete or inconsistent response` warnings with `check: 'duplicate'`. Explicitly choose upstream defaults versus any separately reviewed production policy; the documented legacy profile is inactive. Assess provider quotas, job placement, retry/termination and periods before activation. Deploy through the existing approved process with rollback ready.
4. Verify collection outcome, grid coordinates, finite/sentinel values and publication timestamps in storage, then through origin and CDN. Separately inspect hourly-versus-legacy-period consumer behavior; successful HTTP alone does not prove collection or accurate precipitation periods.
5. Roll back by restoring the recorded previous source artifact and securely preserved configuration, restarting only approved gather processes. No schema migration is introduced, but records already written remain; assess timestamps/values and use an operator-approved recovery plan rather than deleting data automatically.

No deploy, merge, live provider call, credential renewal, EC2 inspection or production recovery occurred in this implementation. Offline test commands/results and independent verification are in [the task report](../../reports/sdlc/issue-2555/self-verification.md).
