# Current-grid collection and quota budget

The source fix for [#2648](https://github.com/WizardFactory/TodayWeather/issues/2648)
avoids refetching complete current-hour grid observations. It does not increase a
provider entitlement or activate production.

## Coverage and traffic

For N grids, the existing scheduler polls current six times each hour:
144 × N first-pass grid fetches/day, before retries, pages, startup/manual calls
and multiple processes. Complete-publication filtering needs 24 × N successful
current fetches/day. For the deterministic 2,032-grid #2648 current fixture (the forecast budget below
uses the 2,033-grid forecast fixture) this is 292,608
versus 48,768 (83.3% fewer), when every publication is complete and one process
collects it. Missing data/core fields and failed writes remain eligible; optional-only
partial rows use the bounded repair policy below. This is a source/fixture
budget, not measured production usage or a hard quota cap.

Short/ultra-short poll frequency is unchanged; their first poll moved one minute
earlier (see [late and staggered publication](#late-and-staggered-publication-2676)).
With #2676, persisted exact-publication
forecast coverage reduces their ideal first-pass walks from 24N + 96N to 8N + 48N
per day: one walk for each of eight short publications, and for each of 24
ultra-short publications one first walk plus one full refresh walk. KMA updates
ultra-short temperature/humidity/wind every ten minutes after generation, so a
process refreshes every grid once per current ultra-short publication from
`GATHER_SHORTEST_REFRESH_AFTER_MS` (default 2400000 = base+40min, normally the
:14 poll) until one hour later; `0` disables it (24N, values up to about 26 minutes
older than before #2676). For 2,033 grids, forecast first-pass requests fall from
243,960 to 113,848 (53.33% fewer). This assumes one process, successful persistence
and one page per grid; a process restart inside a refresh window adds at most one
more refresh. Actual short responses can require multiple pages: with two pages on
every short grid the forecast HTTP budget becomes 16N + 48N = 64N, or 130,112 at
N=2,033. Retries, pending-grid repairs, startup/manual older publications and
multiple processes add requests. Preserve the [#2604 bounded concurrency/retry
budget](gather-runtime-policy.md#quota-and-key-rotation-2604).

Summed current/short/ultra-short ideal first-pass traffic becomes 80N/day:
24N + 8N + 48N, or 162,640 for 2,033 grids, compared with 264N = 536,712 before
all filtering (69.70% fewer). Pages and repairs make this a conditional lower budget,
not measured production usage or a hard cap. It does not establish approved capacity
or which operations/consumers share quota. Current optional-field repair remains
separate from forecast completion.

### Forecast completion (#2676)

[Forecast flow](../architecture/diagrams/forecast-grid-collection.html) ·
[Editable design](../architecture/diagrams/forecast-grid-collection.json).

The [official service and September 2026 guide](https://www.data.go.kr/data/15084084/openapi.do)
(read 2026-10-03; guide2609 dated2026-09-28) define six ultra-short hours after
publication and short forecasts through +3 KST days for02/05/08/11/14, through +4
for17/20/23. Short slots are hourly before the extension day and three-hourly
on that final day. Coverage requires every expected slot, finite product fields,
and exact product/publication/coordinate. Short requires temperature, sky, humidity,
precipitation type/probability/amount/snow and wind fields. TMN06/TMX15 are required
only when supplied for that issuance (today's TMN only at02; today's TMX through11).
Ultra-short requires temperature, sky, humidity, precipitation type/amount,
wind and lightning; POP is required since 2026-06-23 11KST. WAV remains conditional.
Valid zero and negative temperature/wind/lightning are retained; nonfinite,
schema-sentinel and provider +/-900 missing values remain pending. Existing
precipitation category conversion and API output are unchanged.

A complete callback/page count does not prove a complete forecast. Provider items
outside the expected horizon cannot satisfy an expected slot. Before writes they are
dropped, except a row within one day after the final expected slot that is itself
valid: production row counts (2026-09-26) show one extra slot beyond the computed horizon, which the
previous collector stored. Incoming batches must then contain each expected slot once, match
the requested publication and grid and cover all required slots/fields before
writer admission. DB1 controlled writes replace overlapping required fields from
the requested publication, preserving older outside slots and only the conditional
same-day TMN/TMX and optional WAV described below. DB1 uses the existing top-level
publication string and arrays; DB2 uses exact BSON publication and per-slot time.
No new schema marker/history is added.

Publication identity follows the provider echo. data.go.kr answers an ultra-short
`base_time=HH30` request with `baseTime=HH00` (observed in production on
2026-10-04: request `20261004 1530`, items `baseTime 1500`), and the parser stores
that echo as `pubDate`. Request validation, batch admission and coverage therefore
accept the same-date `HH00` echo and the literal `HH30` request as one ultra-short
publication; any other hour is another publication and is rejected. One response
or batch must carry one publication. Short publications keep exact identity.
Horizon, POP requirement and the refresh window still use the requested time.
The e22c678f deployment compared the echo with `HH30`, rejected every grid
(`received 0, failed 2033`) and was rolled back.

Pre-existing DB1 arrays have no per-field publication provenance to reconstruct,
and pre-existing DB2 rows cannot distinguish a schema default (for example
ultra-short `lgt=-1`) from a received value. Without a schema marker (excluded by
#2676), such legacy rows are trusted only for the publication they already carry
at deployment; every later publication is collected and validated by the new path.
Short has no refresh, so a one-time short re-collection would contradict AC1 (zero
HTTP after coordinator recreation); the scheduled ultra-short refresh (AC1 amendment
below) also re-collects legacy ultra-short rows within an hour. The exposure is at most the in-flight publication per product (about
three hours short, one hour ultra-short) and equals the previous collector's output.
A rollback followed by redeployment, mixed-version processes or manual tools such as
`utils/convertDbForm.js` (which writes DB2 rows without the fence) reopen that window.
The DB1 path that creates a grid's first document is not fenced either: a late older
write and a new run can both insert one when no document exists yet.

A newer publication never suppresses an older requested one in coverage. Writes
are fenced, however, so an explicitly requested older publication whose slots or
document already hold a newer publication walks its pending grids over HTTP, has
every write refused (DB1 error, DB2 no-op) and ends incomplete; it stays pending
while the newer publication is stored. Normal polling only requests the latest
publication, so this costs budget only for manual/out-of-order requests. Normal
polling is unchanged and no historical backfill is scheduled.

After writes, persisted coverage is read again, including failed collection outcomes.
Failed writes and coverage reads cannot become a successful result. Same-product,
same-publication overlaps share one run; different publications receive busy and
stay eligible for the next poll. Products have separate guards. Forecast coverage
reads wait `GATHER_FORECAST_READ_TIMEOUT_MS` (default 10000 ms) with Mongo
`maxTimeMS` one second shorter. DB2 evaluates slot completeness in one aggregation:
it matches the accepted `pubDate` values and expected `fcsDate` values, checks each
slot's payload date/time and required fields with the same field-rule table as the
JS check (BSON comparison order limits values to finite numbers in (-900, 900)), and
returns only grids with every expected slot. The previous `find` transferred every
slot document (134,178 per short publication in production) and took 1.6-2.4 s idle
and 3.1-7.5 s in process, so the former 3000 ms default stopped short polls before
HTTP. DB1 reads stay a `find` on the accepted publication strings; each `forecast-coverage` record reports `readMs`,
and a failed read reports `outcome: read-failed`. `GATHER_FORECAST_DEADLINE_MS`
defaults to 840000 ms (raised from 540000 so the +10-minute re-walk below can finish)
and aborts active HTTP, clears retries and delayed re-walks, fences new writer
admission and releases only its own run. Late callbacks cannot change a newer run.
Already issued Mongo operations can still settle, but cannot replace a newer
publication: DB2 controlled slot updates match only `pubDate <= own` (or no
`pubDate`) and a miss inserts with `$setOnInsert` only when the slot is absent;
DB1 controlled saves compare-and-set the `pubDate` read before merging and refuse
to downgrade a newer document. The slot index is not unique, so two overlapping
upserts of the same absent slot (for example across processes) can still both
insert, as before #2676. The publication fence cannot order two writes of the same
publication (for example an expired first walk and the later ultra-short refresh),
so a coordinator counts each run's admitted writes and refuses another run of the
same publication ("still settling") until an expired run's writes have called back;
other publications proceed. A Mongo operation that never calls back keeps only that
publication from rerunning in the process. This is not a transaction/distributed
lock or Mongo cancellation. Current-observation behavior and its separate repair allowance are
unchanged.

### Late and staggered publication (#2676)

The [September 2026 guide](https://www.data.go.kr/data/15084084/openapi.do)
(guide 260928) states API availability after HH:10 for short publications
(02/05/08/11/14/17/20/23) and after HH:45 for ultra-short `HH30` publications,
which are generated at HH:30 and updated every ten minutes. AK reported on
2026-10-04 that grids of one publication become available at different times and
often later than these times: a grid can answer NO_DATA (`resultCode 03` or no rows)
or still the previous publication. The collection therefore works as follows:

- The first poll runs about two minutes after the provision time: short at UTC
  minute 12 (was 13), ultra-short at 47 (was 48). The remaining ultra-short polls
  (54, 4, 14) are unchanged.
- A grid that answers NO_DATA on its first page, or consistently the previous
  publication, is not retried by the immediate #2604 retry passes. Before this
  change one unpublished grid consumed every pass (70 requests at the default, 180
  in production) and a fully unpublished short poll up to 20,111 requests.
- After a walk, the coordinator reads persisted coverage. Grids still pending for
  any reason (not published, previous publication, incomplete content such as
  missing wind, a conflicting duplicate slot document, failed write or exhausted
  transport retries) are walked again at
  `GATHER_FORECAST_RETRY_AT_MS` offsets from the run start, default
  `180000,480000`: about +5 and +10 minutes after the provision time. Then the run
  ends; remaining grids report `pending` and an error.
- Only the first run of a publication in a process uses these delayed re-walks,
  however that run ends (complete, failed read, key exhaustion or deadline).
  Later scheduled polls of that publication (ultra-short 04 and the 14 refresh;
  short one and two hours later) walk their pending grids once. A run whose keys
  are all rejected (quota/key) makes no delayed re-walk. `none` disables re-walks;
  offsets must increase and stay below `GATHER_FORECAST_DEADLINE_MS`.
- `forecast-pass` records count `notPublished` and `previousPublication` grids;
  each delayed re-walk emits `forecast-retry` with its walk number, pending grids
  and delay, and `forecast-collection` reports `walks`.

Daily request budget for N=2,033 grids (short responses take two pages, a NO_DATA
answer one page; current observations add 24N = 48,792):

| Case | Short | Ultra-short | Forecast total |
|---|---:|---:|---:|
| Every grid complete on the first walk | 8 x 2N = 16N | 24 x 2N = 48N (walk + refresh) | 64N = 130,112 |
| 10% of grids late once, collected at +5 min | +8 x 0.1N to 0.2N | +24 x 0.1N | 67.2N to 68N = 136,618 to 138,244 |
| Every grid answers one-page NO_DATA until after +10 min, every publication | 8 x 5N = 40N | 24 x 5N = 120N | 160N = 325,280 |
| Every grid answers the two-page previous publication or incomplete content until after +10 min | 8 x 8N = 64N | 24 x 5N = 120N | 184N = 374,072 |
| Before #2676 (ideal, no storms) | 24 x 2N = 48N | 96N | 144N = 292,752 |

The 10% row depends on whether a late grid answers one-page NO_DATA or the
two-page previous publication. The NO_DATA row assumes three one-page NO_DATA walks, then a two-page collection at
the next scheduled short poll, and for ultra-short three walks, the 04 walk and the
14 refresh. The previous-publication row counts three two-page short walks plus
the next scheduled two-page collection. Both rows assume one process and no other
failures; transport retries add requests. Approved daily
traffic per key/operation is not established (#2648); the data.go.kr page lists
10,000 development calls per day, below even the normal case. Rotation across
`DONGNAE_SECRET_KEYS` adds capacity only if the quota is counted per key.

### Optional-field repair policy

Each Manager remembers at most two collection admissions per coordinate for its
current publication. Initial and joined polls use one admission together. Once
an exact-hour stored row has valid finite t1h/rn1/pty but incomplete wind or REH,
after two admissions later polls defer it. One initial partial observation can
therefore receive one later repair walk; if that response is complete, subsequent
polls skip it through ordinary coverage. Useful partial observations stay stored.
Deferred rows stay pending and the callback returns an incomplete error, including
when every pending row is deferred and no HTTP is sent. Missing/wrong-hour data
and invalid temperature/rain/type remain eligible on later polls.

The allowance resets when the inactive coordinator starts another publication,
and on process restart. It is a per-process admission policy, not a persisted
repair ledger or shared HTTP quota cap: pages/transport retries, absent/core-invalid
grids, multiple workers, restarts and alternating manual publication requests
remain additional traffic. Values that arrive after the two-admission allowance
is consumed are not fetched again for that publication by that coordinator;
next-hour collection proceeds, and historical gaps remain separately reported.
Measure deferred frequency and decide any historical recovery through a separately
reviewed/authorized policy; no backfill is added here.

For N grids and P consistently optional-only partial grids per publication,
six-poll first-pass volume becomes N+P/hour (24N+24P/day), under one uninterrupted
process and successful persistence, before the exclusions above. The ideal83.3%
current saving applies to P=0. Complete coverage must not be claimed when P>0.

The [official data.go.kr service page](https://www.data.go.kr/data/15084084/openapi.do)
(read 2026-10-03) lists development traffic of 10,000 and operational increase
applications. It defines code 22 as daily exhaustion and code 23 as per-second
exhaustion. This does not verify configured account approval, operation/service
sharing, usage window or other callers. Obtain each key's exact approval from
its existing account before rollout. Even once/hour full-grid collection needs
48,768 current calls/day for 2,032 grids; 10,000 cannot provide that coverage.

## Collection receipts

Preserve sanitized gather stdout; the error-only production logger suppresses
successful info records.

- current-coverage: UTC timestamp, publication, before/after stage, total,
  complete and pending grids. Remaining coverage is an error despite the legacy
  gather route's HTTP 200 response.
- current-repair-plan: UTC time, publication, pending, eligible, deferred and
  limit2. The callback also reports deferred; these rows are included in pending.
- forecast-pass: UTC completion time, KST hour, product/key index, publication,
  attemptsByKstHour including pages, received/pending counts and stop reason.
  Received counts completed fetches; pending equals failed plus rejected. Failed
  counts retryable incomplete rows, rejected counts non-retryable rejected rows.
  These fetch outcomes do not replace persisted coverage.
  Aggregate each pass once by product, key index and KST hour. Fetch counts
  differ from persisted coverage.
- first-quota: UTC response time, KST hour, requestKstDay, product/key index,
  daily-quota/per-second/unclassified-429 reason and current cooldown action.
- forecast-coverage: UTC time, product/publication, before/after stage,
  expected/complete/pending grids and actual httpAttempts.
- forecast-collection: per-product/publication terminal outcome, expected/complete/
  pending and total httpAttempts across pages/retries/key rotations. Read/deadline
  failures report unknown coverage conservatively pending, never complete.
- current-collection-stop: UTC time, publication and static `deadline` reason;
  this is a terminated run, not proof that coverage was recovered.

Records contain no keys, URLs, provider bodies or exception text. A crash before
pass completion can lose its attempt totals. Existing untimestamped logs cannot
reconstruct first-rejection instants. Retain first-quota records and aggregate
windows for future incidents.

Only confirmed code 22 blocks current keys until the next KST day. Other products
retain their own bounded stop/rotation. Each cycle excludes its already rejected
indices as well as any daily-blocked current keys. Memory is per Manager/process; restarts
and multiple workers need separate accounting. This is not a global reservation
or hard daily request cap.

## Rollout and rollback gates

Production deployment/configuration/key changes and backfill require separate
approval. Before an approved action:

1. Check actual deployed Manager/collector and runtime policy; preserve local
   overrides and backups. Deploy both new helpers, Manager and collector together.
   Include forecastGridCollection and both forecast writers for #2676.
   No dependency upgrade/schema migration is required.
2. Verify approved capacity covers current 24N, short 8N and ultra-short 48N
   first-pass walks (ultra-short 24N with the refresh disabled), measured pages and bounded
   retries, other usage and a measured margin. Otherwise obtain an authorized
   entitlement change or reviewed provider design; do not silently drop grids.
3. Run isolated tests below; inspect process count, time basis and log retention.
   Coordinate/coverage reads stop waiting after three seconds without cancelling
   Mongo transport. `GATHER_CURRENT_DEADLINE_MS` defaults to 540000 (nine minutes)
   and bounds the complete current run. On expiry it aborts active HTTP requests,
   clears delayed recursive retries, stops admission of new saves and releases
   only its own active run. Late callbacks cannot clear a later run or admit a
   new write. A previously submitted Mongo read/write may still finish at its
   original publication identity; there is no Mongo cancellation or rollback.
   Different-publication busy remains eligible at the next scheduled poll.
4. After approved activation, read expected current slots across 16:00–22:00 KST
   on successive days. Check full-grid coverage, partial writes, rejection onset
   and measured HTTP budgets. Report historical hourly/daily gaps separately.
   PM2 online, HTTP 200 or station enrichment does not establish recovery.
5. For #2676, observe successive short and ultra-short publications across all
   expected grids/slots, stored values and sanitized per-publication counts.
   Repeated complete short polls must send zero forecast HTTP; ultra-short sends
   exactly one refresh walk per publication per process (AC1 amendment, AK
   2026-10-04; `refresh: true` in `forecast-collection`), otherwise zero. Gaps must
   stay pending.
   Verify the public weather publication/output before reporting production recovery.
   Check `forecast-coverage` `readMs` and `read-failed` frequency on production-size
   collections; a read that exceeds `GATHER_FORECAST_READ_TIMEOUT_MS` before collection
   skips that poll's forecast HTTP. On a production-sized temporary collection
   (579,405 DB2 short documents, 150,442 for the publication; Mongo 4.4 x86_64
   under emulation) the aggregation read took 1.05-1.08 s and the previous `find`
   0.83-0.85 s; production was 2-3x slower than this host for the `find`, so the
   10 s default keeps about 3x headroom over the estimated production read. The
   in-process smoke measured at most 1.2 s for DB2 short. Production read time is
   unmeasured; see [the 2026-10-04 evidence](../evidence/forecast-grid-collection-2026-10-04.md).
6. Check the public API's yesterday comparison against stored observations.
   Merged #2656/#2665 response fixes do not prove primary collection recovery.

Rollback the scoped source change through the existing approved deployment
process. No backfill/data deletion is part of rollback.

## Isolated verification

See [offline commands](../../server/test/offline/README.md#current-grid-collection-2648).
Regression uses real Mongoose 5.1.2 query construction without a DB connection.
Separate HTTP/Mongo smoke uses synthetic responses, actual gather route/Manager/
collector and temporary Mongo. Mongo 7 requires Mongoose 5.13.23's driver;
the smoke adapter does not upgrade deployment or establish provider entitlement.


Forecast smoke uses **actual Mongoose 5.1.2** with compatible temporary Mongo 4.4
on Node 16.20.2 (no newer driver substitution). It exercises all 2,033 synthetic grids
for both products and DB versions with full stored readback, repeat/recreated Manager
zero HTTP, incomplete-grid repair and measured continuation/retry attempts. See
[reproducible forecast commands](../../server/test/offline/README.md#forecast-grid-collection-2676).
This synthetic check establishes implementation behavior, not provider entitlement
or production recovery. Deployment and the AC4 production readback remain pending.

Forecast content-validation failures are non-retryable within the active run and remain pending for a later poll; transport/page failures keep the existing bounded retry policy. Writer errors are retained while other grids finish their retries/key rotation. DB2 coverage combines the exact publication with an expected `fcsDate` horizon range using the existing index. DB1 slot replacement preserves previously valid, conditionally absent same-day TMN/TMX and optional WAV; required fields are always replaced from the requested publication.
