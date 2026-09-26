# Spec: Forecast rain/snow amounts with defined periods — issue 2583 (D45)

Revision 1, 2026-09-26. Consumes [intent](../intent/issue-2583.md) r1 and the investigation report r1 (`reports/sdlc/issue-2583/investigation.md`, local). Owner: main agent.

## Requirements

| ID | Requirement | AC |
| --- | --- | --- |
| R1 | A shared parser turns a `PCP`/forecast `RN1` (mm) or `SNO` (cm) value into `{amount, min, max, approx}` or `null`. | AC2 |
| R2 | The collector stores the representative amount in `r06`/`s06`/`rn1` and, for categories only, the trimmed provider text in `r06Text`/`s06Text`/`rn1Text`. | AC2, AC8 |
| R3 | Both DB versions declare and keep the text fields; DB 1.0 per-field merges update text with its amount. Reads project them. | AC8 |
| R4 | `getShort` sums every stored hourly row into its 3-hour template slot. | AC1, AC4 |
| R5 | RSS amounts copied into a slot are labelled as six-hour amounts. | AC5 |
| R6 | `ControllerTown24h.adjustShort` stops sampling/splitting. A shortest-window slot with three valid hourly `rn1` values replaces `r06` only. Slots without data become a 0 placeholder with period 0. | AC1, AC3 |
| R7 | Daily `r06`/`s06` are the totals of that day's slots; unknown when a six-hour amount is involved. | AC5 |
| R8 | `r06Str`/`s06Str`/`rn1Str` come from the parsed bounds. | AC6 |
| R9 | New response fields state the period and approximation; documented. | AC8 |

## R1 Parser — `server/lib/kmaPrecipitation.js`

`parse(value, unit, noValue)`; `unit` is `mm` or `cm`; text is trimmed; the unit suffix is optional; whitespace around `~`, units and suffixes is allowed; numbers are plain decimals (`^\d+(\.\d+)?$`).

| Input | Result |
| --- | --- |
| `noValue` (`강수없음`, `적설없음`) | `{amount 0, min 0, max 0, approx false}` |
| `N` / `N<unit>`, N ≥ 0 | exact `{amount N, min N, max N, approx false}` |
| `N<unit> 미만`, N > 0 | `{amount N/2, min 0, max N, approx true}` |
| `a~b<unit>`, a < b | `{amount (a+b)/2, min a, max b, approx true}` |
| `N<unit> 이상` | `{amount N, min N, max null (unbounded), approx true}` |
| finite number ≥ 0 (typed number) | exact |
| blank, other text, wrong unit, negative, `Infinity`, `NaN`, exponent, `a~b` with a ≥ b | `null` |

Amounts and bounds are rounded to 0.1. Representative amounts: half the threshold, the range midpoint, or the lower bound. The legacy `R06`/`S06` categories keep their `parseFloat` handling.

Helpers:

- `read(amount, text, unit)`: a text that parses as a category wins; otherwise a finite `amount ≥ 0` is exact; otherwise `null`. Rows from the deployed `parseFloat` gather have no text and are read as exact.
- `total(list)`: ignores `null`; `null` when nothing remains. Sums `amount`, `min`, `max` (`null` if any is unbounded), ORs `approx`, and sums `hours` (default 1 per item).
- `format(total, unit)`: exact → `<amount><unit>` (`10mm`, `0.5cm`); approx with `min 0` → `~<max><unit>`; approx bounded → `<min>~<max><unit>`; unbounded → `<min>~?<unit>`. Literal units, as before; independent of the requested units.
- `assign(row, field, total)`: writes `row[field] = amount`, `row[field+'Hours'] = hours`, `row[field+'Approx'] = approx` and keeps the total (bounds) in a module-level `WeakMap` keyed by the row object; `null` writes `-1` and removes the two fields. `get(row, field)` returns the kept total. The bounds never appear in JSON.
- `finalize(row, field)`: rows without a kept total and a negative/missing value get a 0 placeholder with `Hours 0`, `Approx false`; a non-negative value without a total is kept as exact with `Hours 3` (defensive; not reachable on the v000903 path).

## R2–R3 Collector and storage

