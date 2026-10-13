Task: issue-2699-s14; owner: Claude builder (S14 worktree); revision/base: 47a96078; date: 2026-10-13.
Authority: AK authorized S14 on 2026-10-13 (relayed by the root coordinator); endpoint pre-merge.
Criteria: AC1-AC4 from [intent](../intent/issue-2699.md).

# Specification

`server2::history` is an internal library. It wires no route and starts no task by itself.
Legacy references are at `47a96078`. KST is UTC+9 throughout; a publication is the S13
`Publication` (`YYYYMMDD`, `HHMM`).

## Demand state (AC2, AC3)

Durable demand lives only under `state/demand/grid/`:

| Object | Body (exact keys, `deny_unknown_fields`) |
| --- | --- |
| `state/demand/grid/request/{nx:03}-{ny:03}.json` | `{"schema":1,"grid":{"nx":N,"ny":N},"lastDemandMs":T,"expiresMs":T+691200000}` |
| `state/demand/grid/push.json` | `{"schema":1,"lastDemandMs":S,"cells":[{"grid":{...},"lastDemandMs":S,"expiresMs":E}, ...]}` |

- Grid: `1 <= nx <= 149`, `1 <= ny <= 253`. The object key must name the body grid.
  Request expiry is exactly `lastDemandMs + 8 days`. Push cells are unique, sorted by grid,
  at most 8,192, with `lastDemandMs < expiresMs <= lastDemandMs + 8 days`.
- No coordinate, address, IP, device, user, subscriber, token, request path or per-request log is
  accepted: any other field or key shape rejects the object. Rejected objects never count as
  demand and are reported as invalid.
- `touch(grid, now)` records request demand. A process keeps the latest demand per grid in
  memory and writes the durable record when none exists, when it expired, or when the stored
  `lastDemandMs` is older than the refresh interval (default 10 minutes). The write is a
  conditional read-modify-write (`If-None-Match: *` or `If-Match`, at most 4 attempts) that keeps
  the larger `lastDemandMs`. The result is `New`, `Resumed` (record existed but expired),
  `Refreshed` or `Unchanged`. After a replacement the durable `lastDemandMs` can trail the true
  last request by at most the refresh interval; coverage (below), not demand, decides whether
  history is complete.
- `replace_push(cells, snapshot_ms, ttl)` replaces the push aggregate (CAS). An older snapshot
  never replaces a newer durable one (also after a conflict retry); memory keeps the newest. The
  S18 push reconciler supplies grid identities only; S14 implements no subscription reader.
- `rebuild()` lists `state/demand/grid/request/` (bounded pages) and reads every record plus
  `push.json`. The active set at `now` is every valid request record and push cell with
  `expiresMs > now`.
- The wire adapter for `HttpS3Transport` accepts only `state/demand/grid/` keys, JSON bodies up to
  4 KiB (request) or 512 KiB (push), fully consumed acknowledgments and bounded LIST XML.

## Capture schedule (AC3)

| Family | S13 request | Cadence and latest publication | Required lookback |
| --- | --- | --- | --- |
| `current` per cell | `ultra-srt-ncst` | hourly `HH00`, `current_base` | 192 slots: hour(t)-191 h .. latest |
| `shortest` per cell | `ultra-srt-fcst` | hourly `HH30`, `ultra_short_base` | publications in the same 192-hour span |
| `short` per cell | `vilage-fcst` | `02,05,...,23` `HH00`, `short_base` | publications from hour(t)-195 h |
| `aws-hourly` national | `aws_hourly(hour)` | hourly `HH00`, `observation_hour` | 192 hours |
| `city-obs` national | `city(hour)` | hourly `HH00`, `observation_hour` | 192 hours |
| `aws-minute` national | `aws_minute(not_before)` | every 2 minutes | 20-minute window |

RSS, mid-range and life-index inputs are latest-only (`getShortRss` reads only future rows) and
remain request-time acquisitions for S15; S14 does not capture them.

