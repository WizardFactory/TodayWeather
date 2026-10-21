# Empty-cache forecast build speed (issue #2849 follow-through)

Base `307defeb706886217ab67ea858dc7c7b0435752f` (PR #2841, D2). Intent: `intent/issue-2849-cold-build-speed.md` revision 3 (AC1–AC5). Evidence: investigation of the same task (local sweep, profile, 2026-10-21 EC2 record). Revision 5, 2026-10-22 (revision 2 amended decision D3; revision 3 refined R2.2/D1 with the control-byte bound; revision 4 corrected the R2.2 memory comparison to the process-wide store bound, added the raw admission constraint to R2.1 and the logical-weight shift; revision 5 adds R5, the owner hand-off order, following intent revision 3). Status: complete; decisions D1–D5 below are made for design, none blocks it.

## Problem and outcome

A forecast view is built from raw S3 acquisitions when its memory entry is missing. D2 reads the view's partitions one at a time, each as a catalog → descriptor → raw chain, through a catalog store limited to 2 concurrent lookups. One empty-cache request performs about 2,220 forecast GETs in about 700 chained lookups, so its duration grows by about 2 s per millisecond of S3 delay (19.8 s at 10 ms locally; 8–9 s on the Seoul t3.small with a loopback fixture; HTTP 502 under the 3 s deadline). Fold CPU is second (`short` ≈ 1.16 s locally, about four times that on t3.small).

Outcome: the same Docs, order and errors, produced with the partition reads overlapped and the fold's accounting linear, so an empty-cache request fits the 3 s deadline with the 2.5 s p95 goal on the measured host class at a modeled 10 ms S3 delay. If the bounded iterations cannot reach it, the measured gap is reported; the deadline and the #2705 gate are not relaxed.

## Scope and exclusions

In scope: the forecast read loop and its store admission (`server2/src/domestic/kma/source/forecast_cache.rs`, `records.rs`, `mod.rs`), the retained-Doc accounting and grid row lookup in `doc.rs`, `grid.rs` (and `rss.rs`/`mid.rs` where they share the same helpers), tests, a latency-injecting loopback-peer test aid, measurement tooling, and the documents listed under AC5.

Excluded: retention, SSD tier and warm-up (#2850); packs or rollups (#2707); the process S3 gate `S3_IN_FLIGHT` (12) and owner counts; lookback windows and retention windows; the 30 s/minute view freshness; provider calls; legacy `server/`. These are recorded as decisions for AK, not changed here.

## Retained behavior (must not change)

- Every view's Docs, their order, S16 input identities, `usable` partitions, exclusion counts and the HTTP bodies (reference sha256 `a6462aba8ad9ec34d8efdcab4ccd2f37b00339a301fd17caa7c1e5485d45b283`, 42,549 bytes) for the cold, warm and empty-cache-in-warm-process requests.
- D2 ownership: 2 active owners, 8 queued keys, 10 admitted flights, 128 waiters, 8 s owner deadline, ≤3 s caller wait, writer epoch/fence invalidation, no install of a partial or late view, warm hits with zero forecast I/O, parse or fold.
- Every capacity rule: page ≤1 MiB, ≤1024 partitions, ≤2048 acquisitions, ≤8192 pages, ≤32 MiB raw per scope; Doc ≤32 fields and ≤8 MiB; retained collection ≤8 MiB and ≤4096 Docs; parse scratch ≤48 MiB — with unchanged exact-boundary results. The limits and their arithmetic stay; the logical weight of the same data grows by 8 bytes per `Doc` and per stored field because a `Doc` carries its cached weight (R3).
- Error mapping of the read path: `Timeout`, `Capacity`, `Corrupt`, `NotFound`-as-excluded partition, `Invalid`, `Transport` surface exactly as the sequential read surfaces them.

## Requirements

**R1 — Ordered concurrent partition lookups (AC1).**
1. For every key kind (Grid, RSS, and Mid within one month) the read starts partition lookups in ascending partition order with at most `READ_AHEAD = 12` in flight per read and consumes the results strictly in that order.
2. The returned acquisitions, their order, the excluded count and the sort that follows equal the sequential read's for the same stored data.
3. Scope accounting (partitions, acquisitions, pages, page size, raw bytes) is applied to each consumed partition in order with the same arithmetic, so a cap is exceeded at the same partition and returns `Capacity` as before. Dropping unconsumed in-flight lookups after an error or cap is allowed; their results are discarded.
4. The first error in partition order is the error returned. A later partition's earlier-in-time failure never replaces it.
5. The caller or owner deadline is passed to every lookup unchanged. Dropping the read (owner timeout, shutdown) drops all in-flight lookups; the existing `build` logic still refuses to install a view that finished after its deadline.
6. A transport delay of D per operation makes a build of P partitions (c operations each) take about P × c × D ÷ min(READ_AHEAD, store admission, process gate) plus decode, rather than P × c × D.

**R2 — Admission and in-flight memory (AC1, AC2).**
1. The forecast catalog store admits `READ_AHEAD` lookups and `READ_AHEAD` raw loads at once (was 2/2); its decode CPU permits stay 1/1. Both are below or equal to the process transport gate of 12, which is unchanged. The raw admission must equal the lookup admission: a raw load beyond it is refused with `Capacity` instead of waiting, and each lookup loads its records one at a time.
2. The forecast store's per-lookup decoded output bound becomes 4 MiB (was 32 MiB) and its per-lookup retained control bytes 1 MiB (was 8 MiB). A lookup in flight holds at most its output, its controls and one compressed body (≤ 1 MiB + 64 KiB), so the store's in-flight bytes over all views stay within 12 × (4 + 1 + 1.0625) MiB = 72.75 MiB, below D2's 2 × (32 + 8 + 1.0625) MiB = 82.125 MiB. One view may now hold all of that 72.75 MiB (D2: 41.06 MiB, one lookup at a time); the 2 × 192 MiB owner workspaces, which cover the retained 32 MiB raw scope, are unchanged. A partition whose records exceed 4 MiB, or whose catalog and descriptors exceed 1 MiB, returns `Capacity` (fixture partitions decode to at most about 0.2 MiB; their controls are a few KiB).
3. No lookup waits for admission longer than the store's existing 3 s per-lookup bound; if admission queueing exceeds it the lookup times out as before. The queueing wait is a documented property, not a new failure mode.

**R3 — Linear fold accounting (AC3).**
1. The retained-Doc limit check for a stored Doc is computed from an incrementally maintained exact weight of the collection; for every store call the accept/reject result and the error equal the old whole-collection recomputation.
2. A field set on a Doc under the bounded setter does not re-walk unaffected fields to compute its projected weight; accept/reject results stay identical at every boundary.
3. The grid collector's row lookup (`find_or_create`) compares `date` and `time` without allocating strings; any other per-read string copy in the hot collector path is removed if it keeps results identical.
4. Local fold time of `short` and `shortest` on the 730-acquisition corpus falls by at least 25% against the base with no output change (stretch is set by the AC4 gap).

**R5 — Owner hand-off (AC2).** A retiring owner returns its 192 MiB workspace lease before it releases its owner slot, so the owner woken by that release always obtains its workspace; no build fails with `Capacity` because the previous owner's lease was still counted. The owner, queue, waiter and workspace sizes do not change.

**R4 — Evidence and documentation (AC4, AC5).**
1. A repeatable harness reports empty-cache time at modeled delays 0, 10 and 20 ms, fresh-process and warm-process, with body hash and S3 operation counts, for the candidate and for D2 as published, locally and on the Seoul t3.small.
2. The D2 architecture section, the operator guide and the diagram state the new read concurrency, the store admission and the in-flight bound. No new runtime setting or mode: the constants live in code with the same justification as the existing `LOOKUPS`.

## Data contracts and interfaces

- Internal only; no public API, wire or storage change. `Reader::forecast_acquisitions` stops accounting scope itself; the caller applies one `ForecastScope` check per consumed partition (the accounting moves, the arithmetic does not). `forecast_partitions` stays sequential (a few LISTs).
- `checked_store` and the bounded Doc setter keep their error type; the cached weight is private state of `Doc` that must not change equality, `Debug` output, cloning results or the observable Docs.
- Optional test-visible counter: peak concurrent partition lookups may be observed through a counting transport double in tests; no product statistic is required.

## Failure, retry and concurrency behavior

- A failing partition fails the whole view build with the same typed error; the owner reports it as today and nothing is installed. No retry is added.
- Cancellation: caller timeout or shutdown drops the stream of lookups; S06 blocking decode closures that already started finish and release their permits as they do today.
- Fairness: forecast lookups share the 12-permit process gate with other families. A cold build can occupy all permits for the duration of its reads; this is accepted for this task and recorded in the plan's risk list. The gate size is a separate decision.
- Different towns, views and owners run independently as in D2; the store admission is shared by all views of the process.

## Decisions made for design (D1–D5)

- **D1** In-flight bound: reduce the forecast store's `output_bytes` to 4 MiB and `retained_control_bytes` to 1 MiB rather than charging in-flight bytes to the workspace budget (simpler; the process-wide worst case falls from 82.125 to 72.75 MiB). Rejected: dynamic read-ahead by bytes (complex, no observed need).
- **D2** `READ_AHEAD = 12` equals the store `io`/`raw.io` and the process gate. Evidence: 12 lookups with store 12 → 3.2 s at 10 ms; store 8 → 4.6 s; raising only lookups → 16.9 s.
- **D3** (amended 2026-10-22, revision 2) Accounting keeps an exact cached `heap_weight` inside each `Doc` (thread-safe, "unknown" by default). The bounded setter updates it by the delta of the actual stored key, value and root allocation; infallible mutators and clones reset it to unknown because a clone has different capacities. The collection check sums cached per-Doc weights. The accept/reject result must equal the whole-recomputation result at every call. Rejected: sampling the check (changes boundary behavior); collection-level weight vectors (more bookkeeping, and `Doc::try_set` and the row `put` would still re-walk). The first revision rejected memoizing inside `Doc` because weights depend on capacities; exact delta maintenance from the stored objects resolves that.
- **D4** Parallel parse across the two CPU permits and skipping out-of-window publications are not part of this revision; they are candidates for a second build iteration only if AC4 shows a remaining fold-bound gap.
- **D5** `S3_IN_FLIGHT` stays 12; evidence for 32 (1.8 s at 10 ms) goes to AK as a decision.

## Verification approach (mapped to ACs; strategy only, not evidence)

| AC | Layer | Approach |
| --- | --- | --- |
| AC1 | integration over the owned S06 peer | counting/delaying transport wrapper: peak in-flight lookups ≥ 8 and elapsed ≤ ⅓ of the sequential estimate for ≥120 synthetic partitions; result equality against the 13 goldens; fault injection (missing, corrupt, timeout, over-cap) compares error and partition of failure; cancellation test drops the build mid-read and checks no install and no leaked in-flight count |
| AC2 | existing suites + goldens | existing exact-boundary and D2 tests stay green; diagnostic mode (13 Docs) and HTTP body hashes; a 4 MiB+1 partition returns `Capacity`; the forecast store limits are checked (lookups = raw loads = `READ_AHEAD`, 4 MiB, 1 MiB) |
| AC2 (R5) | unit | a waker that observes the workspace budget when the next owner is woken sees the previous lease already returned |
| AC3 | unit + local timing | test-only counter of `heap_weight` calls shows linear growth in Doc count and field count; equality tests of borrowed row lookup against the old accessor; local fold timing against base binary |
| AC4 | harness on host | latency-injected matrix on Seoul t3.small (EC2) and locally; body hash equality; operation counts |
| AC5 | review + gates | placement gate, artifact policy checker, doc/diagram review, no new flags (grep), clean checkout links |

## Assumptions, risks and unresolved items

- Assumed: AK's "implement" selects options A and B of #2849. Risk: ordering/error-precedence regression (mitigated by in-order consumption and equality tests); sharing the process gate; flaky timing tests (mitigated by deterministic peak-concurrency assertions plus loose ratios); stacked PR on an unmerged, conflicting base.
- Unresolved (not blocking): external-write authority (push, PR, reviewers, issue comments); AK's explicit EC2 launch confirmation; real S3/TLS latency remains unmeasured.
- Superseded D2 text: "Process one partition at a time with checked scope totals before retention/dispatch" (`specs/issue-2819-domestic-warm-cache.md`) is replaced by R1 for the read loop; every other D2 clause stands.
