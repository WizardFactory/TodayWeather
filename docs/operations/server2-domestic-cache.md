# Domestic forecast memory, SSD restoration and local verification

This guide covers complete forecast source views, not a cached HTTP response. The source remains S3-authoritative. It adds no collection schedule, provider mode or production fallback. The task is pre-merge preparation for #2819; it does not close S19/S20 or authorize shadow traffic, deployment or sends.

## Read the ownership boundary

One Source owns immutable Grid(current/shortest/short), RSS and
Mid(forecast/land/temp) views. Original mid-region identifiers remain distinct.
A real acquisition future invalidates only its affected view key at entry and
retirement, including failure, abort or panic. Live key states stay pinned across
views/builds/writers so registry eviction cannot recycle a fence. Unrelated towns
and families keep serving from memory. Other observation/station/air/life/warning/
narrative/zone owners still run; this is not a final HTTP-body cache.

A view survives arbitrary minute changes until an existing pure selector can
change it: latest publication/retention anchor, removal of an included oldest
partition, RSS run, KST day/month or future-fetched visibility. Equality and clock
rewind miss. At most30seconds after the start of the prior successful check,
using both request wall time and process monotonic time, LIST the searched months
and GET their selected catalogs. Compare canonical complete acquisition/page/group
identities, including changes within an existing partition and empty newer mid
months. Unchanged inputs renew with zero raw/descriptor GET, raw parse and fold;
changed/failed checks rebuild. Cost is L LIST + P catalog GET (actual monthly
pagination count and selected partition count). S07 response TTL is unchanged.

Set the existing `SERVER2_LOCAL_CACHE_DIR` to enable the shared disposable tier;
`SERVER2_LOCAL_CACHE_MAX_BYTES` remains its root-wide cap (default 8 GiB). Folded
views share the raw cache's namespace owner, private files, two-operation gate,
allocated-byte reservations and LRU. They retain bounded binary folded Docs,
required original pages and summary IDs, identity scope and parser/schema
revision. Every restore verifies hash, key/revision, interval and authoritative
S3 identities before memory admission. Missing, corrupt, truncated, stale and
over-cap files are normal misses. No manual repair/migration is needed. Disable
the existing local-cache setting or remove disposable files while the process is
stopped to return to memory/S3 reconstruction; canonical S3 is unchanged.

The codec revision in `forecast_disk.rs` must change whenever parser, pure
selector, ordered-Doc or summary-input identity semantics change. S3 identities
are authoritative; a local normalized copy never replaces them. Identity-only
checks do not probe unchanged immutable raw bodies for new storage faults;
reconstruction retains the existing raw validation/failure behavior.

| Limit | Meaning |
| --- | --- |
|128 MiB retained / 128 keys|Logical weight of mapped immutable entries, including admitted raw/Doc/identity capacities and metadata allowance|
|48 MiB per entry|Raw 32 MiB, Doc 8 MiB and identity 4 MiB sublimits; failed admission does not publish a partial view|
|2 active owners + 8 queued keys|Ten admitted keys, 192 MiB logical workspace per owner ; 8-second owner deadline starts at admission, including queue time|
|256 live key states|Bounded registry; refuse new state while every slot remains pinned|
|128 waiting callers / local CPU 2|Bounded per-Source demand; each caller keeps its own deadline|
|4995 comparison indices|At most 39,960 requested payload bytes on 64-bit plus charged allocation allowance; fallible growth and actual Vec capacity check|

A caller or owner timeout does not forcibly stop an already running blocking closure. Its workspace and permits remain owned until the actual closure retires.

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

Use a new output directory. The runner owns a persistent IPv4 loopback S3 peer and separate seed, diagnostic and native HTTP children. It verifies their input identities, captures complete counters and reaps its children. No live endpoint or provider credentials are required. The Off provider reports denied observation stub calls separately from external network calls. A diagnostic Source run uses 60 seconds to inspect all 13 golden datasets; the separate unprimed Gateway -> DirectRoutes -> KmaBackend HTTP flow retains its normal 3-second deadline.

A passing run requires the original seed of 730 acquisitions / 851 pages (including one zone-support acquisition) and the diagnostic selection of 725 forecast acquisitions / 845 pages and all 13 expected Doc views. Every warm forecast LIST/catalog/descriptor/raw GET/returned byte, parse and fold delta must be 0. The complete classified label universe is exactly those 13 plus zone-support; missing or unknown labels fail. Cold HTTP must be 200; both warm responses must have identical bytes. Provider/geocoder counters, final owner/queue/workspace/waiter state and process retirement are checked. Never accept 502 as a successful partial response or prime the HTTP Source with the diagnostic Source.

## Verify folded-view retention

Use the same owned runner and copied release executable, adding tool scenarios:

```sh
python3 -B server2/tools/domestic_warm_cache_smoke.py \
  --binary /absolute/path/to/copied/domestic_warm_cache_smoke \
  --output /absolute/path/to/new/ignored/task-run \
  --build-variant release \
  --modes seed diagnostic http disk http-disk disk-boundary
```

Run from the repository root. These are isolated example/runner scenarios, not
production runtime modes. `disk` fills all 13 views, destroys the Source/cache
owner, restores them with fresh owners and revalidates unchanged inputs after an
arbitrary minute. It records each view's serialized size, restore latency,
control requests and raw/parse/fold deltas. `http-disk` starts a fresh native HTTP
Source using those validated copies; its seven used keys must restore without
raw/descriptor reads or raw parse/fold and retain the original 42,549-byte body
hash. `disk-boundary` runs last because it advances the clock, compares all 13
answers with independent pure replay and may replace disposable files.

The Python checker rejects raw/descriptor reads, parse or fold during restore/
renewal; control requests are allowed. Normal warm memory still requires zero
forecast I/O. Fault/capacity and two-town cancellation/panic/race checks are in
`server2/tests/domestic/forecast_cache.rs` and the source cache/codec unit tests.
Read the [#2850 verification record](../evidence/tasks/issue-2850/verification.md)
for the measured sizes, times, capacity assumptions and current review status.

## Prior #2819 retained result

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