- `organizeShortData`: `PCP` → `r06` (+`r06Text`), `SNO` → `s06` (+`s06Text`). `organizeShortestData`: `RN1` → `rn1` (+`rn1Text`). Unparseable values stay `-1`.
- Schemas: `modelShort.shortData[]`, `kma.town.short.model.shortData` add `r06Text`, `s06Text` (`String`); `modelShortest.shortestData[]`, `kma.town.shortest.model.shortestData` add `rn1Text`.
- DB 1.0 `saveShort`/`saveShortest`: whenever `r06`/`s06`/`rn1` is overwritten, set the matching text to the new row's text (undefined clears it). DB 2.0 replaces the whole subdocument per `fcsDate`.
- Reads: DB 1.0 `_getTownDataFromDB` (short and shortest branches) and DB 2.0 `getShortFromDB`/`getShortestFromDB` copy the text when it is a string. Shortest rows then call `assign(row, 'rn1', read(...))`, so `shortest[]` rows carry `rn1Hours 1` and `rn1Approx`, and the text does not reach the response. Short DB rows keep the text for R4 only; the template rows never receive it.
- No migration. Old rows have no text and read as exact values; they age out with normal forecast replacement.

## R4 Slot aggregation (`getShort`)

Slot of an hourly row `(date, HH)`: `HH % 3 == 0` → itself; otherwise `ceil(HH/3)*3`, where 24 becomes next day `0000`. This is the mapping `_createOrGet3hSummaryList` already uses. The template slot `(D, 0000)` therefore holds hours D-1 22, D-1 23 and D 00. After `_mergeShortWithBasicList`, each template row gets `assign(row, 'r06', total(read of its rows' r06/r06Text, mm))` and likewise `s06` (cm). A slot with fewer than three hourly values reports its actual hour count.

## R5 RSS

When `_mergeRssValue` copies `r06`/`s06` into a slot, the slot gets `assign(target, field, {amount v, min v, max v, approx false, hours 6})`. The existing overwrite/fill policy is unchanged.

## R6 `ControllerTown24h.adjustShort`

- Remove the `i += 2` split loop and the `pty`-based `shortestRn1` assignment.
- `_mergeShortByShortest` also groups the same `filterdList` rows by slot; for a slot with exactly three rows and three valid `rn1` values, it keeps `total(read(rn1, rn1Text, mm))` as the row's shortest total (`hours 3`). Existing `short.shortestRn1` stays as before.
- In `adjustShort`, for every row: when a shortest total exists, `assign(row, 'r06', shortest)`; then `finalize` `r06` and `s06`. `s06` is never assigned from `rn1`.
- Past rows keep their observed `rn1` from `mergeShortWithCurrentList`; their `r06`/`s06` are the stored forecast totals.
- Base `ControllerTown.adjustShort` (older routes) is unchanged; it never split amounts.

## R7 Daily totals (`mergeMidWithShort`)

For the rows passed to `overlay`, using the same skips as `_getDaySummaryListByShort` (first row at `2400`, last row at `0000`), group kept totals by date. If any row of the date has no kept total, the date keeps the legacy behavior (sources without totals: DB snapshot rows for days beyond the template and stale-RSS rows, which already omit amounts). If any kept total has `hours > 3`, the date's `r06` (or `s06`) and its `Hours`/`Approx` fields are deleted. Otherwise `assign(dailyRow, field, total(slot totals))` after `_mergeList`. Daily `Hours` is the number of hourly forecasts summed; 24 for a fully covered day (hours 01–24).

## R8 Strings

`_makeStrForKma` computes, for `r06` and `rn1` (mm) and `s06` (cm): `total = get(row, field)` or else `read(row[field], undefined, unit)`; when `total && (total.amount > 0 || pty > 0)`, `row[field+'Str'] = format(total, unit)`. Kept totals are in source units, so strings stay literal `mm`/`cm` after unit conversion. `_convertKmaRxxToStr(pty, value)` becomes a thin exact formatter (`rn1` always mm) for callers without a total.

## R9 Response contract (additive)

