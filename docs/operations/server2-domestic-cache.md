# Domestic forecast memory and local verification

This guide covers complete forecast source views, not a cached HTTP response. The source remains S3-authoritative. It adds no collection schedule, provider mode or production fallback. The task is pre-merge preparation for #2819; it does not close S19/S20 or authorize shadow traffic, deployment or sends.

## Read the ownership boundary

One Source owns immutable Grid(current/shortest/short), RSS and Mid(forecast/land/temp) views. Different original mid-region identifiers stay distinct. A forecast acquisition invalidates the cached generation when its real future starts and retires, including error or cancellation. A publication epoch and active-writer fence prevent readers from reinstalling an older generation. A detached writer keeps this ownership until its real work retires. Existing observation, station, air, life, warning, narrative and zone-list owners remain separate. A cache hit does not skip those other owners or cache a final API body.

Freshness is at most 30 seconds and clips at the relevant minute, day, month, provider/publication retry and source boundaries. Clock rewind misses. Errors do not install a success or serve an expired view. Source Docs retain the existing response rules; raw Items preserve every scalar field for duplicate identity, excluding only fcstValue/obsrValue. The multi-page validator sorts a bounded borrowed index, preserving original item order. Raw Item 64 and canonical Doc 32 limits remain separate.

| Limit | Meaning |
| --- | --- |
|128 MiB retained / 128 keys|Logical weight of mapped immutable entries, including admitted raw/Doc/identity capacities and metadata allowance|
|48 MiB per entry|Raw 32 MiB, Doc 8 MiB and identity 4 MiB sublimits; failed admission does not publish a partial view|
|2 active owners + 8 queued keys|Ten admitted keys, 192 MiB logical workspace per owner ; 8-second owner deadline starts at admission, including queue time|
|128 waiting callers / local CPU 2|Bounded per-Source demand; each caller keeps its own deadline|
|4995 comparison indices|At most 39,960 requested payload bytes on 64-bit plus charged allocation allowance; fallible growth and actual Vec capacity check|
|12 partition lookups per build (#2849)|Consumed in partition order, so acquisitions, scope caps and the first error equal a sequential read; an error, cap or owner deadline drops the rest|
|Forecast store 12 lookups / 12 raw loads|4 MiB of records and 1 MiB of catalog/descriptor bytes per lookup: at most 72.75 MiB in flight over all views (D2: 82.125 MiB). A larger partition is a `Capacity` error. The 12-permit process S3 gate is unchanged and shared|

A caller or owner timeout does not forcibly stop an already running blocking closure. Its workspace and permits remain owned until the actual closure retires. A retiring owner returns its workspace before its slot wakes the next owner (#2849); D2 released the slot first, and the woken owner could fail with `forecast cache: raw storage: Capacity` under load.

These are logical admission limits, not an allocator/RSS or total process CPU guarantee. Existing catalog/raw gates remain. D2/F2 must be reconciled with the shared process resource owner in the integrated candidate; this branch alone does not establish that global claim.

## Run the isolated verification

Check free disk space and the chosen ignored Cargo target first; preserve 3 GiB beyond the expected build. Coordinate the shared target and reuse compatible dependencies. Build the selected example with the repository toolchain, then copy and hash the executable outside the disposable target before using it as verification input.

```sh
cd server2
cargo build --locked --release --example domestic_warm_cache_smoke
python3 -B tools/domestic_warm_cache_smoke.py \
  --binary /absolute/path/to/copied/domestic_warm_cache_smoke \
  --output /absolute/path/to/new/ignored/task-run \
  --build-variant release --modes seed diagnostic http
```

Use a new output directory. The runner owns a persistent IPv4 loopback S3 peer and separate seed, diagnostic and native HTTP children; the example's S3 transport admits 12 requests at once, the server's process gate (it admitted 4 before #2849). It verifies their input identities, captures complete counters and reaps its children. No live endpoint or provider credentials are required. The Off provider reports denied observation stub calls separately from external network calls. A diagnostic Source run uses 60 seconds to inspect all 13 golden datasets; the separate unprimed Gateway -> DirectRoutes -> KmaBackend HTTP flow retains its normal 3-second deadline.

A passing run requires the original seed of 730 acquisitions / 851 pages (including one zone-support acquisition) and the diagnostic selection of 725 forecast acquisitions / 845 pages and all 13 expected Doc views. Every warm forecast LIST/catalog/descriptor/raw GET/returned byte, parse and fold delta must be 0. The complete classified label universe is exactly those 13 plus zone-support; missing or unknown labels fail. Cold HTTP must be 200; both warm responses must have identical bytes. Provider/geocoder counters, final owner/queue/workspace/waiter state and process retirement are checked. Never accept 502 as a successful partial response or prime the HTTP Source with the diagnostic Source.

## Measure empty-cache builds at modeled S3 latency

This compares two builds of the same example, for example the D2 product code and a candidate, on one seeded corpus. Build each at its own commit in its own clean target (a target shared between worktrees of the same package can report the second build fresh and reuse the first one's binary), copy and hash both executables, then run:

```sh
cd server2
python3 -B tools/cold_build_matrix.py \
  --binary base=/absolute/path/to/copied/base_smoke \
  --binary candidate=/absolute/path/to/copied/candidate_smoke \
  --output /absolute/path/to/new/ignored/matrix-run \
  --delays 0 10 20 --runs 5
```

The tool starts one persistent loopback peer, seeds the original corpus without delay, then sets the peer's latency control so every GET, HEAD and LIST waits the modeled milliseconds (PUT does not). For each delay and run it starts every binary in turn in `http` mode (fresh process: cold, warm1, warm2) and in `aged` mode (cold, then a rebuild after the 30-second view freshness, i.e. an empty forecast cache in a warm process). It keeps each run's bodies, compares every 200 body with the reference SHA-256 and reports status, median and p95 time, forecast LIST/catalog/descriptor/raw counts and, for cold and aged requests, when the views were ready, in `matrix.json`. A 502 after about 3 s is the unchanged native deadline and is recorded as a result; the owners of a cut answer keep building up to their 8-second bound, so the ready time and the number of mapped views show how far the build really was from the deadline. An `http` run then stops; an `aged` run still makes its rebuild request after the cold one was cut, because the forecast views of a running server go stale after 30 seconds and that rebuild (with about 20 other S3 operations instead of about 1,400 in a fresh process) is the common empty-cache case. Exit 1 means a harness problem (missing phases, an `aged` run without its rebuild, a timed-out or killed child, a failed child after successful answers, a wrong body), never a slow answer.

The delay is modeled on loopback: it has no TLS, connection setup or real S3 variance, and the host CPU decides the fold time. It is not a host p95 or capacity qualification. The selected local and Seoul t3.small results of #2849 are in its [verification record](../evidence/tasks/issue-2849-cold-build-speed/verification.md).

## Read the actual retained result

These are the figures of the D2 base run (#2819), kept as recorded. Since #2849 the same data weighs 8 bytes more per Doc and per stored field (each Doc carries its cached weight), and the example's S3 admission is 12.

The selected optimized executable is SHA-256 `f131044392694657919864caee1a95539359c736d4f0e6225127235a8069d68b`, built on the task's exact runtime source above base `c1ae9082`. The current runner is `a9b1e1a194188e3fb31c325b0fdd128f5b566cd58d2bfe6b0c3cdc1282272a84`. The retained original fixture manifest is `11606b79c26365e4ba8a5a906d5801f717845f853bafc971c2f099d27b7bbe3f`.

- Actual whole runner and all 3 children exited 0. Diagnostic 13/13 Docs match; cold 1958.88 ms and warm 3.75 / 3.79 ms.
- A separate fresh native Source returned cold 200 in 1670.86 ms, warm 200 in 18.51 / 17.39 ms. All three bodies are 42,549 bytes, SHA-256 `a6462aba8ad9ec34d8efdcab4ccd2f37b00339a301fd17caa7c1e5485d45b283`.
- Retained logical weight is 37,412,992 bytes (35.68 MiB), including metadata. The largest Short entry is 22,287,584 bytes (21.26 MiB). Both fit the unchanged default limits; these are not measured live heap sizes.
- All 13 forecast warm I/O/parse/fold deltas are 0. Final owners, admitted keys, workspace, waiters and queue are 0; the owned listener and peer retired.
- Current 83 Rust checks, all-target Clippy with warnings denied, fmt, and 6 pure checker tests passed. The pure checker tests include every forecast counter and missing/unknown label rejection. Earlier failing records remain preserved.

## Keep the limitations visible

The original supporting zone fixture uses numOfRows 999; the existing zone parser requires 1000 and rejects it. The separate ZoneCache is not installed in this scenario. Each native request therefore repeats zone LIST/catalog/descriptor/raw GET once, with 2,586 returned bytes (308 raw). These counters are explicitly retained; they are outside the specified Grid/RSS/Mid cache and are not hidden or called a forecast miss. This scenario does not prove valid-zone recovery.

The cold native flow invokes 196 denied observation stubs (194 web, 2 ASOS); warm adds 0. External provider calls and geocoder calls are 0. Other absent optional inputs and their counters remain in the record. Full source-Doc goldens and repeated HTTP body identity do not establish complete production API parity, live-provider behavior, concurrent p95, EC2 capacity or an eligible rollback bundle.

The original debug 8-second owner timeout, pre-correction cold 502 and overbroad warm-checker exit 1 remain failed evidence. The current success is a new run after the bounded duplicate-check correction and an exact cache-boundary checker correction, not a relabeling of those failures. Use the [selected verification record](../evidence/tasks/issue-2819-domestic-warm-cache/verification.md) and the separate S19/S20 gates before any operational decision.

## Structural fold follow-up to #2852

Short/Shortest now defer outer-document construction until after revision
selection and retention, while still performing eager strict-row validation and
the original pre-retention byte/count admissions. Current keeps its eager merge.
The parser moves already validated strings into Items with unchanged charges.
No new environment variable, data format or operator action is introduced.
See [verification and limits](../evidence/tasks/issue-2849-structural-fold/verification.md).
Revert this child change to restore #2852's fold/parser; no stored-data migration
is required. The 3-second request and 8-second owner deadlines are unchanged.
