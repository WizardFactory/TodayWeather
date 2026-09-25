# Domain glossary and code tables

This glossary lists the weather and air codes, sentinel values, icon names, air-quality breakpoints, derived indices and summary rules that the server applies before a response reaches the client. It covers source baseline `bd6640f2` (re-baselined 2026-09-25 from `ff7acf3996ccb66c912d2ed4710cf300197d6966`, first written 2026-09-24; client source identical to `ff7acf39`). Rules in code changed upstream were re-read at `bd6640f2` and cite the commit; anomalies fixed upstream are kept and marked "resolved upstream". Evidence is **observed source** unless a row says otherwise. **Synthetic execution** here means that pure functions were copied from the source text or loaded from [aqi.converter.js](../../server/lib/aqi.converter.js) and run in Node with stub loggers. The unit-conversion results in [§8](#8-unit-conversion) come from the checked-in probe [server-unit-conversion.js](../../reports/rewrite-verification/probes/server-unit-conversion.js) and its [record](../../reports/rewrite-verification/probes/server-unit-conversion.json). The harnesses behind the other synthetic results (icons, AQI converter, derived indices, daily pollutant regrading) are not checked in. No server, collector, database or provider was started. Provider specifications (KMA, AirKorea, DarkSky/DSF, WAQI) are outside this checkout. Where a row quotes a source comment about provider semantics, the comment is the only evidence.

**How to use during a rewrite.** Treat each table as a compatibility input. A replacement may rename or retype a field, but it must map every code and sentinel listed here and state the mapping explicitly. Never merge KMA and world fields by name alone ([§2](#2-kma-pty-versus-world-prectype)). Use the anomaly notes as characterization-test targets, not as approved behavior. This document does not repeat existing material: field aliases and screen use are in [client data contracts](client-data-contracts.md#weather-row-vocabulary-consumed-by-screens), merge order is in [server response assembly](server-response-assembly.md#3-domestic-merge-rules-in-execution-order), the client AQI legend tables are in [AQI standard tables](client-data-contracts.md#aqi-standard-tables), and warning codes are in [weather warnings](server-response-assembly.md#8-weather-warnings).

## 1. KMA products, categories and sentinels

### Grid categories

Since 5e653285 the domestic collector calls `VilageFcstInfoService_2.0` on `apis.data.go.kr`: `getUltraSrtNcst` for the current observation, `getUltraSrtFcst` for the shortest (very-short) forecast and `getVilageFcst` for the short forecast ([collector URLs](../../server/lib/collectTownForecast.js#L143-L151)). At `ff7acf39` it called the retired `SecndSrtpdFrcstInfoService2` (`ForecastGrib`, `ForecastTimeData`, `ForecastSpaceData`); the unit and code comments below come from that era. Each XML `category` is matched explicitly and stored with `parseFloat`, with no scaling ([short](../../server/lib/collectTownForecast.js#L478-L600), [shortest](../../server/lib/collectTownForecast.js#L602-L710), [current](../../server/lib/collectTownForecast.js#L712-L826)). The exceptions are the new-service categories `PCP`, `SNO`, `TMP` and shortest `RN1`, which go through [`parseMeasurement`](../../server/lib/collectTownForecast.js#L405-L422): a complete decimal (optional `mm`/`cm` suffix) is kept, `강수없음`/`적설없음` become `0`, and range or threshold text such as `1~4` or `1.0mm 미만`, blanks and negative amounts become the field sentinel. A "0.1" in a source comment is provider resolution, not a stored scale factor. The period caveats of the new categories are in [gather source reconciliation](../architecture/gather-source-reconciliation.md#period-contract-and-consumer-limitations).

The global projection lists in [app.js](../../server/app.js#L111-L123) decide which stored fields readers copy into request data. `curString` covers current, `shortString` short, `shortestString` shortest, `rssString` short RSS, and `forecastString`/`seaString` the medium forecast and sea products. `date` and `time` come from `commonString`. 49afbbea removed `global.tempString`; `global.landString` is still defined but no longer read, because every medium reader and `Manager.dupMid` now shadow both names with [`midForecastPolicy.landFields`/`tempFields`](../../server/lib/midForecastPolicy.js#L5-L13): 26 land fields (`wf3Am` … `wf10` plus `rnSt3Am` … `rnSt10`) and 16 temperature fields. A product is recognized as land or temperature when **any** of its fields is present; at `ff7acf39` the test was `wf10` or `taMax10`.

| Category → field | Products | Unit and value codes (source comments) | Model default (sentinel) | Notes |
| --- | --- | --- | --- | --- |
| `T1H` → `t1h` | current, shortest | °C | `-50` | `getCurrent` turns `-50` into `undefined` for the current record ([controllerTown.js](../../server/controllers/controllerTown.js#L743-L748)) |
| `RN1` → `rn1` | current, shortest | 1-hour precipitation **bucket code**: `1` ≤1 mm, `5` 1–4, `10` 5–9, `20` 10–19, `40` 20–39, `70` 40–69, `100` ≥70 | `-1` | Station merges overwrite `rn1` with station `rs1h`, a literal amount ([L1329](../../server/controllers/controllerTown.js#L1329), [L1878-L1895](../../server/controllers/controllerTown.js#L1878-L1895)). The response field can therefore hold either encoding. Since 5e653285 shortest `RN1` from the new service is parsed as a literal mm amount; its range text becomes `-1` rather than a bucket code. History recovery (2116c6bf) can also fill a missing past `rn1` with an ASOS amount (§1 [history values](#history-and-daily-validity-rules-added-upstream)). Text decoding is described in [§4](#4-other-code-to-text-mappings) |
| `SKY` → `sky` | current, shortest, short | `1` clear, `2` partly cloudy (구름조금), `3` mostly cloudy (구름많음), `4` overcast (흐림) | `-1` | Drives the icon base ([§3](#3-icon-name-grammar-and-daynight-rules)) |
| `UUU`, `VVV` → `uuu`, `vvv` | current, shortest, short | East–west and north–south wind components, m/s | `-100` | No server or `client/www` consumer beyond merges and sentinel restore (`grep -rn "\.uuu\|\.vvv" server/controllers server/lib client/www/js`) |
| `REH` → `reh` | current, shortest, short | Relative humidity, % | `-1` | Input to derived indices ([§6](#6-derived-indices)) |
| `PTY` → `pty` | current, shortest, short | `0` none, `1` rain, `2` rain/snow, `3` snow | `-1` | Differs from world `precType` for codes 2 and 3 ([§2](#2-kma-pty-versus-world-prectype)) |
| `LGT` → `lgt` | current, shortest | Current comment: `0` none, `1` present. Shortest comment: `0` none, `1` low, `2` moderate, `3` high probability | `-1` | Icon composition adds lightning only for `lgt === 1` ([§3](#3-icon-name-grammar-and-daynight-rules)) |
| `VEC` → `vec` | current, shortest, short | Wind direction, degrees | `-1` | Client arrow rotation; see [row vocabulary](client-data-contracts.md#weather-row-vocabulary-consumed-by-screens) |
| `WSD` → `wsd` | current, shortest, short | Wind speed, m/s | `-1` | Wind grade in [§4](#4-other-code-to-text-mappings) |
| `POP` → `pop` | short | Probability of precipitation, % | `-1` | |
| `R06` → `r06` | short | 6-hour precipitation bucket code (same buckets as `RN1`). Since 5e653285 the new service's hourly `PCP` is also stored here as a literal mm amount, without period conversion | `-1` | `adjustShort` splits each 6-hour value across two 3-hour slots: halves when both slots have `pty > 0`, otherwise the whole value goes to the precipitating slot, else `0` ([controllerTown24h.js](../../server/controllers/controllerTown24h.js#L146-L215)). Split values are no longer bucket codes |
| `S06` → `s06` | short | 6-hour new snow bucket code: `0` none, `1` ≤1 cm, `5` 1–4, `10` 5–9, `20` 10–19, `100` ≥20. Since 5e653285 hourly `SNO` is also stored here as a literal cm amount | `-1` | Split as `R06`. Stored in cm; `convertUnits` multiplies by 10 (cm → mm) unconditionally, so a surviving `-1` would become `-10`; `adjustShort` normally rewrites short `r06`/`s06` to values ≥ 0 first ([L2120-L2125](../../server/controllers/controllerTown24h.js#L2120-L2125)) |
| `T3H` → `t3h` | short | °C. Since 5e653285 the new service's `TMP` is also stored here (strict decimal, else `-50`) | `-50` | |
| `TMN`, `TMX` → `tmn`, `tmx` | short | Daily minimum/maximum, °C | `-50` | Carried on the `0600` / `1500` slots; the RSS merge writes only those slots and `adjustShort` recomputes extrema ([assembly §3](server-response-assembly.md#3-domestic-merge-rules-in-execution-order)) |
| `WAV` → `wav` | short | Wave height, m | `-1` | No `client/www` consumer found (`grep -rn "\bwav\b" client/www/js`) |

**Legacy versus v2 models.** Per-field defaults are identical in the legacy models (`server/models/model*.js`) and the `DB_DATA_VERSION` 2.0 models (`server/models/kma/kma.town.*.model.js`). This was checked by extracting every `{type: Number, default: N}` pair from the current, short, shortest, short-RSS, medium-temperature and medium-sea model pairs; all six pairs were identical at `ff7acf39` and at `bd6640f2`. At `bd6640f2` the medium-temperature pair has **no** defaults: 95fe711e removed the `-100` default from `taMin3` … `taMax10` in both versions, so a missing horizon is now absent rather than `-100` ([modelMidTemp](../../server/models/modelMidTemp.js#L15-L30), [kma.town.mid.temp.model](../../server/models/kma/kma.town.mid.temp.model.js#L14-L29)). Sources: [modelCurrent](../../server/models/modelCurrent.js#L17-L27), [kma.town.current.model](../../server/models/kma/kma.town.current.model.js#L19-L28), [modelShort](../../server/models/modelShort.js#L22-L37), [kma.town.short.model](../../server/models/kma/kma.town.short.model.js#L16-L31), [modelShortest](../../server/models/modelShortest.js#L16-L27), [kma.town.shortest.model](../../server/models/kma/kma.town.shortest.model.js#L17-L28). `mx`/`my` default to `-1` in both.

**In-code templates can differ from model defaults.** Examples:

- `updateCurrentListForValidation` fills missing hourly history slots with `uuu: -1, vvv: -1` instead of `-100` ([L970-L971](../../server/controllers/controllerTown.js#L970-L971)).
- The RSS parser template uses `tmx: -1` ([kma.town.short.rss.controller.js](../../server/controllers/kma/kma.town.short.rss.controller.js#L260-L280)); the model default is `-50`.

A replacement must therefore treat each sentinel per field *and* per origin, not as a single global "missing" value. The client-side consequences are described in [missing values](client-data-contracts.md#missing-values-time-and-units-are-compatibility-rules).

**Where sentinels are converted.**

| Stage | Behavior | Source |
| --- | --- | --- |
| Collector completeness check | Rejects a batch when its first record still has the template value for key fields (short: `sky`, `reh`, `pty`, `t3h`; shortest: `sky`, `reh`, `pty`, `t1h`; current: `rn1`, `pty`, `t1h`) or when its temperature is below `-100`. Short and shortest also reject negative `pty`, `sky` or `reh`. Current deletes other negative `pty`, `rn1` and `reh` values of the first record instead. Since 5e653285 [`_emitOrganizedData`](../../server/lib/collectTownForecast.js#L425-L448) then checks **every** record: an empty batch, any non-finite number or empty `wf*` text rejects it, and for short/shortest each record must hold `sky`, `reh`, `pty` ≥ 0 and a temperature that is neither `-50` nor below `-100`. The response envelope is validated first (`resultCode` `00` and a positive `totalCount` since 5e653285; `totalCount` equal to the item count since b4d063fd, [L363](../../server/lib/collectTownForecast.js#L363)) | [short](../../server/lib/collectTownForecast.js#L566-L594), [shortest](../../server/lib/collectTownForecast.js#L676-L704), [current](../../server/lib/collectTownForecast.js#L778-L819), [envelope](../../server/lib/collectTownForecast.js#L348-L366) |
| `getCurrent` | Current record: `-50`, `-1` and `-100` sentinels become `undefined`, which JSON then omits. `t1h` and `wsd` are rounded to 1 decimal; `rn1` is rounded to 1 decimal below 10, otherwise to an integer | [controllerTown.js](../../server/controllers/controllerTown.js#L743-L787) |
| Base `sendResult` (v000001 only) | Restores `undefined` current fields to the model sentinels | [controllerTown.js](../../server/controllers/controllerTown.js#L3373-L3403) |
| KMA `convertUnits` (v000901–v000903) | Skips `-50` for temperature conversion only in a non-default temperature unit. Other fields convert whatever value is present: a `-1` becomes `-0` (JSON `0`), `-2.2`, `-0.4` and so on, depending on the unit ([§8 sentinel table](#sentinels-after-conversion)) | [controllerTown24h.js](../../server/controllers/controllerTown24h.js#L2127-L2155) |

### Short RSS fields

`TownRss.parseShortRss` stores the fields in `rssString` ([parser](../../server/controllers/kma/kma.town.short.rss.controller.js#L239-L310)). `getShortRss` merges only future slots into `short` ([merge](../../server/controllers/controllerTown.js#L490-L608); publication and overwrite rules are in [assembly §3](server-response-assembly.md#3-domestic-merge-rules-in-execution-order) and, as rewritten upstream in 658605db, in the [RSS fallback contract](../architecture/mobile-api.md#rss-fallback-contract-issue-2554-local-repair)). Since 658605db every merged value passes [`_mergeRssValue`](../../server/controllers/controllerTown.js#L67-L80): it must be a finite number, `≥ 0` for fields whose sentinel is `-1` and `> sentinel` otherwise, so a missing RSS value never erases a usable base value. Since b13dc38a the RSS publication must itself be 0–24 h old ([controllerTown.js#L527-L535](../../server/controllers/controllerTown.js#L527-L535)); since 658605db the first future RSS slot is no longer skipped (the loop bound changed from `i > 0` to `i >= 0`).

| Field | Meaning and codes | Default | Merge target |
| --- | --- | --- | --- |
| `ftm`, `date` | Announcement time; slot time `YYYYMMDDHHMM` | None (`String`; the parser template starts `ftm: -1`, `date: ''`) | Slot key |
| `temp` | Temperature, °C | `-1` (a valid temperature) | `t3h` (1 decimal), when `> -50` |
| `tmn`, `tmx` | Daily min/max; the provider missing value is `-999` | `-50` | `tmn` at `0600`, `tmx` at `1500`, each when `> -50`, which also rejects `-999` ([L583-L587](../../server/controllers/controllerTown.js#L583-L587)). **Anomaly resolved upstream in 658605db:** at `ff7acf39` the `1500` branch tested `tmn != -999`, not `tmx` |
| `sky`, `pty`, `pop`, `reh` | Same codes as the grid categories | `-1` | Same field, when `≥ 0` (at `ff7acf39` `overwrite` also copied `-1`) |
| `wfKor`, `wfEn` | Weather summary code from string: `1` clear, `2` partly cloudy, `3` mostly cloudy, `4` cloudy, `5` rain, `6` snow/rain, `7` snow ([convertWeatherString](../../server/controllers/kma/kma.town.short.rss.controller.js#L183-L231)) | `-1` | Not merged |
| `r12`, `s12`, `r06`, `s06` | Provider precipitation/snow values; model comments list range categories | `-1` | `r06`, `s06` only (1 decimal) |
| `ws` | Wind speed, m/s | `-1` | `wsd`, when `≥ 0` (since 658605db) |
| `wd` | Direction code `0`–`7` (N, NE, E, SE, S, SW, W, NW, per model comment) | `-1` | `vec = wd × 45` for an integer `0`–`7`; `8` and fractions are rejected (since 658605db, [L589-L594](../../server/controllers/controllerTown.js#L589-L594)) |
| `wdKor`, `wdEn` | Direction code `1`–`8` (E, N, NE, NW, S, SE, SW, W) from the same string converter | `-1` | Not merged. **Anomaly resolved upstream in 658605db:** at `ff7acf39` the parser assigned `wfEn` twice and never assigned `wdEn`; it now reads `item.wdEn` ([L302](../../server/controllers/kma/kma.town.short.rss.controller.js#L302)). Stored `wdEn = -1` rows are not backfilled ([wind contract](../architecture/weather-collection.md#grid-rss-wind-contract-issue-2554-local-repair)) |

**Source anomaly, resolved upstream in 658605db (history, not reproduced).** At `ff7acf39` the RSS merge copied `rssList[i].wsd`, `.vec`, `.wav`, `.uuu` and `.vvv`, keys that RSS records never contain because `getShortRssFromDB` projects only `rssString` ([L532-L539](../../server/controllers/kma/kma.town.short.rss.controller.js#L532-L539)). With `overwrite`, these five fields on matched future slots became `undefined`. At `bd6640f2` `wsd` and `vec` come from `ws` and `wd`, and the absent `wav`, `uuu`, `vvv` fail `_mergeRssValue`, so the base values stay ([L588-L597](../../server/controllers/controllerTown.js#L588-L597)). Each merged slot is also recorded as request-local daily evidence (`req._dailyShortRss`), used only when the primary short forecast is stale ([daily validity](../architecture/mobile-api.md#daily-forecast-validity-issue-2560)).

### Medium-range fields

Since 95fe711e land and temperature responses are parsed by [`midForecastPolicy.parse`](../../server/lib/midForecastPolicy.js#L155-L187): the envelope must report `resultCode` `00` and a `totalCount` equal to the item count, the publication must be `0600` or `1800`, each `regId` must be alphanumeric, a `wf*` phrase is kept only if it is in the phrase table below, `rnSt*` only if it is a probability 0–100 and `ta*` only if it is a temperature in (−50, 60). Missing horizons stay absent. An item with no usable weather (land) or temperature (temp) field fails the batch.

| Product (reader list) | Fields | Codes and defaults | v000903 domestic use |
| --- | --- | --- | --- |
| Medium forecast (`forecastString`) | `cnt`, `wfsv` | `wfsv` is forecast prose; a missing or blank `wfSv` now fails the batch | `midData` forecast text ([getMid](../../server/controllers/controllerTown.js#L2031-L2129)). Since 95fe711e a missing forecast, land or temperature record no longer aborts `getMid`; it yields an empty list |
| Medium land (`midForecastPolicy.landFields`) | `wf3Am` … `wf7Pm`, `wf8`, `wf9`, `wf10`; since 95fe711e also `rnSt3Am` … `rnSt7Pm`, `rnSt8`, `rnSt9`, `rnSt10` | Korean sky phrases (below); `rnSt*` precipitation probability, % (no default) | Daily `wfAm`/`wfPm` and `rnStAm`/`rnStPm` (days 8–10 copy the single value to both halves), then `sky`/`pty` after `convertMidKorStrToSkyInfo` |
| Medium temperature (`midForecastPolicy.tempFields`; `global.tempString` removed in 49afbbea) | `taMin3` … `taMax10` (days 3–10) | °C; **no model default** since 95fe711e (was `-100`) | Daily `taMin`/`taMax`, emitted as `tmn`/`tmx` ([convertUnits](../../server/controllers/controllerTown24h.js#L1772-L1778)) |
| Medium sea (`seaString`) | `wf3Am` … `wf10`, `wh3AAm` … `wh10B` | Wave heights; model default `-100`. b4d063fd fixed days 4–7, which at `ff7acf39` all copied the day-3 `wh3*` values ([collector L969-L984](../../server/lib/collectTownForecast.js#L969-L984)) | Not read by `getMid` (only forecast, land and temperature are read) |
| Medium RSS ([modelMidRss](../../server/models/modelMidRss.js)) | `date`, `taMin`, `taMax`, `wfAm`, `wfPm`, `reliability` | `reliability` is 높음/보통/낮음 | **Retired upstream in 95fe711e**: `getMidRss` is a pass-through ([L2026-L2029](../../server/controllers/controllerTown.js#L2026-L2029)), so these fields and `rssPubDate` no longer reach responses. At `ff7acf39` a newer RSS overwrote daily `taMin`/`taMax`/`wfAm`/`wfPm` and added `reliability` |

**Joining land and temperature.** [`_mergeLandWithTemp`](../../server/controllers/controllerTown.js#L5063-L5101), rewritten in 95fe711e, takes the latest land and the latest temperature record separately. Each must be a `0600`/`1800` publication at most 36 h old and, when the reader recorded a publication, must match it ([`midForecastPolicy.latest`](../../server/lib/midForecastPolicy.js#L111-L120)). Each record is mapped to its own KST target dates (publication date + 3 … + 10) by explicit KST arithmetic, limited to D-7 … D+10. A day is emitted only when both extremes are valid, `taMin ≤ taMax`, and both halves have a known phrase. At `ff7acf39` the last array element of each list was used without a freshness check, dates came from host-local `convertStringToDate` (E4 in the [data model](data-model-reference.md#41-encodings)), and a missing value was `-100` or `""` and filtered out.

[`_convertKorStrToSky`](../../server/controllers/controllerTown.js#L5375-L5377) delegates since 49afbbea to [`midForecastPolicy.skyInfo`](../../server/lib/midForecastPolicy.js#L21-L42), which trims the phrase and maps it to `{sky, pty, lgt: 0}`:

| Phrase | `sky` | `pty` |
| --- | --- | --- |
| 맑음 / 구름조금 / 구름많음 / 흐림 | 1 / 2 / 3 / 4 | 0 |
| 구름적고 / 구름많고 / 흐리고 + `비` or `한때 비` | 2 / 3 / 4 | 1 |
| 구름많고 소나기 / 흐리고 소나기 (added in 49afbbea; rain icon, original wording kept) | 3 / 4 | 1 |
| 구름적고 / 구름많고 / 흐리고 + `눈` or `한때 눈` | 2 / 3 / 4 | 3 |
| 구름적고 / 구름많고 / 흐리고 + `비/눈` or `눈/비` | 2 / 3 / 4 | 2 |
| Anything else | `undefined`, without the error log of `ff7acf39` | — |

`convertMidKorStrToSkyInfo` now drops daily rows whose AM or PM phrase is unknown or whose temperatures are incomplete ([L1952-L1954](../../server/controllers/controllerTown.js#L1952-L1954)). At `ff7acf39` it substituted `{sky: 1, pty: 0}` (clear) with a warning. Because collection applies the same table, an unknown phrase is not stored in the first place.

### History and daily-validity rules added upstream

These rules decide which values are valid enough to fill or emit. They are summarized here because they redefine "missing" for daily and past hourly rows; composition order is in [daily forecast validity](../architecture/mobile-api.md#daily-forecast-validity-issue-2560) and [historical observation composition](../architecture/mobile-api.md#historical-observation-composition-2564).

| Rule | Values | Source |
| --- | --- | --- |
| History field ranges (2116c6bf) | `t1h`, `t1d`, `taMin`, `taMax` in (−50, 60]; `reh` 0–100; `rn1` 0–5000; `wsd` 0–100; `vec` 0–360; `sky` 1–4. A history value fills a row field only when the row's own value fails the same test | [policy.js#L6-L27](../../server/lib/history/policy.js#L6-L27), [L181-L204](../../server/lib/history/policy.js#L181-L204) |
| ASOS field mapping | Hourly `ta`→`t1h`, `hm`→`reh`, `rn`→`rn1` (not November–March), `ws`→`wsd`, `wd`→`vec`; for hourly items a non-empty, non-zero `<field>Qcflag`/`Qcflg` drops the value. Daily `minTa`→`taMin`, `maxTa`→`taMax`, `avgTa`→`t1d`, `avgRhm`→`reh`, `sumRn`→`rn1`, `avgWs`→`wsd` | [L92-L146](../../server/lib/history/policy.js#L92-L146) |
| Cloud cover to `sky` | ASOS `dc10Tca` (tenths): 0–2 → 1, 3–5 → 2, 6–8 → 3, 9–10 → 4 | [L121-L125](../../server/lib/history/policy.js#L121-L125) |
| Provenance markers | `historyObservation {source, stationId, key, fields}` on filled hourly and daily rows (an array of such objects on 3-hour `short` slots, [controllerTown.js#L4828](../../server/controllers/controllerTown.js#L4828)); daily rows from hourly data carry `observationType: 'hourly-summary'` and `observationHours`, official daily records `observationType: 'daily'` | [L196-L246](../../server/lib/history/policy.js#L196-L246), [controllerTown.js#L5636-L5642](../../server/controllers/controllerTown.js#L5636-L5642). A daily row from fewer than 24 hourly observations is replaced by a valid official daily record ([L225-L230](../../server/lib/history/policy.js#L225-L230)) |
| Wire rain on recovered rows | On a `short` row with `historyObservation`, a non-numeric or negative `rn1`, `r06` or `s06` is removed together with its `*Str`; other rows keep their sentinels | [L163-L180](../../server/lib/history/policy.js#L163-L180), used by both `sendResult` variants |
| Past daily summary | Only usable values are aggregated (`_isRssValueUsable`); a day without any `t1h` is skipped; a field without inputs is **omitted** instead of becoming 0; the first `0000` slot is no longer dropped | [controllerTown.js#L5530-L5646](../../server/controllers/controllerTown.js#L5530-L5646) |
| Mid and short validity | Temperature (−50, 60); probability 0–100; mid publication `0600`/`1800` KST and ≤ 36 h old; short publication ≤ 24 h old; target dates D-7 … D+10 | [midForecastPolicy.js#L15-L20](../../server/lib/midForecastPolicy.js#L15-L20), [L72-L127](../../server/lib/midForecastPolicy.js#L72-L127) |
| Response status objects | `midData.dailyStatus {healthy, reasons, unavailableDates, rss: 'retired'}` and `result.historyStatus {startDate, endDate, timeZone, missingHourlySlots, missingDailyDates, hourlyFieldGaps, mapping, reason}` | [L128-L154](../../server/lib/midForecastPolicy.js#L128-L154), [history/policy.js#L252-L287](../../server/lib/history/policy.js#L252-L287), [service.js#L70-L76](../../server/lib/history/service.js#L70-L76) |

## 2. KMA `pty` versus world `precType`

The two providers use the same small integers with different meanings. Each provider composes its own icon from its own code, so icons are consistent. The alias layer and shared helpers are not.

| Code | KMA `pty` | World `precType` (DSF) | KMA icon suffix | World icon suffix |
| --- | --- | --- | --- | --- |
| `-1` | Sentinel (unknown) | — | none; error logged | — |
| `0` | none | none | none | none |
| `1` | rain | rain | `_rain` | `_rain` |
| `2` | **rain/snow** | **snow** | `_rainsnow` | `_snow` |
| `3` | **snow** | **rain/snow** (sleet or hail) | `_snow` | `_rainsnow` |
| `4` | — (error logged, no suffix) | hail → `_rainsnow` in `_parseWorldSkyState` | — | `_rainsnow` |

**World `precType` producers.**

- DSF `_getPrecType(icon, pre_pro, pre_type)` ([L2632-L2662](../../server/controllers/worldWeather/controllerWorldWeather.js#L2632-L2662)): the provider icon `rain` → 1, `snow` → 2, `sleet`/`hail` → 3. Any other icon, or no icon, with probability `< 0.5` gives 0. Otherwise, and also after an icon match, `pre_type` `rain`/`snow`/`sleet` sets 1/2/3 and overrides the icon result (for example icon `rain` with `pre_type` `snow` gives 2).
- DSF hourly 3-hour bucket ([L2751-L2764](../../server/controllers/worldWeather/controllerWorldWeather.js#L2751-L2764)) evaluates three hourly inputs: any 1 gives 1; any 2 adds 2 (rain + snow = 3); any 3 gives 3.
- The WU mergers used by the `/ww` routes add 1 for rain and 2 for snow ([L2269-L2275](../../server/controllers/worldWeather/controllerWorldWeather.js#L2269-L2275), [L2341-L2347](../../server/controllers/worldWeather/controllerWorldWeather.js#L2341-L2347)).

No checked-in producer returns `4`; the `case 4` branch is unreachable from these producers.

**Consequences of the shared `pty` alias** (source-level, not reproduced end to end):

1. The world alias step sets `pty = precType || 0` without remapping ([ww units](../../server/controllers/worldWeather/controller.ww.units.js#L179), [L230](../../server/controllers/worldWeather/controller.ww.units.js#L230), [L291](../../server/controllers/worldWeather/controller.ww.units.js#L291)). World `pty: 2` therefore means snow, while KMA `pty: 2` means rain/snow.
2. Future world daily/hourly rows put `precip` into `r06` for `precType` 1. `precType` 2 (world snow) fills **both** `r06` and `s06`, and `precType` 3 (world rain/snow) fills **only** `s06` ([L246-L259](../../server/controllers/worldWeather/controller.ww.units.js#L246-L259), [L314-L327](../../server/controllers/worldWeather/controller.ww.units.js#L314-L327)). This branch pattern matches KMA `pty` semantics, not world ones.
3. The shared summary helpers label `pty` 1/2/3 as `LOC_RAINFALL`/`LOC_PRECIPITATION`/`LOC_SNOWFALL` ([makeSummaryWeather](../../server/controllers/controllerTown24h.js#L1475-L1492), same switch in [makeSummary](../../server/controllers/controllerTown.js#L2201-L2218)). World snow is therefore labelled "precipitation" and world rain/snow "snowfall".
4. When `rn1 > 0`, the client chooses the snow symbol only if `pty == 3`; without `rn1` it falls back to `s06 > 0` → snow ([forecast controller](../../client/www/js/controller.forecastctrl.js#L232-L249)). Past world rows carry `rn1`. A world past row with snow shows the rain symbol.

A rewrite should carry a provider-neutral precipitation enum (`none`, `rain`, `snow`, `mixed`, `hail`), keep the raw provider code for diagnostics, and characterize each legacy alias explicitly.

## 3. Icon-name grammar and day/night rules

### Grammar

Lower-case form: `<base>[_<cloud>][_<precip>][_lightning]`.

| Part | Values | KMA rule ([`_parseSkyStateLowCase`](../../server/controllers/controllerTown24h.js#L1984-L2035)) | World rule ([`_parseWorldSkyState`](../../server/controllers/worldWeather/controllerWorldWeather.js#L2452-L2508)) |
| --- | --- | --- | --- |
| `base` | `sun`, `moon`, `cloud` | `sun` by day, `moon` by night; `sky 4` replaces it with `cloud` | Same; cloud cover `> 80`% replaces it with `cloud`. With no cloud value, `precType > 0` gives `cloud` |
| `cloud` | `smallcloud`, `bigcloud` | `sky 2` → `_smallcloud`, `sky 3` → `_bigcloud`; `sky 1` adds nothing | cloud `≤ 20` adds nothing, `≤ 50` → `_smallcloud`, `≤ 80` → `_bigcloud` |
| `precip` | `rain`, `rainsnow`, `snow` | `pty` via [§2](#2-kma-pty-versus-world-prectype) | `precType` via [§2](#2-kma-pty-versus-world-prectype) |
| `lightning` | `lightning` | Only when `lgt === 1`; shortest `lgt` 2/3 add nothing | Never (code commented out) |

Invalid `sky` (for example `-1`) or `pty` logs an error and contributes no part. For example, `sky -1, pty 0` by day yields `sun`. World cloud cover comes from DSF `cloud × 100`. The hourly value averages the positive values of three hourly inputs and defaults to `0` ([L2710-L2725](../../server/controllers/worldWeather/controllerWorldWeather.js#L2710-L2725)).

**Synthetic execution.** The icon functions and `_2lowcase` were extracted from source text and evaluated over every combination of `sky` 1–4, `pty` 0–3, `lgt` 0–3 and day/night (128 combinations):

- `_2lowcase(_parseSkyState(...))` equals `_parseSkyStateLowCase(...)` for all 128.
- KMA yields 56 distinct names; world yields 28, all of them among the KMA names.
- The bundled `client/www/img/weather_default` and `weather_old` folders each contain 63 PNG files. They cover all 56 names plus seven `*_fog` names (`sun_fog`, `moon_fog`, `sun_smallcloud_fog`, `moon_smallcloud_fog`, `sun_bigcloud_fog`, `moon_bigcloud_fog`, `cloud_fog`). No server code emits a fog name, and grep finds no `_fog` reference in `client/www/js` or templates.

The client path is `{{weatherImgPath}}/{{skyIcon}}.png`, where `weatherImgPath` comes from the selected theme ([app.js](../../client/www/js/app.js#L330)).

### CamelCase and lower-case variants

| CamelCase token | Lower-case token | Notes |
| --- | --- | --- |
| `Sun`, `Moon`, `Cloud` | `sun`, `moon`, `cloud` | `Cloud` is a whole base only for overcast |
| `SmallCloud`, `BigCloud` | `_smallcloud`, `_bigcloud` | |
| `Rain`, `RainSnow`, `Snow` | `_rain`, `_rainsnow`, `_snow` | |
| `Lightning` | `_lightning` | KMA only |

`_2lowcase` ([route.dsf.coord.v000902.js](../../server/routes/v000902/route.dsf.coord.v000902.js#L34-L44)) applies nine first-occurrence `String.replace` calls in the order `Sun`, `Moon`, `SmallCloud`, `BigCloud`, `Cloud`, `RainSnow`, `Rain`, `Snow`, `Lightning`. The order matters: `SmallCloud` must be replaced before `Cloud`, and `RainSnow` before `Rain`.

| Route (mounted path) | Icon step | Case emitted |
| --- | --- | --- |
| v000903 KMA `/kma/addr`, `/kma/coord`; v000902 KMA | `insertSkyIconLowCase` | lower-case |
| v000901 KMA; v000705/v000803 town routes | `insertSkyIcon` → `_parseSkyState` | CamelCase |
| v000902 DSF, also mounted as v000903 `/dsf/coord` | `_parseWorldSkyState`, then `skyIconLowCase` on `daily`, `thisTime`, `hourly` | lower-case; world `shortest` rows have no `skyIcon` |
| v000901 DSF | `_parseWorldSkyState` only | CamelCase |
| `/daily` (v000705 router, also mounted by v000903) | `makeDailySummary` → `_parseSkyState` | CamelCase, used for emoji and `icon` |

Sources: [v000903 KMA list](../../server/routes/v000903/route.kma.v000903.js#L53-L60), [v000903 mounts](../../server/routes/v000903/index.js#L24-L34), [v000902 DSF chain](../../server/routes/v000902/route.dsf.coord.v000902.js#L81-L85); version callers are listed in [assembly §7](server-response-assembly.md#7-mounted-version-variants-and-callers).

**Daily fields.** KMA writes `skyIcon`, `skyAmIcon` and `skyPmIcon` on daily rows. `convertUnits` then copies `skyAmIcon` → `skyAm` and `skyPmIcon` → `skyPm` and deletes `skyAmIcon`/`skyPmIcon`; `skyIcon` stays ([L1772-L1807](../../server/controllers/controllerTown24h.js#L1772-L1807)). The response's `skyAm`/`skyPm` are therefore icon names, not numeric sky codes. World daily sets `skyAm = skyPm = skyIcon` ([ww units](../../server/controllers/worldWeather/controller.ww.units.js#L232)).

### Day/night rules

| Path | Rule | Source |
| --- | --- | --- |
| KMA `short`, `shortest`, `current` | `_isNight(dailyData, date, time)` looks up the daily row with the same date and reads `sunrise`/`sunset` as `HHMM`. It falls back to `0700`/`1800` per missing field, or for both when the day is missing (error logged). **Day iff `sunrise ≤ time ≤ sunset`**, inclusive at both ends. Current uses `liveTime` when present. The step runs before `convertUnits`, so `time` is still an `HHMM` string and `2400` is night. It also sets a boolean `night` on each row | [controllerTown24h.js](../../server/controllers/controllerTown24h.js#L580-L620), [insertSkyIconLowCase](../../server/controllers/controllerTown24h.js#L675-L730) |
| KMA daily (`skyIcon`, `skyAm`, `skyPm`) | Always day | same |
| `/daily` summary | Current is night iff the hour is `< 7` or `> 18`; today/tomorrow icons are day. That chain does not run `getRiseSetInfo` | [makeDailySummary](../../server/controllers/controllerTown24h.js#L401-L455), [dailySummary route](../../server/routes/v000705/dailySummary.js#L27-L34) |
| World current (`thisTime`) | `_isNight(curDate, daily.data)` takes the first provider daily record whose date prefix is ≤ the current time. **Night iff `current < sunrise` or `current ≥ sunset`** | [L2590-L2604](../../server/controllers/worldWeather/controllerWorldWeather.js#L2590-L2604) |
| World hourly | `_getSunTime` matches the converted daily row by the first 10 date characters. **Day iff `sunrise < t ≤ sunset`**, strict at sunrise. With no matching day, both values are `undefined` and the row is night | [L2615-L2623](../../server/controllers/worldWeather/controllerWorldWeather.js#L2615-L2623), [L2700-L2708](../../server/controllers/worldWeather/controllerWorldWeather.js#L2700-L2708) |
| World daily | Always day | [L2586](../../server/controllers/worldWeather/controllerWorldWeather.js#L2586) |

The boundary treatment differs by provider and by row type at exactly sunrise and sunset. A rewrite should pick one convention and add explicit sunrise/sunset boundary cases ([V04](verification-matrix.md#minimum-behavior-matrix)).

## 4. Other code-to-text mappings

All `LOC_*` keys resolve through the server `i18n` locale files ([server/locales](../../server/locales/en.json)). Language selection is described in [language negotiation](client-data-contracts.md#language-negotiation).

| Output fields | Input and thresholds | Result | Source |
| --- | --- | --- | --- |
| `wsdGrade`, `wsdStr` (KMA rows only) | `wsd < 0` → 0; `< 4` → 1; `< 9` → 2; `< 14` → 3; `≥ 14` → 4 | 0 `""`, 1 `LOC_LIGHT_WIND`, 2 `LOC_MODERATE_WIND`, 3 `LOC_STRONG_WIND`, 4 `LOC_VERY_STRONG_WIND` | [L3784-L3820](../../server/controllers/controllerTown.js#L3784-L3820) |
| `ptyStr` (KMA rows with `pty > 0`) | `pty` 1 or 2 / 3 | `LOC_PRECIPITATION` / `LOC_SNOWFALL`. Summary helpers overwrite current `ptyStr` with `LOC_RAINFALL`/`LOC_PRECIPITATION`/`LOC_SNOWFALL` ([§7](#7-summary-and-description-precedence)) | [L3617-L3632](../../server/controllers/controllerTown.js#L3617-L3632) |
| `rn1Str`, `r06Str`, `s06Str` | Rain table for `r06` (`pty` 1 or 2) and for `rn1` when `pty` is 1 or 2: `0` "0mm", `1` "~1mm", `5` "1~4mm", `10` "5~9mm", `20` "10~19mm", `40` "20~39mm", `70` "40~69mm", `100` "70~?mm". Snow table for `s06` (`pty` 2 or 3) and for `rn1` when `pty` is 3: `0` "0cm", `1` "~1cm", `5` "1~4cm", `10` "5~9cm", `20` "10~19cm", `100` "20~?cm". Any other positive value → `"~<v>mm"` or `"~<v>cm"` (ceiling when ≥ 10) | Literal `mm`/`cm` text, independent of the requested unit | [L3640-L3681](../../server/controllers/controllerTown.js#L3640-L3681), [L3749-L3773](../../server/controllers/controllerTown.js#L3749-L3773) |
| `sensorytemStr` | Only when `sensorytem < 0`: `(-10, 0)` → `LOC_ATTENTION`; `(-25, -10]` → `LOC_CAUTION`; `(-45, -25]` → `LOC_WARNING`; `≤ -45` → `LOC_HAZARD` | — | [L5194-L5213](../../server/controllers/controllerTown.js#L5194-L5213) |
| `ultrvGrade`, `ultrvStr` (daily, copied to current) | KMA life-index UV value: `≤ 2` → 0; `≤ 5` → 1; `≤ 7` → 2; `≤ 10` → 3; else 4 | 0 `LOC_LOW`, 1 `LOC_NORMAL`, 2 `LOC_HIGH`, 3 `LOC_VERY_HIGH`, 4 `LOC_HAZARD` | [L17-L91](../../server/controllers/lifeIndexKmaController.js#L17-L91), [append to current](../../server/controllers/controllerTown.js#L2360-L2384) |
| `fsnGrade`, `fsnStr` (daily, copied to current) | Food-poisoning index: `< 35` → 0; `< 70` → 1; `< 95` → 2; else 3 | 0 `LOC_ATTENTION`, 1 `LOC_CAUTION`, 2 `LOC_WARNING`, 3 `LOC_HAZARD` | same |
| Daily `dustForecast` | AirKorea regional forecast text 좋음/보통/나쁨/매우나쁨 → `PM10Grade`/`PM25Grade`/`O3Grade` 0–3 (unknown → `""`) | v000903 `convertUnits` emits `pm10Grade`, `pm25Grade`, `o3Grade` **= stored grade + 1** (1–4) and renames `*Str`. `/daily` compares the 0-based value (`pmGrade > 1`) | [kecoController.js](../../server/controllers/kecoController.js#L296-L320), [convertUnits](../../server/controllers/controllerTown24h.js#L1783-L1802) |

**Unit dependence (source-level).** `insertStrForData` runs **after** `convertUnits` in the v000903 chain ([route list](../../server/routes/v000903/route.kma.v000903.js#L53-L60)). As a result:

- The wind thresholds 4/9/14 apply to the requested wind unit, for example km/h or mph, not only to m/s.
- The `sensorytemStr` thresholds apply to the requested temperature unit.
- `s06Str` looks up buckets after `s06` was multiplied by 10.

The converted values themselves are described in [§8](#8-unit-conversion).

No `client/www` file references `wsdGrade`, `wsdStr`, `sensorytemStr`, `ptyStr`, `rn1Str`, `r06Str` or `s06Str` (`grep -rnw <field> client/www/js client/www/templates` returns 0 lines for each). Native widgets and bundled platform copies were not checked for these fields.

### `weatherType` codes

[`WeatherDescription`](../../server/controllers/controller.weather.desc.js) maps English (DSF summary) and Korean (KMA station) phrases to `weatherType` 0–66. `getWeatherStr` maps each code to one `LOC_*` key; the array has 67 entries (evaluated with Node). A phrase is lower-cased and cut at the first `" and "`. Unknown phrases give `-1` and log an error. KMA current receives `weatherType` from station observations ([controllerTown.js](../../server/controllers/controllerTown.js#L1901-L1911), [station adjustments](../../server/controllers/controllerKmaStnWeather.js#L20-L75)). World rows derive it from the DSF summary text ([hourly L2805-L2806](../../server/controllers/worldWeather/controllerWorldWeather.js#L2805-L2806), [current L2834-L2835](../../server/controllers/worldWeather/controllerWorldWeather.js#L2834-L2835)).

| Codes | `LOC_*` keys in code order |
| --- | --- |
| 0–3 | `CLEAR`, `PARTLY_CLOUDY`, `MOSTLY_CLOUDY`, `CLOUDY` |
| 4–13 | `MIST`, `HAZE`, `FOG`, `THIN_FOG`, `DENSE_FOG`, `FOG_STOPPED`, `FOG` (시계내안개), `PARTLY_FOG`, `YELLOW_DUST`, `RAIN` (시계내강수) |
| 14–28 | `LIGHT_DRIZZLE`, `DRIZZLE`, `HEAVY_DRIZZLE`, `DRIZZLE_STOPPED`, `LIGHT_RAIN_AT_TIMES`, `LIGHT_RAIN`, `RAIN_AT_TIMES`, `RAIN`, `HEAVY_RAIN_AT_TIMES`, `HEAVY_RAIN`, `LIGHT_SHOWERS`, `SHOWERS`, `HEAVY_SHOWERS`, `SHOWERS_STOPPED`, `RAIN_STOPPED` |
| 29–31 | `LIGHT_SLEET`, `HEAVY_SLEET`, `SLEET_STOPPED` |
| 32–47 | `LIGHT_SNOW_AT_TIMES`, `LIGHT_SNOW`, `SNOW_AT_TIMES`, `SNOW`, `HEAVY_SNOW_AT_TIMES`, `HEAVY_SNOW`, `LIGHT_SNOW_SHOWERS`, `HEAVY_SNOW_SHOWERS`, `SNOW_SHOWERS_STOPPED`, `SNOW_STOPPED`, `LIGHT_SNOW_PELLETS`, `HEAVY_SNOW_PELLETS`, `LIGHT_SNOW_STORM`, `SNOW_STORM`, `HEAVY_SNOW_STORM`, `POWDER_SNOW` |
| 48–58 | `WATER_SPOUT`, `HAIL`, `THUNDERSHOWERS`, `THUNDERSHOWERS_HAIL`, `THUNDERSHOWERS_RAIN_SNOW`, `THUNDERSHOWERS_STOPPED_RAIN`, `THUNDERSHOWERS_STOPPED_SNOW`, `LIGHTNING`, `BOLT_FROM_THE_BLUE`, `BOLT_STOPPED`, `ICE_PELLETS` |
| 59–63 (English input only) | `BREEZY`, `HUMID`, `WINDY`, `DRY`, `VERY_STRONG_WIND` |
| 64–66 | `SLEET` (sleet, 진눈깨비), `RAIN` (비, KMA AWS), `SNOW` (눈, KMA AWS) |

`weatherType > 3` raises the description's summary grade from 2.5 to 3 ([§7](#7-summary-and-description-precedence)).

## 5. Air-quality standards (server)

The request query `airUnit` selects one of four server standards in [`air_pollutants_breakpoints`](../../server/lib/aqi.converter.js#L7-L44). When the key is absent or equals the literal `(null)`, `checkQueryValidation` substitutes `airkorea` ([L57-L63](../../server/controllers/controllerTown24h.js#L57-L63), [defaults](../../server/lib/unitConverter.js#L278-L281)). There is no allow-list: an unknown value makes the breakpoint lookup throw `TypeError` (synthetic execution of `value2grade('foo', 'pm10', 10)`). The client legend tables are documented separately in [AQI standard tables](client-data-contracts.md#aqi-standard-tables); the server tables below are the ones that assign grades.

### Breakpoints and units

Each row is an ascending breakpoint array. Index 0 is the lower bound, index `g` is the upper bound of grade `g`, and the final element is used only as the top of index interpolation. Units and averaging periods are source comments.

| `airUnit` | Grades | `pm25` | `pm10` | `o3` | `no2` | `co` | `so2` | `aqi` (index) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `airkorea` | 4 | `[0,15,35,75,500]` µg/m³ (24 h) | `[0,30,80,150,600]` µg/m³ (24 h) | `[0,0.03,0.09,0.15,0.6]` ppm (1 h) | `[0,0.03,0.06,0.2,2]` ppm | `[0,2,9,15,50]` ppm | `[0,0.02,0.05,0.15,1]` ppm | `[0,50,100,250,500]` |
| `airkorea_who` | 4 | `[0,15,25,50,500]` µg/m³ | `[0,30,50,100,600]` µg/m³ | as `airkorea` (ppm) | as `airkorea` | as `airkorea` | as `airkorea` | as `airkorea` |
| `airnow` | 6 | `[0,12.0,35.4,55.4,150.4,250.4,500.4]` µg/m³ (24 h) | `[0,54,154,254,354,424,604]` µg/m³ (24 h) | `[0,54,124,164,204,404,604]` **ppb** (8 h, 1 h) | `[0,53,100,360,649,1249,2049]` **ppb** | `[0,4.4,9.4,12.4,15.4,30.4,50.4]` ppm (8 h) | `[0,35,75,185,304,604,1004]` **ppb** | `[0,50,100,150,200,300,500]` |
| `aqicn` | 6 | `[0,35,75,115,150,250,500]` µg/m³ (1 h) | `[0,50,150,250,350,420,600]` µg/m³ (1 h) | `[0,160,200,300,400,800,1200]` **µg/m³** | `[0,100,200,700,1200,2340,3840]` **µg/m³** | `[0,5,10,35,60,90,150]` **mg/m³** | `[0,150,500,650,800,1600,2620]` **µg/m³** | as `airnow` |

**Input conversion.** Stored and computed input values use AirKorea units: PM in µg/m³, gases and CO in ppm. `value2grade` and `value2index` convert to the table unit first ([L261-L358](../../server/lib/aqi.converter.js#L261-L358)):

- `airnow` `o3`/`no2`/`so2`: ppm × 1000 → ppb.
- `aqicn` `o3`/`no2`/`so2`: `ppm2um` = `round(ppm × 1000 × M / 22.4)` µg/m³ with `M` = 47.97 (o3), 45.99 (no2), 64.05 (so2) ([L225-L238](../../server/lib/aqi.converter.js#L225-L238)).
- `aqicn` `co`: `round(ppm × 1000 × 28 / 22.4) / 1000` mg/m³.
- `aqicn` gases and CO only: a `NaN` or negative converted value becomes `0`, which grades as 1 and indexes as 0, so a missing or undefined gas value also grades 1. Otherwise a negative value grades as `-1` (synthetic execution: `value2grade('aqicn','o3',-1)` → 1; `value2grade('aqicn','o3',undefined)` → 1 and `value2index` → 0; `value2grade('airkorea','pm10',-1)` → -1).

The client tables express every gas in ppm, so `airnow` and `aqicn` gas values in the client are converted equivalents of these server rows, apart from the client `airnow` so2 source anomaly noted there.

### Grade, index and label rules

| Function | Rule | Source |
| --- | --- | --- |
| `value2grade(airUnit, code, v)` | `v < bp[0]` → `-1`; `v ≤ bp[1]` → 1 (0 included); then `bp[g-1] < v ≤ bp[g]` → `g`. A 4-grade table returns 4 for **any** `v > bp[3]`, even above `bp[4]`; a 6-grade table returns 6 for any `v > bp[5]`. `NaN` and `undefined` → `-1`, except `aqicn` gases and CO (→ 1, above) | [L261-L318](../../server/lib/aqi.converter.js#L261-L318) |
| `value2index(airUnit, code, v)` | Linear interpolation on the same standard's `aqi` row: `round((aqi[g]-aqi[g-1]) / (bp[g]-bp[g-1]) × (v-bp[g-1]) + aqi[g-1])`. Values above the last breakpoint extrapolate (`airkorea` pm10 700 → 556). Grade `-1` gives `NaN`. `code` `aqi`/`khai` returns the input unchanged with an error log | [L320-L358](../../server/lib/aqi.converter.js#L320-L358) |
| `index2Grade(airUnit, index)` | `parseInt(index)`, then the `value2grade` thresholds on the `aqi` row | [L408-L449](../../server/lib/aqi.converter.js#L408-L449) |
| `grade2minMaxValue(airUnit, code, grade)` | `{min: bp[grade-1] + ε, max: bp[grade]}`. `ε` = 1 for `aqi`; 0.1 for `aqicn`; `airkorea*` 0.1 for PM/CO and 0.001 for gases; `airnow` 0.01 for CO/PM2.5, else 0.1 | [L173-L205](../../server/lib/aqi.converter.js#L173-L205) |
| `extractValue(code, iaqi)` | Converts a WAQI per-pollutant index back to a concentration through the separate 7-band `airnowUnit` table (index 0–500): PM µg/m³ rounded to an integer, gases ppb and CO ppm to 3 decimals | [L47-L102](../../server/lib/aqi.converter.js#L47-L102), [L366-L400](../../server/lib/aqi.converter.js#L366-L400) |
| `airGrade2Str(airUnit, grade)` | `airnow`/`aqicn`: 1 `LOC_GOOD`, 2 `LOC_MODERATE`, 3 `LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS`, 4 `LOC_UNHEALTHY`, 5 `LOC_VERY_UNHEALTHY`, 6 `LOC_HAZARDOUS`. Any other `airUnit`: 1 `LOC_GOOD`, 2 `LOC_MODERATE`, 3 `LOC_UNHEALTHY`, 4 `LOC_VERY_UNHEALTHY`. Other grades → `""` with a warning | [unitConverter.js L300-L354](../../server/lib/unitConverter.js#L300-L354) |

The same grade number means different things by standard: grade 3 is "unhealthy" under `airkorea*` but "unhealthy for sensitive groups" under `airnow`/`aqicn`. Summary thresholds that compare raw grades ([§7](#7-summary-and-description-precedence)) inherit this difference.

**Table anomalies (source reading).** `airnowUnit.so2.extra_hazardous` repeats the hazardous concentration range 605–1004 ([L99-L100](../../server/lib/aqi.converter.js#L99-L100)). `airnowUnit.o3` uses 8-hour-style bands (moderate 55–70 ppb), while the `airnow` `o3` breakpoint row uses 124 ppb as the grade-2 upper bound. A commented China table ([L103-L160](../../server/lib/aqi.converter.js#L103-L160)) is inactive.

### Action-guide keys

`getActionGuide(airUnit, pollutant, grade)` ([L486-L559](../../server/lib/aqi.converter.js#L486-L559)) selects the AirNow guide for `airnow` and `aqicn` and the AirKorea guide for every other value. "PM" below means `pm25`, `pm10` or `aqi`. A grade outside the listed range returns `undefined`, so no text is produced.

| Grade | AirKorea guide (`airkorea`, `airkorea_who`) | AirNow guide (`airnow`, `aqicn`) |
| --- | --- | --- |
| 1 | `LOC_NO_WORRIES_ABOUT_OUTDOOR_ACTIVITIES` | `LOC_NO_WORRIES_ABOUT_OUTDOOR_ACTIVITIES` |
| 2 | PM and `o3`: `LOC_SENSITIVE_PEOPLE_SHOULD_BE_CAREFUL`; `no2`/`co`/`so2`: `LOC_NO_WORRIES_ABOUT_OUTDOOR_ACTIVITIES` | `LOC_SENSITIVE_PEOPLE_SHOULD_BE_CAREFUL` (both branches) |
| 3 | PM: `LOC_WEAR_A_DUST_MASK_WHEN_YOU_GO_OUT`; gases: `LOC_BE_CAREFUL_OUTDOOR_ACTIVITIES` | PM: `LOC_SENSITIVE_PEOPLE_WEAR_DUST_MASK`; gases: `LOC_SENSITIVE_PEOPLE_SHOULD_BE_CAREFUL` |
| 4 | `LOC_DO_NOT_GO_OUT` | PM: `LOC_WEAR_A_DUST_MASK_WHEN_YOU_GO_OUT`; gases: `LOC_BE_CAREFUL_OUTDOOR_ACTIVITIES` |
| 5 | — | `LOC_DO_NOT_GO_OUT_ON_SENSITIVE_PEOPLE` |
| 6 | — | `LOC_DO_NOT_GO_OUT` |

Guides are written to `<pollutant>ActionGuide` on `airInfo.last` / `airInfoList[].last` only: domestic [`_insertAirInfoStr`](../../server/controllers/controllerTown.js#L3254-L3292) and world [`makeAirInfo`](../../server/controllers/worldWeather/controllerWorldWeather.js#L2103-L2127). The table above was produced by synthetic execution of `getActionGuide` for grades 1–7 with an identity translator. **Source anomaly (source reading, not reproduced):** `insertStrForData` assigns `airUnit` only inside its `req.current.arpltn` branch, so when the current record has no `arpltn` the domestic `airInfo`/`airInfoList` labels and guides are built with `airUnit` `undefined`, which selects the AirKorea labels and guide for any requested standard ([L3306-L3329](../../server/controllers/controllerTown.js#L3306-L3329)).

### Where each standard is applied

| Stage | Rule | Source |
| --- | --- | --- |
| Domestic `current.arpltn`, `airInfo.last` (`KecoController.recalculateValue`, run by `convertUnits`) | For `airkorea`, a stored provider `<p>Grade` other than `-1` is kept. Otherwise `<p>Index` and `<p>Grade` are recomputed from `<p>Value`; grade `-1` deletes `<p>Grade`, `<p>Value` and `<p>Str`. `<p>Index` is set for all six pollutants; it is `NaN` (JSON `null`) when there is no gradable value (`0` for `aqicn` gases and CO). `aqiValue` = `aqiIndex` = `khaiValue` = the **maximum pollutant index**, and `aqiGrade` = `khaiGrade` = `value2grade(airUnit, 'aqi', max)`. The provider KHAI value is not used (TW-248 comment) | [kecoController.js L32-L95](../../server/controllers/kecoController.js#L32-L95), [convertUnits](../../server/controllers/controllerTown24h.js#L1813-L1823) |
| Domestic hourly forecast series | `value2grade` per requested standard; the `aqi` series value is the pollutant's index | [L763-L830](../../server/controllers/controllerTown24h.js#L763-L830) |
| Domestic daily series (from the regional forecast) | Regional grade 0–3 plus 1 is turned into an `airkorea` band with `grade2minMaxValue('airkorea', …)`. `val = Math.round((min+max)/2)`, then `minGrade`/`grade`/`maxGrade` are recomputed with the requested standard | [L1015-L1063](../../server/controllers/controllerTown24h.js#L1015-L1063) |
| World `mergeAqi` (DSF chain) | Each WAQI per-pollutant index → `extractValue`, then `so2`/`no2`/`o3` ppb → ppm (`ppb2ppm`). `airnow`: `<p>Grade` = `index2Grade` of the provider index, `aqiValue` = provider `aqi`, `aqiGrade` = maximum pollutant grade. `airkorea_who`: `value2grade`, `aqiValue` = maximum index, `aqiGrade` = maximum grade. `airkorea`: `value2grade`, `aqiValue` = maximum index **+ 75** when three or more pollutant indices exceed 100, **+ 50** when two do, and `aqiGrade` = `index2Grade`. Other values (`aqicn`): `value2index('aqicn')` and `index2Grade('aqicn')` | [L2003-L2087](../../server/controllers/worldWeather/controllerWorldWeather.js#L2003-L2087) |
| World `current.arpltn` (`_makeArpltn` in world `convertUnits`) | Copies `<p>Value/Grade/Str`, mirrors `aqi*` to `khai*`, and sets `<p>Index` = `value2index(airUnit, …)` (`aqiIndex` = `aqiValue`) | [controller.ww.units.js L107-L134](../../server/controllers/worldWeather/controller.ww.units.js#L107-L134) |

**Differences a rewrite must decide on:**

1. **Domestic versus world `airkorea` AQI.** The domestic path uses the plain maximum index; the world path adds the +50/+75 multi-pollutant bonus.
2. **Daily ozone grade (synthetic execution).** The expression was evaluated for regional grades 1–4 under all four standards. Because `Math.round` is applied to a ppm midpoint, `o3` `val` is always `0` and `grade` is always 1, while `minGrade`/`maxGrade` follow the band. For example, `airkorea` regional grade 3 gives `[minGrade, grade, maxGrade] = [3, 1, 3]`. Under `airkorea_who`, `airnow` and `aqicn` the band can also span several grades (for example `airnow` pm25 regional grade 4 → `[4, 6, 6]`).
3. **World `aqicn` label (source reading, not reproduced).** The `aqicn` branch calls `UnitConverter.airGrade2Str(thisTime.aqiGrade, 'aqi', res)` with the arguments in the wrong order ([L2086](../../server/controllers/worldWeather/controllerWorldWeather.js#L2086)). The grade number is passed as `airUnit` and `'aqi'` as the grade, so `aqiStr` becomes `""` and a warning is logged.

Push-message use of these converters is covered in [server push and purchase](server-push-and-purchase.md).

## 6. Derived indices

[`insertIndex`](../../server/controllers/controllerTown.js#L3131-L3224) computes these fields on the KMA `current` record (from `t1h`) and on every `short` row (from `t3h`). It runs before `convertUnits` in the v000903 chain ([route list](../../server/routes/v000903/route.kma.v000903.js#L53-L60)), so all formulas take °C, m/s and %. Afterwards `convertUnits` converts only `sensorytem` and `heatIndex` to a non-default temperature unit, with `Math.floor` for °F ([L2127-L2136](../../server/controllers/controllerTown24h.js#L2127-L2136)). Grades and `*Str` values keep their °C-based meaning. World rows compute none of these indices: world `sensorytem` is the provider's apparent temperature (`ftemp_c` or `ftemp_f` by requested unit, [controller.ww.units.js L181-L188](../../server/controllers/worldWeather/controller.ww.units.js#L181-L188)).

`T` is temperature (°C), `V` wind speed (m/s) and `RH` relative humidity (%). All `*Str` fields below use `grade2strHighLow` ([L28-L38](../../server/controllers/lifeIndexKmaController.js#L28-L38)): 0 `LOC_LOW`, 1 `LOC_NORMAL`, 2 `LOC_HIGH`, 3 `LOC_VERY_HIGH`, 4 `LOC_HAZARD`.

| Fields | Condition | Formula | Grades | Source |
| --- | --- | --- | --- | --- |
| `sensorytem` (step 1, wind chill) | `wsd` defined | `W = 3.6·V` km/h. If `W > 4.8`: `13.12 + 0.6215·T − 11.37·W^0.16 + 0.3965·W^0.16·T`, capped at `T`; else `T`. `V < 0` returns `T`. Rounded with `toFixed(1)` | Text only through `sensorytemStr` ([§4](#4-other-code-to-text-mappings)) | [`_getNewWCT`](../../server/controllers/controllerTown.js#L5172-L5191) |
| `dspls`, `dsplsGrade`, `dsplsStr` (discomfort) | `reh` defined | `round(1.8·T − 0.55·(1 − RH/100)·(1.8·T − 26) + 32)`; `-1` when `T < -50` or `RH < 0` | `< 68` → 0, `< 75` → 1, `< 80` → 2, else 3; `-1` → 0 | [L378-L420](../../server/controllers/lifeIndexKmaController.js#L378-L420) |
| `decpsn`, `decpsnGrade`, `decpsnStr` (decomposition; source comment says "deleted") | `reh` defined | `round(max(0, (RH − 65) / 14 · 1.054^T))`; `-1` on invalid input | `> 7` → 2, `> 3` → 1, else 0 | [L437-L469](../../server/controllers/lifeIndexKmaController.js#L437-L469) |
| `heatIndex`, `heatIndexGrade`, `heatIndexStr` | `reh` defined | NWS Rothfusz regression on `t2 = 1.8·T + 32` and `RH`, with the low-humidity (`RH < 13`, 80–112 °F) and high-humidity (`RH > 85`, 80–87 °F) adjustments. For `t2 < 80` °F the result is `T`. Back to °C, 1 decimal; `-1` on invalid input | `≥ 66` → 4, `≥ 54` → 3, `≥ 41` → 2, `≥ 32` → 1, else 0 | [L487-L540](../../server/controllers/lifeIndexKmaController.js#L487-L540) |
| `sensorytem` (step 2, final) | `reh` defined | `round(sensorytem₁ + heatIndex − T)`, i.e. wind chill plus the heat-index excess | — | [L3162-L3164](../../server/controllers/controllerTown.js#L3162-L3164) |
| `freezeGrade`, `freezeStr` (pipe freezing) | `reh` defined and `req.yesterdayMinTemperature` truthy | `T ≤ -10` → 3; `T ≤ -5` and yesterday min `< -5` → 2; `T ≤ -5` otherwise → 1; else 0 | as formula | [L579-L593](../../server/controllers/lifeIndexKmaController.js#L579-L593) |
| `frostGrade`, `frostStr` (frostbite; source comment says "deleted") | Always when the temperature is defined | `T < -5` → 2, `T < -1.5` → 1, else 0 | as formula | [L552-L561](../../server/controllers/lifeIndexKmaController.js#L552-L561) |

**Yesterday's minimum.** `getCurrent` takes `tmn` from the first `short` row dated yesterday whose `reh !== -1` and `tmn !== -50`. It stores `0` when none is found ([L789-L814](../../server/controllers/controllerTown.js#L789-L814)). Because `insertIndex` tests truthiness, `freezeGrade` is omitted both when no minimum was found and when the minimum is exactly 0 °C.

**Synthetic execution (characterization seeds).** The functions were extracted from source text and evaluated in Node 24.21.0:

| `T`, `V`, `RH` | Wind chill | `heatIndex` | Final `sensorytem` | `dspls` (grade) | `decpsn` (grade) | `heatIndexGrade` | `frostGrade` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| -10, 5, 50 | -17.4 | -10 | -17 | 26 (0) | 0 (0) | 0 | 2 |
| 5, 3, 60 | 2.5 | 5 | 3 | 45 (0) | 0 (0) | 0 | 0 |
| 25, 2, 80 | 25 | 25 | 25 | 75 (2) | 4 (1) | 0 | 0 |
| 30, 2, 70 | 30 | 35 | 35 | 81 (3) | 2 (0) | 1 | 0 |
| 33, 1, 80 | 33 | 48.1 | 48 | 88 (3) | 6 (1) | 2 | 0 |

The heat index is discontinuous at 80 °F: at `RH` 90 it returns 26.6 for `T` 26.6 but 30.3 for `T` 26.7.

**Source anomalies (not reproduced end to end).**

1. **Short rows use the current decomposition value.** Each `short` row's `decpsnGrade` is computed from `req.current.decpsn`, not `short.decpsn` ([L3197](../../server/controllers/controllerTown.js#L3197)).
2. **Missing wind with valid humidity.** Step 2 subtracts from an undefined step-1 value, which gives `NaN`, serialized as `sensorytem: null`. `getCurrent` turns a `wsd` of `-1` into `undefined`, so a current record without wind but with humidity reaches this branch.
3. **Humidity sentinel.** A `short` row that still holds `reh: -1` passes the `!= undefined` test. `heatIndex` becomes `-1`, and the final `sensorytem` shifts by `-(T + 1)`.

**Client use.** The forecast templates show the discomfort row only when `dspls > 60`, and the feels-like row only when `sensorytem` is truthy, so 0° is hidden ([tab-forecast.html L171-L183](../../client/www/templates/tab-forecast.html#L171-L183); the same rows are in `ta-tab-weather.html`). `grep -rnw` finds no `client/www` reference to `decpsn`, `heatIndex`, `freezeGrade`, `freezeStr`, `frostGrade` or `frostStr`.

## 7. Summary and description precedence

v000901–v000903 KMA and the v000901/v000902 DSF chains (v000902 is also mounted as v000903 `/dsf/coord`) produce three current-record strings through [`getSummaryAfterUnitConverter`](../../server/controllers/controllerTown24h.js#L1565-L1593) (KMA) and [world `makeSummary`](../../server/controllers/worldWeather/controller.ww.units.js#L90-L103). The helpers are shared; world uses `thisTime[1]` as current and `thisTime[0]` as yesterday. The steps run **after** `convertUnits` (and, on KMA chains, `insertStrForData`), so every numeric comparison uses requested units. The client shows `summaryWeather`, or `summary` when it is empty, and shows `summaryAir` as a separate line ([row vocabulary](client-data-contracts.md#weather-row-vocabulary-consumed-by-screens)).

### `summary` and `summaryWeather`

[`makeSummary`](../../server/controllers/controllerTown.js#L2139-L2289) (combined) and [`makeSummaryWeather`](../../server/controllers/controllerTown24h.js#L1440-L1556) (weather only) build a candidate list in this order:

| # | Candidate (when present) | Text | Grade |
| --- | --- | --- | --- |
| 1 | Yesterday comparison: current and yesterday both have `t1h` | `LOC_SIMILAR_TO_YESTERDAY` when `round(Δt1h) = 0`, else `LOC_THAN_YESTERDAY` with `+n`/`-n` ([`_diffTodayYesterday`](../../server/controllers/controllerTown.js#L3518-L3546)) | `round(\|Δt1h\|)`, raised to **2.5** when ≤ 2 |
| 2 | Weather: current has a `weatherType` property | `current.weather` ([`weatherType` codes](#weathertype-codes)) | 2.5; **3** when `weatherType > 3` |
| 3 | Warning: `current.specialInfo` exists (v000903 KMA only) | `weatherStr + levelStr` of `specialInfo[0]` | `weather + 5`; see [weather warnings](server-response-assembly.md#domestic-currentspecialinfo) |
| 4 | Air (combined `summary` only) | `LOC_PM25`, `LOC_PM10` or `LOC_AQI` + `<p>Str`. Start with `pm25Grade`; `pm10Grade` replaces it only if strictly higher, then `aqiGrade` likewise. `khaiGrade`/`khaiStr` take precedence over `aqi*` | The chosen raw grade (1–4 or 1–6, [§5](#grade-index-and-label-rules)) |
| 5 | Precipitation: `rn1` and `pty` both truthy | `LOC_RAINFALL` / `LOC_PRECIPITATION` / `LOC_SNOWFALL` for `pty` 1/2/3 + `rn1` + `precipitationUnit`. **Overwrites** `current.ptyStr` and `current.rn1Str` from [§4](#4-other-code-to-text-mappings) | `rn1 + 3` |
| 6 | Discomfort: `dsplsGrade` truthy (≥ 1) and `t1h ≥ 20` | `LOC_DISCOMFORT_INDEX` + `dsplsStr` | `dsplsGrade` (1–3) |
| 7 | Feels like: `sensorytem` truthy and ≠ `t1h` | `LOC_FEELS_LIKE` + `sensorytem` + `˚` | `\|round(sensorytem − t1h)\|` |
| 8 | UV: `ultrv` truthy and hour ≤ 15 | `LOC_UV` + `ultrvStr` | `ultrvGrade`, **+1** when hour ≥ 11 |
| 9 | Wind: `wsdGrade` and `wsdStr` truthy | `wsdStr` | `wsdGrade + 1` |

**Selection.** Candidates are sorted by grade, descending. The text is the top candidate, or the top two joined with `", "`. An empty list gives `""` with an error log; an exception inside the step also sets `summary = ''` ([L1586-L1590](../../server/controllers/controllerTown24h.js#L1586-L1590)). The step is skipped when `req.current` or `req.currentList` is missing. Ties keep insertion order. Each list has at most nine entries: V8 used insertion sort for short arrays before 7.0 and stable TimSort afterwards, so the order is stable either way. This is library-semantics reasoning; the production Node version was not checked.

**Consequences for a rewrite (source reading).**

- **Unit dependence.** Candidates 1, 5, 6 and 7 compare converted values. In °F, a yesterday difference grades about 1.8 times higher, and the discomfort guard `t1h ≥ 20` passes at about −6.7 °C. In inches, a rainfall candidate grades barely above 3.
- **Zero is falsy.** `rn1`, `sensorytem`, `ultrv` and `wsdGrade` are tested by truthiness, so a 0° feels-like or a 0 grade never qualifies.
- **Two families of 2.5.** The yesterday and weather candidates both default to 2.5. With no other candidate, the result is "yesterday, weather" in insertion order.
- **History fill (2116c6bf, source reading).** With `ASOS_HISTORY_READ_ENABLED=true`, `mergeCurrentByStnHourly` can fill a missing `t1h` (and other fields) on past `currentList` rows from ASOS before `setYesterday` picks the yesterday row, so candidate 1 can appear where it was absent before ([v000903 order](../../server/routes/v000903/route.kma.v000903.js#L53-L60)).
- **Hour source.** The hour comes from `current.time`, which is an integer hour after `convertUnits` ([L1743](../../server/controllers/controllerTown24h.js#L1743)). `makeSummary` also accepts an `HHMM` string (divided by 100) for older chains, but its `+1` test reads the raw `current.time`.

### `summaryAir`

[`makeSummaryAir`](../../server/controllers/controllerTown24h.js#L1345-L1438) reads `current.arpltn`, or `current` itself when there is no `arpltn`.

1. Copy `khaiValue`/`khaiGrade`/`khaiStr` over `aqi*` when present.
2. Take the maximum over every key containing `Grade`, excluding `Grade24`.
3. Maximum ≤ 0 → `""` (warning). Maximum 1 → `LOC_AIR_QUALITY_IS_GOOD`. Maximum 2 → `LOC_AIR_QUALITY_IS_MODERATE`.
4. Maximum ≥ 3 → build items for `pm25`, `pm10` and `o3` when `<p>Value` is truthy, and for `no2`, `so2` and `co` when `<p>Grade` is truthy. Each item is `LOC_<P> <value> <p>Str`. Sort by `<p>Index`, descending, and return the first item.

**Source anomalies (not reproduced).**

- Without `arpltn`, step 2 scans the weather record itself, so `dsplsGrade`, `wsdGrade`, `heatIndexGrade`, `ultrvGrade` and similar fields count as air grades.
- Grade 3 means "unhealthy" under `airkorea*` but "unhealthy for sensitive groups" under `airnow`/`aqicn`. The pollutant line therefore appears one category earlier on the six-grade scales.

### Older routes and `/daily`

- **Older KMA routes.** v000705 and v000803 call the base [`getSummary`](../../server/controllers/controllerTown.js#L2297-L2351); these chains run no `convertUnits`. It produces only `summary`, using the same `makeSummary`, and sets it to `''` when no yesterday record at or after the current hour exists. These chains do not run `checkQueryValidation`, so without a `precipitationUnit` query the precipitation candidate evaluates `rn1 + undefined`, which gives the text `NaN` (source reading, not reproduced).
- **`/daily`.** [`makeDailySummary`](../../server/controllers/controllerTown24h.js#L401-L579) builds hard-coded Korean text, not `LOC_*` keys. The day part uses today before 18:00 and tomorrow from 18:00. It contains an AM→PM emoji, or the day emoji, and then `taMin˚/taMax˚`. Next comes `강수확률 pop%` when the day's `pty > 0`, its `pop` is truthy and the current `pty ≤ 0`. Today's `pop` is first recomputed as the maximum over the remaining short slots. Then `미세먼지 <str>` when the worse PM regional grade is > 1 (0-based, so 나쁨 or worse), `자외선 <str>` when `ultrvGrade ≥ 2`, and `오존 <str>` when the regional `O3Grade ≥ 2`. The hourly title contains the current emoji, `t1h˚`, `대기 <khaiStr>` when `khaiGrade` is truthy, and `ptyStr rn1Str` when `pty > 0` and `rn1` is defined.

## 8. Unit conversion

The request query selects the output units. `checkQueryValidation` substitutes `C`, `m/s`, `hPa`, `km`, `mm` and `airkorea` for a missing key or the literal `(null)` and has no allow-list ([KMA](../../server/controllers/controllerTown24h.js#L55-L67), [world](../../server/controllers/worldWeather/controller.ww.units.js#L16-L35), [defaults](../../server/lib/unitConverter.js#L278-L281)). The choices the app offers are listed in [units, query strings and headers](client-data-contracts.md#units-query-strings-and-headers). Air standards are in [§5](#5-air-quality-standards-server).

**Evidence.** Values marked *probe* are synthetic execution by [server-unit-conversion.js](../../reports/rewrite-verification/probes/server-unit-conversion.js) (Node v24.21.0, 2026-09-25; [record](../../reports/rewrite-verification/probes/server-unit-conversion.json), 13 of 13 checks match). The probe requires `unitConverter.js` unchanged. It runs `_convertWeatherData`, `_convertThisTimeWeather` and the client `getTemp`, extracted verbatim from source, on synthetic values. It runs no request chain, so which fields reach a given response remains source reading. Everything else in this section is observed source.

### Converter rules

`UnitConverter.convertUnits(from, to, val)` ([L243-L272](../../server/lib/unitConverter.js#L243-L272)) works in three steps:

1. `val == undefined` (`undefined` or `null`): the value is returned unchanged and a warning is logged.
2. `from == to` (loose equality): the value is returned unchanged and **not rounded**.
3. Otherwise `from` selects the family. Every numeric result is `parseFloat((val × k).toFixed(1))`, one decimal. The probe checked each numeric factor at 1, 10, 12.34, −1, 0.05 and 1013.25.

| From | To | Factor or rule | Notes |
| --- | --- | --- | --- |
| `C` | `F` | `val / (5/9) + 32` | Any other target returns the value with a warning ([L16-L34](../../server/lib/unitConverter.js#L16-L34)) |
| `F` | `C` | `(val − 32) / (9/5)` | No server path calls it: world °C comes from stored fields |
| `m/s` | `mph`, `km/h`, `kt` | 2.236936, 3.6, 1.943844 | `bft`: Beaufort band of the unrounded value |
| `mph` | `km/h`, `m/s`, `kt` | 1.609344, 0.44704, 0.868976 | `bft`: band of the value converted to m/s and rounded to 1 decimal |
| `km/h` | `mph`, `m/s`, `kt` | 0.621371, 0.277778, 0.539957 | `bft`: as for `mph` |
| `kt` | `mph`, `km/h`, `m/s` | 1.150779, 1.852, 0.514444 | `bft`: as for `mph` |
| `bft` | `m/s`, `mph`, `km/h`, `kt` | Lower band edge in m/s ([L78-L94](../../server/lib/unitConverter.js#L78-L94)), then 2.236936, 3.6, 1.943844 | `m/s` returns the edge unrounded. A non-integer Beaufort value has no edge (`undefined`, or `NaN` after a factor) |
| `hPa`, `mb` | `mmHg`, `inHg` | 0.750062, 0.02953 | `hPa` ↔ `mb` is the identity, returned unrounded ([L184-L223](../../server/lib/unitConverter.js#L184-L223)) |
| `mmHg` | `inHg`, `hPa`/`mb` | 0.03937, 1.333224 | |
| `inHg` | `mmHg`, `hPa`/`mb` | 25.4, 33.863882 | |
| `km` / `mi` | any other value | 0.621371 (to miles) / 1.609344 (to km) | **`to` is ignored** ([L225-L232](../../server/lib/unitConverter.js#L225-L232)) |
| `mm` / `in` | any other value | 0.03937 (to inches) / 25.4 (to mm) | **`to` is ignored** ([L234-L241](../../server/lib/unitConverter.js#L234-L241)) |

An unknown wind or pressure target returns `undefined`, which JSON omits. An unknown `from` logs an error and returns the value. Server paths always convert from the defaults, so only the `C`, `m/s`, `hPa` and `km` rows and the `mm` precipitation row are reachable.

**Beaufort bands.** `_getBeaufort(ms)` ([L36-L76](../../server/lib/unitConverter.js#L36-L76)) uses lower-inclusive edges: 0 below 0.3 m/s, then 1 from 0.3, 2 from 1.5, 3 from 3.3, 4 from 5.5, 5 from 8.0, 6 from 10.8, 7 from 13.9, 8 from 17.2, 9 from 20.7, 10 from 24.5, 11 from 28.4 and 12 from 32.6. Negative values give 0. `NaN` matches no branch and gives `undefined` (source reading). *Probe:* every edge and every edge − 0.01 falls in the expected band. The pre-rounding decides edge cases: `km/h` 1.07 → 0.3 m/s → 1, although the unrounded 0.297 m/s would be 0. Likewise `mph` 3.3 → 1.5 → 2 and `kt` 2.9 → 1.5 → 2.

### Where conversion runs

| Path | Fields and rule | Source |
| --- | --- | --- |
| KMA rows (`current`, `current.yesterday`, `shortest`, `short`, daily) in the v000901, v000902 and v000903 KMA chains | 1. `s06`, `sn1` and `s1d` are multiplied by 10 (cm → mm) unconditionally, before any unit check.<br>2. `t1h`, `sensorytem`, `dpt`, `heatIndex`, `t3h`, `tmx`, `tmn` and `t1d` convert only when `temperatureUnit` is not `C`. A value of exactly `-50` is skipped. In `F` the 1-decimal result is then **`Math.floor`ed**.<br>3. `rn1`, `rs1h`, `rs1d`, `r06`, `s06`, `sn1` and `s1d` convert only when `precipitationUnit` is not `mm` (see A04 below).<br>4. `wsd`, `hPa` and `visibility` always pass through `convertUnits`; in the default unit they come back unchanged | [`_convertWeatherData`](../../server/controllers/controllerTown24h.js#L2094-L2157), called from [`convertUnits`](../../server/controllers/controllerTown24h.js#L1724-L1830) |
| World rows (`thisTime`, `shortest`, `daily`, `hourly`) in the v000901 and v000902 DSF chains; v000902 also serves `/v000903/dsf/coord` | Temperatures are **copied, not converted**. `C` selects the stored `*_c` fields and `F` the `*_f` fields for `t1h`, `t3h`, `sensorytem`, `tmx` and `tmn`. Any other value leaves them unset. DSF stores each `*_f` field as the provider value at 1 decimal and derives `*_c` from it. `precip` becomes `rn1` on `thisTime` and `shortest` rows and on daily or hourly rows at or before the current time; later daily or hourly rows get `r06`/`s06` by `precType` ([§2](#2-kma-pty-versus-world-prectype)). `windSpd_ms` becomes `wsd`, `press` becomes `hPa` and `vis` becomes `visibility`, all through `convertUnits`. Daily and hourly precipitation is rounded again with `toFixed(1)` | [ww units L170-L336](../../server/controllers/worldWeather/controller.ww.units.js#L170-L336); DSF [current](../../server/controllers/worldWeather/controllerWorldWeather.js#L2838-L2843), [hourly](../../server/controllers/worldWeather/controllerWorldWeather.js#L2693-L2697), [daily](../../server/controllers/worldWeather/controllerWorldWeather.js#L2531-L2543) |
| Client display | `getTemp` returns `Math.round(temp)` in `F` and the value unchanged in `C`. It formats the current temperature in `tab-forecast.html`, `tab-dailyforecast.html` and `ta-tab-weather.html`, and the feels-like line only in `tab-forecast.html` and `ta-tab-weather.html` | [controller.forecastctrl.js#L645-L656](../../client/www/js/controller.forecastctrl.js#L645-L656) |

### Consequences

- **Fahrenheit rounding differs by provider (probe).** On the KMA path 0.5 °C becomes 32.9 and is floored to 32, which the client shows as 32. A stored world `temp_f` of 32.9 passes through and the client shows 33. The floor also turns −0.5 °C into 31 and −10.3 °C into 13, and it applies to `sensorytem`, `heatIndex` and daily `tmx`/`tmn` as well. `getTemp` rounds −0.5 °F to 0.
- **[A04](decisions-and-open-questions.md#source-anomalies-requiring-characterization) changes no output (probe).** The precipitation branch passes `windSpeedUnit` as the target ([L2140-L2146](../../server/controllers/controllerTown24h.js#L2140-L2146)). `_convertPrecipitation` ignores its target, so `rn1` 12.5 mm gives 0.5 in for `mph`, `m/s`, `km/h`, `kt` and `bft` alike, and so does `convertUnits('mm', 'm/s', 12.5)`. Any `precipitationUnit` other than `mm` produces inches. The argument is still wrong. Only a literal `windSpeedUnit=mm` would change the result, through the `from == to` shortcut (source reading).
- **Coarse precision (probe).** Values from 0.1 to 1.2 mm become 0 in; 1.3 mm becomes 0.1 in. 1013.2 hPa becomes 29.9 inHg.
- **Unit-dependent thresholds.** Text and summary steps compare the converted values ([§4 unit dependence](#4-other-code-to-text-mappings), [§7](#7-summary-and-description-precedence)).

#### Sentinels after conversion

The earlier stages decide which rows still hold a sentinel ([§1](#1-kma-products-categories-and-sentinels)); `getCurrent` removes them from the current record before this step. In the default unit a `-1` passes through unchanged, so a client-side test for `-1` works only in default units. All results below are from the probe.

| Input (default unit) | Requested unit | Result |
| --- | --- | --- |
| `rn1` or `r06` `-1` mm | `in` | `-0`, which serializes as JSON `0` and cannot be told apart from no rain |
| `s06` `-1` cm | `mm` (default) / `in` | `-10` / `-0.4`, because the × 10 step runs first |
| `wsd` `-1` m/s | `mph` / `km/h` / `kt` / `bft` | `-2.2` / `-3.6` / `-1.9` / `0` (Beaufort calm) |
| `hPa` `-1` | `inHg` / `mmHg` | `-0` (JSON `0`) / `-0.8` |
| `visibility` `-1` km | `mi` | `-0.6` |
| temperature `-50` | `F` | KMA skips it, so `-50` is returned with a °F label. The converter alone would return `-58` |
| `undefined`, `null` | any | Unchanged, with a warning log |

**Rewrite guidance (proposal).** Convert once, from canonical stored units, and round only for display. Map sentinels to `null` before any conversion. Choose one Fahrenheit rounding rule for all providers, and return the unit with the value. Take the expected values for [V05](verification-matrix.md#minimum-behavior-matrix) from the probe record.

## Limitations

- **Evidence scope.** Everything here is observed source at the baseline, plus synthetic execution of isolated pure functions with stub loggers and an identity translator. The unit-conversion run has a checked-in probe and record ([§8](#8-unit-conversion)). The icon, AQI converter, derived-index and daily pollutant regrading runs do not; their inputs and outputs are recorded only in this document. No end-to-end request, database read, provider call or client rendering was performed. Anomaly notes marked "source reading" describe code paths, not observed responses.
- **Provider semantics.** Unit, code and averaging-period meanings come from source comments. The KMA, AirKorea, DSF/DarkSky and WAQI specifications were not consulted. The retired KMA service may encode values differently from its successors.
- **Not covered here.** Native widget and bundled platform copies were not checked for these fields. Push text builders are in [server push and purchase](server-push-and-purchase.md). Warning codes are in [weather warnings](server-response-assembly.md#8-weather-warnings). The client AQI legend is in [AQI standard tables](client-data-contracts.md#aqi-standard-tables).
- **Revision binding.** Line anchors are bound to `bd6640f2`. Anchors into lines unchanged since `ff7acf39` were moved mechanically; anchors into changed code were re-pointed by hand. The synthetic runs (icons, AQI converter, derived indices, unit probe) used `ff7acf39` sources that are unchanged at `bd6640f2` (`controllerTown24h.js` changed only in `makeResult`; `aqi.converter.js`, `unitConverter.js`, `lifeIndexKmaController.js` and the icon helpers are not in the upstream diff, and `insertIndex`/`_getNewWCT` in `controllerTown.js` lie outside its changed hunks). Recheck anchors before relying on a specific line after further source changes.
