# Empty-cache forecast build speed: selected local verification

Scope: #2849 on the D2 branch (PR #2841 head `307defeb706886217ab67ea858dc7c7b0435752f`).
Ordered concurrent partition lookups, forecast store admission and per-lookup bounds,
an exact cached Doc weight, borrowed grid row reads and the owner hand-off order. Local
pre-merge evidence with the owned loopback S3 peer and modeled per-operation latency,
on macOS arm64 (10 cores) and on one Seoul t3.small; it is not a real S3/TLS, p95
capacity or production result. Raw logs, receipts and copied executables stay in the ignored task
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
| SM3 static musl examples: D2 + harness / candidate / `gate24` | `dddbc035a5277d08cc330c8e03b37f926e0a619873351317baaca7a5dd805859` / `ca42aa82cb6bdf4371db5ec4d4b9f5b8aef60f2513d7dee153fd42ef31e1c311` / `408a0cf2ed98e438b9219b0afa2a6e74c5a5e2a84aba509cb286cd6a97cdf116` |
| SM3 host package / retrieved results archive | `1104f185e4e5fc6c2de1890832f6e7d97a8cb152250e238f741b4a3bb1c1109a` / `84c2064a51396c120fba8b16f3e30f9f6fb5e1bee9cedf63738e66ca8272297f` |

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

## Seoul t3.small host (SM3)

One task-owned, role-less Spot t3.small (Unlimited, 2 vCPUs, 1.9 GiB, Amazon Linux
2023 kernel 6.18) in ap-northeast-2d, SSH from the operator address only, egress
revoked before the workload, a 4-hour termination timer; 2026-10-22 02:08–03:51 UTC,
then terminated with its security group and root volume deleted (read back). The
workload ran under a systemd unit with 1,536 MiB memory and no swap. Static musl
x86-64 builds of the same three sources: D2 + harness (`307defeb` product code with
the final example), the candidate (`54aad593`), and an uncommitted measurement
variant `gate24` (the candidate with the process gate, `READ_AHEAD` and the example
gate at 24 and an idle connection pool of 32). The packaged peer copy accepted 32
connections (tracked default 16) so the variant is not refused; the other two keep
at most 16 open. The matrix tool is the `207b176d` version. Matrix: 20 fresh-process
`http` runs and 10 `aged` runs per binary and delay, interleaved, no harness problem.
The Python peer runs on the same two vCPUs as the server, so these times include its
CPU; real S3 would not.

No request of any binary was answered inside the 3 s deadline at 0, 10 or 20 ms
(0 of 270 cold requests and 0 of 90 aged rebuilds), so no body could be compared on
the host. During qualification in an emulated amd64 container the Linux candidate and
`gate24` builds returned the reference body; the D2 build answered no request with
200 there either, so its Linux body is not verified. Views ready (median, p95 in
parentheses) is when the owners started by the request went idle; mapped views of 7
where fewer:

| Delay | Request | D2 + harness | Candidate | gate24 variant |
| --- | --- | --- | --- | --- |
| 0 ms | running server | 6.73 s (7.02), 3.5 of 7 | 4.63 s (4.73) | 4.58 s (4.71) |
| 10 ms | running server | 8.15 s (9.46), 1 of 7 | 5.32 s (5.45) | 4.77 s (4.93) |
| 20 ms | running server | 8.28 s (8.29), 0.5 of 7 | 6.44 s (6.68) | 5.28 s (5.43) |
| 0 ms | fresh process | 7.65 s (7.93), 3 of 7 | 5.73 s (5.88) | 5.55 s (5.67) |
| 10 ms | fresh process | 8.24 s (9.93), 3 of 7 | 6.58 s (6.70) | 5.75 s (5.93) |
| 20 ms | fresh process | 8.36 s (8.39), 2 of 7 | 8.71 s (8.93), 6 of 7 | 6.28 s (6.39) |

D2's owners went idle with only the views shown mapped and read fewer objects
(1,875 / 1,402 / 739 forecast operations against the candidate's 2,227). At 10 and
20 ms they reached the 8-second owner bound; at 0 ms they went idle earlier, and two
of D2's ten 0 ms running-server rebuilds failed early (502 after 2.21 and 2.37 s,
with 2 and 4 views mapped). The info-level log records no cause for these early
stops: they are consistent with the owner hand-off defect fixed here, but that is
not confirmed. The candidate and `gate24` had no early failure. The candidate's
0 ms time, 4.6 s in a running server (about 4.5 times the local 1.03 s), is a floor
of this setup, in which the server, the Python peer and loopback HTTP share the two
vCPUs; it points to CPU rather than S3 concurrency, but parse and fold time alone
was not separated on the host. The 2.5-second goal is not met on t3.small at any
modeled delay. A 24-permit gate removes most of the latency-dependent part (10 ms:
5.32 → 4.77 s; 20 ms: 6.44 → 5.28 s) and does not lower the 0 ms time. The largest resident
set of any process (server, peer or tool) was 78.8 MiB for D2, 87.5 MiB for the
candidate and 88.1 MiB for `gate24` in the per-binary memory runs; the unit's
`memory.peak` (1.46 GiB) includes the page cache of 2.4 GiB of written run output
and is not a process size. CloudWatch showed at most 74 % average CPU per 5 minutes
and no surplus credits charged at the final snapshot; the host cost is estimated at
about USD 0.10 (Spot, surplus credits, root volume, public IPv4 and the result
download), not an invoice.

## Tests and gates on the candidate

On the candidate `server2/` tree: `cargo fmt --check` and all-target Clippy with
warnings denied pass; the placement gate passes for `ColdBuildSpeed2849.json`; the
peer self-check (with its latency control), 6 matrix-tool tests and 6 D2 runner tests
pass; the 8 cold-read integration tests and 63 source unit tests pass. The D2 test
`runtime_services::inventory::factory_national_prose_reader_survives_factory_reconstruction`
fails on the D2 head `307defeb` and passes on its merge base `c1ae9082` (two owned
flights panic during `/v000903/nation/KR`); its fixture is ported unchanged from
PR #2851 (`0c163912`, test only), after which `runtime_services` passes 48/0. At
`7eadefb6` the whole workspace with 4 test threads and `--no-fail-fast` passed
1,111 tests with 6 ignored and failed 2 `domestic::source_s3` tests with
`address_unavailable`: these tests alone leave about 33,500 loopback TIME_WAIT
sockets on macOS, the D2 base peaks at the same count and fails the same way when
run back to back, and the `domestic` binary rerun alone passes 181/0. PR CI at
`7eadefb6` (Linux) passes every check. `tools/test_placement.py` did not run here:
its self-tests call `rustc +1.99.0`, which needs the rustup proxy this host lacks.

Base observations: D2 CI run `39243883911` failed 4 `domestic` tests with
`forecast cache: raw storage: Capacity`, the owner hand-off defect fixed here. With
the default 10 local test threads the base fails 30 `domestic` tests while seeding
the loopback peers (host contention), so base and candidate are compared with 4
threads: base 173 passed, candidate 181 passed (8 new), none failed.

## Limits

The latency is modeled on loopback: no TLS, connection setup or S3 variance, and on
the Seoul host the peer shares the server's two vCPUs. The process S3 gate (12) is unchanged and shared,
so one cold build can hold all its permits while it reads. Logical weights of the same
data grow by 8 bytes per Doc and per stored field. Real-partition sizes are taken from
the fixture (at most about 0.2 MiB decoded against the new 4 MiB bound).