Every 10 minutes (legacy current checks run at minutes 2/12/.../52), for every active cell
(request or push demand), the planner emits the latest publication of each per-cell family that
is not already present, then backfill: up to 23 earlier `current` slots (legacy
`PastConditionGather` slots), 23 `shortest` and 7 `short` publications (data.go.kr serves about
one day). Per-cell backfill runs once per KST hour (like the hourly legacy past-condition pass)
and at once for a cell that became active since the previous pass, so a persistent provider gap
is not retried every tick. Backfill left unattempted by a cap or funding stop carries over to
the next tick; national page backfill follows the same once-per-hour rule. While at least one cell is active it also emits
the latest national hourly pages and backfills missing national pages for 192 hours (the KMA
pages accept a past hour). The minute page is requested every 2 minutes only while at least one
cell is active, with `not_before` set to the last captured minute. No timer covers all grids and
no cell without demand is requested.

The runner skips publications already present (captured or found by the index rebuild),
charges each acquisition its worst-case HTTP attempts (two per page up to the family page cap)
against per-tick caps of 2,560 funded and 64 keyless attempts, runs four acquisitions at a time,
stops further data.go.kr calls in the tick after any S08 funding error, publishes every
`Acquired::Complete` through S06 before marking it captured, and records NotPublished, NoData,
Stale and failures without marking. One runner per scope: `CaptureOwner::claim(scope)` returns
`None` while another owner holds the scope in the process. Multi-host capture remains behind
the section 9 coordination gate; publication idempotency and the present-check bound duplicate
spending after a replacement.

## Coverage index and decision (AC1, AC2)

`CaptureIndex` records `(family, key, publication)` for captured groups, captured minute
observation instants, and legacy export snapshots `(legacy kind, key, exportedAt)`. It is
updated after each publish and rebuilt after a replacement from published S06 catalogs only:
per-key monthly listings of `index/v2/{source}/{kind}/{key}/{YYYYMM}` for per-cell and legacy
kinds (legacy catalogs are read for exact export instants) and the national KST-day catalogs.
A raw object without a catalog entry never counts. A listing beyond its page bound or an
unreadable catalog marks the kind incomplete.

`coverage(request, index)` for `{grid, station, at}`:

1. For each family, enumerate the required publications in its lookback.
2. A publication `p` is covered when it is captured, or when a legacy export snapshot `E` for
   the family and key exists with `E - retention <= p <= latest(family, E)` (retention:
   current/shortest/short 191 h, station hourly 10 days, station minute 1 day). A legacy export
   reproduces the legacy store at `E`, including its gaps; publications after `E` must be
   captured. Station exports count only for the requested station; ASOS or station data never
   covers a grid family. Incomplete listings of the family, its export kinds, the minute page or
   station-minute exports yield `Legacy(IndexIncomplete)`.
3. Minute window `(anchor - 20 min, anchor]`: covered when a station-minute export was taken at
   or after `anchor` and no more than one day after the window start, or when captured minutes start at or before `anchor - 20 min`, consecutive captured
   minutes differ by at most 3 minutes and the newest is at least `anchor - 3 min`.
4. Result: `Complete(plan)`; `NeedsLatest(plan, missing)` when only the newest per-cell
   publications are missing (S15 may fetch them on request); otherwise `Legacy(gaps)` naming each
   family/range and `ColdCell::{NeverCaptured, Partial}`. `legacy_asos_read = true` (legacy
   `ASOS_HISTORY_READ_ENABLED`) always yields `Legacy(AsosRead)`. An incomplete index yields
   `Legacy(IndexIncomplete)`.

The plan lists, per family, each required publication with its captured flag and export
snapshots, the yesterday slot (`slot - 24 h`), and the minute window. Helpers reproduce
`updateCurrentListForValidation` slots (`hour(t)-191 h .. hour(t)`) and the daily summary
attribution of `0000` to the previous day's `2400`. `HistoryReader` returns every complete
acquisition of a slot through `CatalogStore::lookup` in S06 order: no revision is dropped.

## Legacy export and import (AC1)

