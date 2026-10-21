# Empty-cache forecast build speed: selected local verification

Scope: #2849 on the D2 branch (PR #2841 head `307defeb706886217ab67ea858dc7c7b0435752f`).
Ordered concurrent partition lookups, forecast store admission and per-lookup bounds,
an exact cached Doc weight, borrowed grid row reads and the owner hand-off order. Local
pre-merge evidence on macOS arm64 (10 cores) with the owned loopback S3 peer and
modeled per-operation latency; it is not a Seoul host, real S3/TLS, p95 capacity or
production result. Raw logs, receipts and copied executables stay in the ignored task
record.

## Candidate and input identities

| Input | Identity |
| --- | --- |
| Implementation commits | `7df3bc30` harness, `62595a92` reads and store limits, `85a1a09b` Doc weight, `de76f37a` owner hand-off, `8946cecd` row reads, `79d798c5` / `885c26be` / `54aad593` harness ready times, aged rebuild and report keeping |
| Candidate `server2/` tree (`54aad593`) | `21d72d19f5bf2be4ef6eec171c09644299c6aa2d` |
| Candidate example (final example; product code of `54aad593`) | `cc165e3045bdc6ed844be0a59533722e86baa1bb151f8c8840b4bfc52c1db5e5` |
| D2 + harness example (`307defeb` product code with the same final example) | `f54744301e13a9567f423d77d124dc7cd79ac817feeb56024b5058ec2e93258c` |
| D2 smoke runner | `8627e144ae742da1291c101d88559451989c113f2fe19bf5464dcbcc45ec9cc6` |
| Matrix tool (`54aad593`) | `1da1ac083483d0ce1cd9c407571e54b668b84402c24e1b629351bbb676db46fe` |
| Loopback peer | `66aa32d8ef2fef5237d6b5824eb745966cc127668f6c58069389c5735415d9de` |
| Original fixture manifest (730 acquisitions / 851 pages) | `11606b79c26365e4ba8a5a906d5801f717845f853bafc971c2f099d27b7bbe3f` |

## Behavior checks

Each change was test-first where it has observable behavior, and the tests fail on the
D2 code for the intended reason:

| Check | D2 (Red) | Candidate |
| --- | --- | --- |
| 130 hourly partitions at 10 ms per operation, 12-permit gate | 1 lookup in flight | 12 lookups in flight, 12 reads at most, 0.55 s against a 3.9 s sequential estimate |
| Partition of exactly 4 MiB / 4 MiB + 1 byte | both admitted | 4 MiB admitted, + 1 byte is `Capacity` |
| Forecast store limits | 2 lookups / 2 raw loads, 32 MiB, 8 MiB | 12 / 12, 4 MiB, 1 MiB |
| Storing 64 / 256 Docs; 32 bounded field sets | 4,672 / 67,840 Doc walks; 32 | 192 / 768; 1 |
| Next owner woken by a hand-off | sees 201,326,592 workspace bytes still counted | sees 0 |

Characterization tests pass on D2 and on the candidate: the first failing partition in
partition order decides the answer; a catalog vanished after LIST still fails the view
with `Corrupt("incomplete catalog")`; the owner deadline and a never-answering lookup
leave no lookup in flight and no view mapped; two cold keys share the gate without
starving another reader; jittered overlapped reads equal one operation at a time;
scope totals fail at the same partition as the D2 per-acquisition checks in 3,000
random cases; cached weights equal an independent full walk after random changes; store
admission equals a full recomputation at limit − 1, limit and limit + 1; rows are
found exactly as through `Row::get`.

## Output equality and fold time

The isolated smoke on the final candidate example (seed, diagnostic, HTTP) exited 0:
seed 730 / 851, diagnostic 725 acquisitions / 845 pages with 13/13 golden Docs in every
phase, warm forecast I/O, parse and fold deltas 0. Fresh native HTTP: cold 200 in
1,295 ms, warm 200 in 21 / 20 ms, all bodies 42,549 bytes with SHA-256
`a6462aba8ad9ec34d8efdcab4ccd2f37b00339a301fd17caa7c1e5485d45b283`.

Fold time per view, median of 5 diagnostic runs at 0 ms, with one uncommitted timing
patch (two lines printing the blocking `build_view` time) applied to D2 + harness
(`7df3bc30`) and to the final candidate tree (`54aad593`), 13/13 Docs in all 10 runs:

| View | D2 + harness | Candidate | Change |
| --- | --- | --- | --- |
| Short | 1,170.9 ms | 687.4 ms | −41.3 % |
| Shortest | 418.3 ms | 296.9 ms | −29.0 % |
| RSS | 35.9 ms | 29.0 ms | −19.2 % |