| Location | Field | Meaning |
| --- | --- | --- |
| `short[]` | `r06`, `s06` | Forecast rain (mm) / new snow (cm, then ×10 → mm by `convertUnits` as before) over the slot's hours; ≥ 0 |
| `short[]` | `r06Hours`, `s06Hours` | Number of forecast hours summed: 3 for a full slot, 1–2 for partial, 6 for an RSS six-hour amount, 0 for a placeholder |
| `short[]` | `r06Approx`, `s06Approx` | `true` when a category value was used |
| `midData.dailyData[]` | `r06`, `s06`, `r06Hours`, `s06Hours`, `r06Approx`, `s06Approx` | Day total over hours 01–24 of the date; omitted when an RSS six-hour amount is involved |
| `shortest[]` | `rn1Hours` (1), `rn1Approx` | Hourly forecast rain |
| `short[]` | `rn1` | Unchanged: observed three-hour sum on past rows |
| all | `r06Str`, `s06Str`, `rn1Str` | From bounds, literal units |

Old apps keep reading the same names; the values become slot totals instead of halves or samples.

## Failure behavior and compatibility

- Unparseable provider text → `-1` in storage (as today) → placeholder 0 with `Hours 0` in `short[]`.
- Shortest slots with a missing hourly `rn1` (for example the deployed `강수없음 → -1`) fall back to the `PCP` total.
- Mixed deployment: the service works with old gather rows (no text, exact reading). The old service reading new rows sees representative amounts instead of `-1`.
- `DB_DATA_VERSION` 1.0 and 2.0 share parser, read and aggregation code.

## Observability

No new logs. The `adjustShort` "r06 but pty is zero" warning goes with the split loop.

## Verification strategy

- Unit (`node:test`, `precipitation.test.js`): parser table (AC2), slot aggregation (AC1), shortest `pty 3` (AC3), daily totals (AC5), strings (AC6), DB 1.0 per-field merge and both DB read paths (AC8).
- Collector (`gather-code-drift.test.js`): category rows store amount + text; the old split characterization becomes a no-split regression.
- Route smoke (`precipitation-smoke.js`, AC4): real v000903 router with the mixed-period fixture on DB 1.0 and 2.0, SI and imperial-ish units.
- Regression: `test:offline`, RSS/daily/air/weather-desc smokes on Node 16.20.2 and 22.22.2; CI workflow registration.

## Alternatives considered

- Infer categories from values (0 < v < 1, v ≥ 30) without storing text: no schema change, but tied to today's KMA thresholds and wrong for old `parseFloat` rows. Rejected.
- Store numeric bounds fields: needs sentinel rules for unbounded values and more schema fields. Rejected for the raw text, which is lossless.
- Compute daily totals directly from hourly DB rows: would disagree with the shortest-window slots shown in the hourly chart. Rejected.
- Expose bounds in the response: needs unit conversion rules for new fields; the string already carries them. Deferred.

## Amendment 1 — 2026-09-26

Source: build findings on the same day, before any commit. Supersedes the affected parts of revision 1; AC IDs unchanged.

- R3: DB 1.0 `saveShort` kept only the last 64 rows (`MAX_SHORT_COUNT`, "8 days × 8 times"). With hourly rows that dropped the nearest hours. The limit becomes 192 (8 days × 24 hours), matching `MAX_SHORTEST_COUNT`.
- R8: `_convertKmaRxxToStr` has no other caller and is removed instead of becoming a formatter. A zero amount gets a string only for the precipitation type of `pty` (rain `r06`: 1, 2, 4, 5, 6; snow `s06`: 2, 3, 6, 7; `rn1`: any `pty > 0`); a positive amount always gets one.
- R1: added helpers `exact(amount, hours)`, `clear(row, field)`, `keep(row, field, total)`, `copyText(source, target, fields)` and `readShortest(row, stored)`; RSS amounts use `exact(v, 6)`.
- Verification: in the DB 1.0 route harness `shortest[]` is empty on the baseline too, so `shortest[]` fields are checked on DB 2.0; DB 1.0 shortest rows are still checked through the short merge.
- Downstream impact: plan file list (`gather-smoke.js`, `daily-harness.js`, `short-rss-daily.test.js`, `rss-wind.test.js` dependency maps; `server-response-assembly.md`, `server-data-lifecycle.md`), tests.
