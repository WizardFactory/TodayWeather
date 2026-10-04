# Forecast grid rollback fixes — 2026-10-04 UTC

Scope: [issue 2676](https://github.com/WizardFactory/TodayWeather/issues/2676) after the
[rollback report](https://github.com/WizardFactory/TodayWeather/issues/2676#issuecomment-5977503815)
of the e22c678f tw-gather deployment, plus AK's late-publication decision of the same day.
Base e22c678f. Synthetic provider and temporary databases only; no live provider call,
deployment or production recovery is claimed. Production readback (AC4) remains pending.

## Provider contract used

The September 2026 guide (`단기예보조회서비스_API활용가이드_260928`, supplied by AK) defines:

- `getUltraSrtFcst`: request `base_time` in 30-minute units (`0630`), called after HH:45;
  response `baseTime` sample `1200` ("12시00분 발표"). Generated at HH:30 and updated every
  ten minutes (temperature, humidity, wind). Six hourly forecast times.
- `getVilageFcst`: `base_time` 0200…2300, API availability after HH:10.

Production observed the same echo: request `20261004 1530` returned items with
`baseTime 1500`. AK reported that grids of one publication become available at different
times and often after the stated times, answering NO_DATA or the previous publication.

## Red on the base

| Check (new test against e22c678f code) | Observed |
|---|---|
| `forecast-manager.test.js` with the real HH00 echo | DB1 ultra-short: `Forecast collection incomplete: pending=2033` on every repeat poll |
| `forecast-collection-smoke.js` (loopback provider echoes HH00) | ultra-short: `Invalid forecast content remains pending`, no grid written (the production failure) |
| One grid answering NO_DATA, `GATHER_TOWN_RETRY=70` | 70 immediate requests for that grid |

The production coverage-read timeout could not be reproduced on this host: the previous
`find` read took 833-854 ms here for 579,405 DB2 short documents (150,442 for the
publication), while production took 1.6-2.4 s idle and 3.1-7.5 s in process.

## Read design measurements

Temporary Mongo 4.4.29 (x86_64 build under emulation), Node 16.20.2, Mongoose 5.1.2,
2,033 grids x 285 hourly slots. Each value is one read of all 2,033 grids.

| Read | Time (ms) |
|---|---|
| Previous `find` of every slot document | 833-854 |
| Aggregation with `$match` field predicates (`$type` + bounds) | 2,235-2,447 (rejected) |
| Aggregation, `$match` publication/slot only, no validation (lower bound) | 362-378 |
| Final: validation expression inside `$group`, complete grids returned | 1,048-1,094 |

The final read moves document transfer and decoding out of the busy gather process; its
Mongo-side cost is about 1.3x the previous read on this host. Production is unmeasured,
so the default read wait became 10 s (`maxTimeMS` 9 s).

## Green and smoke results on the candidate

- Offline regressions: `forecast-grid-collection`, `forecast-manager`, `forecast-lifecycle`,
  `forecast-late-publication`, `gather-policy`, `current-lifecycle`, `current-manager`, and the
  full `npm --prefix server run test:offline` suite: exit 0.
- `forecast-coverage-mongo-smoke.js`: Mongo and JS completeness agree for 201 short and
  171 ultra-short mutation cases in DB1 and DB2 (every required field with missing, null,
  NaN, string, sentinel and out-of-range values, moved slots, numeric payload time, literal
  and previous-hour echoes). Production-volume reads: 1,082-1,094 ms.
- `forecast-collection-smoke.js`, real loopback HTTP/XML, Manager, collector and writers,
  2,033 grids per product/storage, two late grids per case (one NO_DATA, one previous
  publication):

| Storage | Product | HTTP attempts | Continuation pages | Transient failures | Late grids | Walks | Repeat HTTP | Repair HTTP | Max coverage read (ms) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| DB1 | Short | 4,072 | 2,035 | 1 | 2 | 2 | 0 | 2 | 507 |
| DB1 | Ultra-short | 2,037 | 0 | 1 | 2 | 2 | 0 | 1 | 35 |
| DB2 | Short | 4,072 | 2,035 | 1 | 2 | 2 | 0 | 2 | 1,302 |
| DB2 | Ultra-short | 2,037 | 0 | 1 | 2 | 2 | 0 | 1 | 88 |

Stored ultra-short rows carry the provider echo (`HH00`) as their publication.
With the default offsets, one permanently unpublished grid received three requests
(start, +3 min, +8 min) instead of 70.

Reproduce with the [offline commands](../../server/test/offline/README.md#forecast-grid-collection-2676).
Budget and operating rules: [operations](../operations/current-grid-collection.md#late-and-staggered-publication-2676).

## Review 1 corrections

Review 1 (OpenAI Codex, PR #2681 comment 5978120024) reproduced two issues on 0b09c5c0.
First, a valid and an invalid duplicate of one slot made Mongo report the slot complete,
while the JS check did not. Second, a first run that ended without scheduling a retry
(complete, read failure, key exhaustion, deadline) left later runs eligible for delayed
re-walks. Both rules are now conservative: a slot counts only when every stored duplicate
is valid, in Mongo (`bad` set in `$group`) and in JS; and the admitted first run consumes
the re-walks. New regressions failed on 0b09c5c0 and pass now, including real-Mongo
duplicate cases in both insertion orders. The budget table separates the NO_DATA and
previous-publication worst cases.