`server2/tools/migration/export_history_seeds.py` is offline: it reads one `mongoexport` file in
the default one-document-per-line form (Extended JSON relaxed or canonical) and writes a seed
file. It opens no network or database connection; producing the export from production is a
separately authorized operator action.

- Collections: `kma.town.current`, `kma.town.shortest`, `kma.town.short` (`--db-version 2.0`);
  `current`, `shortest`, `short` (`1.0`); `KmaStnHourly2`, `KmaStnMinute2` (either). Others are
  rejected. Arrays (`--jsonArray`) are rejected because exact document bytes cannot be retained.
- Each document must match its legacy schema: top-level and data-row keys are allowlisted
  (plus `_id`/`__v`), grid or station identity (32-bit `stnId`) is required. Unknown keys and
  repeated member names at any depth reject the file in both the converter and the importer;
  groups hold at most 20,000 documents and 8 MiB, seeds at most 64 MiB.
- Seed (JSON Lines): line 1 manifest
  `{"schema":1,"tool":"export_history_seeds","collection":C,"dbVersion":V,"exportedAt":ISO,"sourceSha256":H,"documents":N,"groups":G}`;
  then one line per key in first-seen order
  `{"key":{"type":"grid","nx":X,"ny":Y}|{"type":"station","id":"S"},"lines":[...],"documents":[...]}`
  whose documents are the original export lines byte-for-byte, in file order.
- `history::legacy::import` stores each group as one raw record: source `legacy-mongo`, kind
  (`kma-town-current`, `kma-town-shortest`, `kma-town-short`, `current-v1`, `shortest-v1`,
  `short-v1`, `kma-stn-hourly2`, `kma-stn-minute2`), key grid or station, period and partition
  from the KST export instant, `fetched_at_ms = exportedAt`, body = manifest line + `\n` + group
  line + `\n`. Every export instant is a separate revision; a repeated identical import is
  idempotent. `tools/migration/history_seed_import.rs` imports into an explicit loopback S3 peer only.
- `legacy::current_rows` reproduces the legacy read projection of current rows: v2 rows sorted by
  `fcsDate` with `date,time,t1h,rn1,sky,uuu,vvv,reh,pty,lgt,vec,wsd` (absent fields omitted)
  and `pubDate` from the last row in KST `YYYYMMDDHHMM`; v1 the first document's `currentData`
  with the same projection and its stored `pubDate`. Numbers use JavaScript formatting.
- `legacy::minute_rows(station, anchor)` returns exported `KmaStnMinute2` documents with
  `date > anchor - 20 min` sorted by `date` (legacy `_getStnMinute2`).

## Estimate: retained legacy collectors and capture cost (AC3)

Derived from legacy code and docs, not measured. N = 2,033 grids, D = demand cells.
Legacy during coexistence keeps current 24N, ultra-short 48N, short 16N, past-current up to
23N per pass, RSS about 8N (KMA web) and national pages about 900/day. server2 capture per demand
cell per day: 24 current + 24 shortest + 8 short publications (16 calls at 2 pages) = 64 funded
calls plus at most 23+23+7 backfill on new or resumed demand; national pages about 768/day while
any demand exists. Each acquisition writes one raw object per page, one descriptor and one
catalog version (about 3 PUT), so D = 1,000 adds about 64,000 funded calls and roughly 200,000
S3 PUT per day. Real quotas, demand counts and S3 prices remain to be measured before cutover.

## Failure behavior

S3 or provider failure leaves the publication uncaptured; the next tick retries within the same
budgets. A failed demand write returns an error to the caller and keeps the in-memory demand.
Coverage never reports `Complete` without every required publication; requests then stay on
legacy (forwarding is S10/S20 wiring). No grid hour is synthesized.

## Verification

Unit tests with in-memory demand transport and fake source/publisher; integration tests with
the S06 loopback S3 peer and the S13 loopback provider stub; converter tests run the Python tool
on fixtures; a release-mode smoke covers touch, capture, publish, replacement rebuild, coverage,
legacy import and exact readback. fmt, clippy, the full test suite, placement gate and artifact
policy.