An earlier run on the `8946cecd` tree gave 1,148.9 → 677.4, 410.3 → 287.6 and 35.3 → 28.3 ms.

## Empty-cache requests at modeled S3 latency

Harness: `server2/tools/cold_build_matrix.py` with the owned peer's latency control,
one seeded corpus per execution, 5 interleaved runs per cell, D2 product code and the
candidate built with the same final example (`f54744301e13a9567f423d77d124dc7cd79ac817feeb56024b5058ec2e93258c`
and `cc165e3045bdc6ed844be0a59533722e86baa1bb151f8c8840b4bfc52c1db5e5`). The 0 and 10 ms
cells come from one execution and the 20 ms cells from another, both without harness
problems; every 200 body equals the reference. An earlier complete execution lost
11 runs to local port exhaustion and is kept only in the task record: bursts of up
to about 24,000 TIME_WAIT sockets came from other activity on the host at times not
aligned with the runs, while a run of this harness alone stayed near 300. "Running server" is the `aged` request:
views stale after 30 seconds in a warm process, about 2,245 S3 operations; a fresh
process makes about 3,628. Times are medians (p95 in parentheses); "ready" is when
the owners started by the request were idle, measured outside the request timing.

| Modeled delay | Request | D2 + harness | Candidate |
| --- | --- | --- | --- |
| 0 ms | fresh process | 200 in 1,784 ms (2,195) | 200 in 1,096 ms (1,413) |
| 0 ms | running server | 200 in 1,516 ms (1,606) | 200 in 1,026 ms (1,160) |
| 10 ms | fresh process | 502 at 3.0 s; owners stop at the 8 s bound with 1 of 7 views | 502 at 3.0 s; 7/7 views ready at 4.66 s (4.75) |
| 10 ms | running server | 502 at 3.0 s; 0 of 7 views | 7/7 views ready at 3.12 s (3.14); 1 of 5 answered 200 inside 3 s, 4 answered 502 |
| 20 ms | fresh process | 502 at 3.0 s; 2 of 7 views | 502 at 3.0 s; 6 of 7 views by 8.02 s |
| 20 ms | running server | 502 at 3.0 s; 0 of 7 views | 502 at 3.0 s; 7/7 views ready at 5.41 s |

The goal of a 2.5 s p95 at a modeled 10 ms is not met locally; the running-server
rebuild is 0.6 s above it and 0.1 s above the 3-second deadline. Through the
unchanged 12-permit process S3 gate, 2,245 operations at 10 ms need at least
2,245 × 10 ms ÷ 12 ≈ 1.9 s and 3,628 need ≈ 3.0 s before any fold work, so the
remaining gap needs fewer S3 operations per view or more S3 concurrency.

## Tests and gates on the candidate

On the candidate `server2/` tree: `cargo fmt --check` and all-target Clippy with
warnings denied pass; the placement gate passes for `ColdBuildSpeed2849.json`; the
peer self-check (with its latency control), 6 matrix-tool tests and 6 D2 runner tests
pass; the 8 cold-read integration tests and 63 source unit tests pass. The whole
workspace with 4 test threads and `--no-fail-fast`: 1,112 passed, 6 ignored, 1 failed.
The failure, `runtime_services::inventory::factory_national_prose_reader_survives_factory_reconstruction`,
fails the same way on the D2 head `307defeb` and passes on its merge base `c1ae9082`:
it is pre-existing in D2 and unrelated to this change (two owned flights panic during
`/v000903/nation/KR`). With that one test skipped by name, the workspace passes:
1,112 passed, 6 ignored, 0 failed across 30 test binaries. `tools/test_placement.py` did not run here: its self-tests call
`rustc +1.99.0`, which needs the rustup proxy this host lacks.

Base observations: D2 CI run `39243883911` failed 4 `domestic` tests with
`forecast cache: raw storage: Capacity`, the owner hand-off defect fixed here. With
the default 10 local test threads the base fails 30 `domestic` tests while seeding
the loopback peers (host contention), so base and candidate are compared with 4
threads: base 173 passed, candidate 181 passed (8 new), none failed.

## Limits

The latency is modeled on loopback: no TLS, connection setup or S3 variance, and the
local CPU is faster than the Seoul t3.small. The Seoul host matrix has not run; it
waits for AK's launch confirmation. The process S3 gate (12) is unchanged and shared,
so one cold build can hold all its permits while it reads. Logical weights of the same
data grow by 8 bytes per Doc and per stored field. Real-partition sizes are taken from
the fixture (at most about 0.2 MiB decoded against the new 4 MiB bound).
