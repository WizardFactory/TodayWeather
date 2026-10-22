# Forecast cache retention verification (#2850)

The initial measurements below are revision-bound local evidence. The dedicated
EC2 campaign is recorded separately at the end; its results do not relabel these
older runs.

Date: 2026-10-22 KST. Base `307defeb706886217ab67ea858dc7c7b0435752f`, dependent on open PR #2841. Measurement runtime/test/tool/declaration candidate `sha256:2272b0f4d6c4b92fd8fa59fd3c99856fe44822b1ead40471749e9679e7b97ba9`. Maintained docs are assessed separately. Local Darwin ARM64, Rust 1.99.0 release; this is not an EC2 or live S3 measurement.

Copied executable SHA-256 `78ed4cb02d57306cccd7567375a9bf4c96dd2b7304949e697549479e8454dcdb`; runner `9074092d251389c2a24a700b23a3baa8ce2ab476ee5aaa7522dc1bf3aa51b1c9`. Fixture manifest remains `11606b79c26365e4ba8a5a906d5801f717845f853bafc971c2f099d27b7bbe3f`; input identity digest `a83f63716e6b73c997c6ded2cca81e23c50e97b770408f0c2580a7d2241c4a00`. No runtime verification flag or dependency was added.

## Actual behavior evidence

- Per-key writer test first failed (exit 101, unrelated Current entry count 0 instead of 1), then passed after scoped fences. Current views for two towns stay pinned and returned with zero raw/parse/fold while RSS acquisition runs; actual future abort and panic both retire its fence. An old-generation build cannot return/install across a write; the caller rejoins a fresh generation within its original deadline. Registry capacity and live identity retention are checked.
- Boundary test first failed (exit 101 at arbitrary minute), then passed for reuse through the exact next Current publication. Fixed-clock checks cover RSS, inclusive oldest-partition removal, KST month/day, future-fetched equality and rewind. All13 full-window goldens match before and after minute renewal; advancing three hours matches independent pure replay for all 13, with only the four time-dependent grid/RSS views refolded.
- Identity renewal test first failed (exit 101: no authoritative LIST), then passed with real control reads and zero raw/descriptor GET, parse or fold. Existing-partition external publication appears on the first request at 30 seconds, remaining absent before that bound. Failed LIST cannot renew.
- Restart test first failed (exit 101: one parse instead of zero), then passed with a fresh Source and disk owner. Smaller-than-working-set memory eviction also restores without raw/parse/fold. Hash damage, truncation, valid-container wrong key/revision/identity, external S3 identity change and a lowered cap rebuild byte-identical source Docs; over-cap files are evicted. Bounded codec tests preserve NaN payload, signed zero, infinity, undefined and property order and reject oversized declared growth.

The broader first peer run passed 8/9: its new external-write assertion looked for t1h at the Doc root; source stores it under currentData. The response had changed as required. The corrected assertion and unchanged implementation passed 9/9 in release. Earlier Cargo PATH/rustup sync, Python cache and test-module qualification errors are environment/compile failures, not intended Red.

## Retained 13-view measurements

| View | Serialized bytes | Restore ms |
| --- | ---: | ---: |
| `Grid(Current, 60, 127)` | 326,745 | 23.964 |
| `Grid(Shortest, 60, 127)` | 11,106,559 | 44.081 |
| `Grid(Short, 60, 127)` | 21,122,472 | 51.813 |
| `Rss(60, 127)` | 662,043 | 11.664 |
| `Mid(Forecast, "109")` | 1,618 | 1.041 |
| `Mid(Land, "11B00000")` | 3,849 | 0.994 |
| `Mid(Temp, "11B10101")` | 2,511 | 0.991 |
| `Mid(Forecast, "159")` | 1,618 | 1.005 |
| `Mid(Land, "11H20000")` | 3,849 | 1.028 |
| `Mid(Temp, "11H20201")` | 2,511 | 1.145 |
| `Mid(Forecast, "156")` | 1,618 | 1.007 |
| `Mid(Land, "11F20000")` | 3,849 | 0.937 |
| `Mid(Temp, "11F20501")` | 3,072 | 1.354 |

Total serialized payload: **33,242,314 bytes (31.70 MiB)**. Sequential restoration including hash/decode and authoritative controls: **141.025 ms**. Renewal after an arbitrary minute: **75.782 ms**. Both phases make **14 LIST + 725 catalog GET**, **0 descriptor GET / 0 raw GET / 0 raw parse / 0 fold** across the 13 views. This is an explicit control-request cost, not an ETag-only LIST check.

The13-view working set weighs 36,552,928 logical bytes; adding the one shared 1 MiB metadata reservation gives 37,601,504 bytes. Using the issue's13-view working set as one town for estimation, the 128 MiB memory limit holds **3 towns** after reserving metadata. These are logical capacities, not heap/RSS. The corpus includes nine mid views covering three regions; real towns can share region views.

With the current container header and 4 KiB allocation rounding, these view payloads require 33,259,520 bytes: an 8 GiB cap has an estimated ceiling of **258 such towns if reserved entirely for views**. The actual fill observed 36,622,336 allocated bytes across 764 files (13 views and 751 opportunistically retained raw objects); repeating that observed mix gives **234 towns**. These are capacity estimates from one workload, not a multi-town saturation test or guarantee: other datasets, incomplete raw-cache admission, retained namespaces, temporary reservations and concurrent pinned readers reduce available capacity. The root-wide configured cap remains enforced.

## Separate native HTTP smoke

| Fresh Source | Phase | HTTP | Elapsed ms | Bytes |
| --- | --- | ---: | ---: | ---: |
| Memory empty / no SSD | cold | 200 | 1640.613 | 42,549 |
| Memory empty / no SSD | warm1 | 200 | 15.491 | 42,549 |
| Memory empty / no SSD | warm2 | 200 | 14.375 | 42,549 |
| SSD configured | cold | 200 | 274.522 | 42,549 |
| SSD configured | warm1 | 200 | 14.686 | 42,549 |
| SSD configured | warm2 | 200 | 14.300 | 42,549 |

All six bodies equal the original HTTP reference SHA-256 `a6462aba8ad9ec34d8efdcab4ccd2f37b00339a301fd17caa7c1e5485d45b283`. Both fresh Sources use normal Gateway -> DirectRoutes -> KmaBackend with the unchanged 3-second request ceiling. The SSD Source restores all seven used keys with zero forecast raw/descriptor GET, parse and fold. Neither HTTP Source is primed in memory by diagnostics.

All six owned runner children exited 0 and the peer/listeners retired. Source input hashes were unchanged during execution. The original supporting zone fixture remains invalid (numOfRows 999 versus required 1000) and its repeated control/raw reads stay separately visible; no valid-zone recovery is claimed. Cold requests still invoke 196 denied observation stubs (194 web, 2 ASOS), warm adds 0. External provider/geocoder calls are 0.

## Reproduction and limits

Use the commands in the [operator guide](../../../operations/server2-domestic-cache.md), including `seed diagnostic http disk http-disk disk-boundary` on a copied release executable. `server2/tools/test_domestic_warm_cache_smoke.py` has 7 passing pure checks, including rejection of raw/descriptor/parse/fold in restore/renew while allowing control reads. The local placement gate passes the [task declaration](../../../../server2/config/tasks/ForecastRetention2850.json) against the exact base. Full current final check counts and independent review/CI readiness are recorded in the authorized PR; this selected record precedes that review.

Archify proposed workflow passed artifact validation/delivery/strict check and actual Chrome browser checks. Light 1440 and dark 2048 captures were visually inspected: no clipped nodes/labels or text collisions; long fallback routing remains visible. Original-source hook citations are frozen at the dependency revision and are explicitly design evidence. Generated sidecars/captures/recovery metadata stay ignored locally.

No live S3/provider request, deployment, shadow traffic, host performance/capacity qualification, mobile build or merge is claimed. S3 identities remain authoritative; disk loss/schema mismatch is a normal miss. No source or dependency path outside the declared server2 ownership was introduced.


The 66be97c8 measurement candidate additional checks: 16 focused library tests, 8 shared DiskCache fault/ownership
regressions, 9 cache/source integration tests, 10 S16 summary integrations and
9 compatibility checks (6 late-publication, 2 backfill, 1 concurrent acquisition)
passed: **52 Rust checks total**.
All-target Clippy with warnings denied, fmt, 7 Python checker controls and the local
placement gate passed. The S16 suite includes the request's own stored acquisition
identity, complete-current-fold settlement and rejection of partial/failed reads.

CI correction: initial foundation run39681558255 exposed four existing domestic
concurrency regressions after173 tests passed. The exact late-first-demand failure
was reproduced locally. An active writer now permits fresh request-local
reconstruction with no complete S16 IDs and no memory/SSD admission; a retired
flight is retried within the original caller deadline. All four original failures
pass in the compatibility run above. The corrected six-child13-view/disk/boundary/
HTTP smoke and an additional fresh three-child13-view/HTTP run both exited0 and
kept the original hashes. The old candidate, initial review and failed logs remain
retained; final review/CI applies only to the corrected revision.


A subsequent foundation CI39685398826 exposed one existing S16 own-acquisition
identity failure (176 passed, 1 failed, 2 ignored). Its exact local single-test
invocation passed once, so that complete scenario is scheduling sensitive. A new
held same-key writer test deterministically failed: the final canonical fence also
removed the immutable request-local overlay's complete input identity. The repair
applies this downgrade only to non-overlay reconstruction. Complete parents keep
the original IDs; partial parents remain partial; overlays never enter memory/SSD.
All canonical writer/generation/control/restore/renewal gates are unchanged.
The new test passed after the repair. Its runtime/test/tool/declaration candidate is
`sha256:b81fd394848a38f4fa56a36f06169e2c37c9a2b9a9ee6a2cefdb19f170e41cab`. Full renewed checks and six-mode smoke results are retained in
the PR candidate receipts; the performance tables above remain the explicitly
identified 66be97c8 measurement run, not a newly timed execution. Existing spec,
architecture/operator guide and maintained diagram already require preservation
of request-local overlays and original S16 identities; their contract is unchanged.

## Factory national prose fixture correction

The next Linux run on `c7d2a5d2` passed all 177 domestic tests, including the original S16 own-acquisition identity check, then failed the factory national prose test after four immediate child errors. The unchanged test also failed on base `307defeb` locally. The base CI run stopped before this suite, so there is no Linux base result for this case. A temporary, restored diagnostic identified `forecast view unavailable`; fixed virtual time excludes timer expiry and supports forecast-flight admission as the cause.

A 250 ms real-time settle did not solve the fixture. One sequential city preparation pass returned 200 for every city but still failed the national request. Two passes through the same production factory/public router passed both reconstruction phases and API versions on the first national attempt. The first pass can initiate missing-publication writers and evict its canonical views; the second rereads after those claims. This prepares weather inputs for the reader-wiring check without changing runtime admission limits. The test retains its four-attempt ceiling, 15-second phase guard, exact stored prose, 15-city shape, both versions and child-error body assertions, and asserts that virtual time stays fixed. This is a test-only correction, not cold-national availability or production latency evidence.

The selected correction reuses bounded connections within each factory and gives each phase a fresh current-thread Tokio runtime. Ending a phase cancels its detached asynchronous owners and ends that connection pool before replacement; the same S3 peer retains canonical state. Fixed-duration retirement was rejected. Ten isolated head executions produced all 40 national responses on attempt zero, with no observed peer slot refusal. These are local focused checks, not Linux or cold-nation availability qualification.

The same test bytes did not pass on base: the first run failed during city preparation with 502 and no peer refusal. A restored diagnostic separately identified `forecast cache: raw storage: Capacity`; its exact internal source is unproved. No base-ten-pass result or claim that #2850 fixed that capacity failure is made. This test correction is qualified on the #2850 implementation and must not be assumed independently backportable to #2841. All runtime limits remain unchanged. The unchanged base fixture's four child errors and the later peer-transport experiments remain distinct observations.

A head scratch negative control disconnected only the factory's national narrative reader. It failed at the exact stored-prose assertion with no peer refusal, then restored the runtime file byte-for-byte. The passing checks retain the original strict oracle; accepting 500, changing production bounds, or increasing retries was not part of the correction. Runtime source hashes remain those of `c7d2a5d2`. Full Linux CI on the eventual committed fixture is still required.

The first full parallel local run of the selected fixture still failed (47 passed, one factory failure, three ignored); its panic detail was absent. A temporary diagnostic run then passed all 48 tests and restored both patched files exactly. The final test retains failure diagnostics even if another parallel test replaces the process panic hook, and includes a bounded city error body. That exact source passed the full default-parallel suite (48 passed, zero failed, three ignored, 35.67 seconds). The initial intermittent failure's precise cause is not established; these local passes do not replace full Linux CI.

The subsequent Linux run `39698560229` passed all 177 domestic tests and the original S16 case, but the factory test exceeded its 15-second phase guard while repeating city preparation for the second API version. The first version's strict national response had passed. Both versions share the same 23 input stages and canonical weather cache keys; the differing icon tail changes output formatting. The next correction prepares the 15 cities strictly twice, once per reconstruction phase via v000903, then retains both original version-specific national oracles. It removes redundant setup without increasing or resetting the 15-second guard or changing retries and runtime bounds. City-guard diagnostics identify phase, city and pass; successful national checks record phase elapsed time. Renewed validation and Linux CI remain required.

The exact once-per-phase source passed ten focused executions (40 strict national responses, all on attempt zero) and the full default-parallel runtime suite (48 passed, zero failed, three ignored). Focused phase elapsed times were 604–782 ms locally. Five peer slot refusals were observed across the ten runs without any functional failure; their request ownership is unproved. An initial diagnostic harness stopped on its extra zero-refusal condition after three functional passes. That record is preserved, and the remaining seven runs used the unchanged original functional oracle while recording refusals separately as a flake-risk signal. No zero-refusal or production availability claim is made.


## Dedicated Seoul EC2 campaign (2026-10-22 UTC)

AK authorized isolated Seoul t3.small measurements and corrections, with a USD100
campaign ceiling, at most one host at a time, at most two hours per host and an
encrypted 32 GiB root volume. The target is x86_64 Ubuntu 24.04, 2 vCPU,
1,998,577,664 bytes RAM, no swap and CPU Unlimited. All application storage and
providers are owned loopback fixtures. No production service, real S3 object,
provider endpoint, IAM setting or runtime admission limit was changed.

The first comparison uses the same host, corpus and release toolchain. The
measurement example uses the product's existing 12-permit S3 transport gate on
both revisions; its historical four-permit profile is not silently compared with
12. Before is runtime `0c163912`, after changes only manifest validation from
barriers of eight catalog reads to a rolling window of twelve. Partition scope,
full-envelope fingerprints, deadlines, writer/generation fences and memory/SSD
admission are unchanged. Pending borrowed reads are dropped on mismatch/error;
there are no detached catalog tasks. A deterministic stalled-first-catalog test
failed under the original batching and passed under the rolling window, including
the active-read bound and cancellation checks.

Source and execution identity:

- Corpus manifest SHA-256: `11606b79c26365e4ba8a5a906d5801f717845f853bafc971c2f099d27b7bbe3f`.
- Before binary: `af8fb4e349605a6438e862af0fbe7de3265755013a2c239a77f2e47871239be0`.
- After binary: `5003803bcbedeee9f0037c66f47e91cd6c61e6f8d15fc0b21b273b75168a95ff`.
- Changed manifest source: `0695518e41afd4cf2e00b5f32118e212c842426045a4c23ad3e96ea5ce2b0451`.
- Frozen first-host runner: `df008eecbcac7323f25b9d25b5312d8494d97fb2fb0455f0e7561294ab263003`.

Each observation is one independent process covering all 13 views, or one native
HTTP request. Twenty observations were requested at each modeled per-operation
GET/HEAD/LIST delay. p95 is nearest-rank over successful observations; counts and
failed/underpowered cohorts remain explicit. This is modeled loopback latency,
not an observation of production S3. Order is before then after, without a
statistical-significance or time-order independence claim.

| Delay ms | Restore before / after ms | Renewal before / after ms | Native SSD cold HTTP before / after ms |
| ---: | ---: | ---: | ---: |
| 0 | 629.93 / 617.89 | 397.26 / 388.43 | 1771.50 / 1796.19 |
| 5 | 1125.49 / 812.20 | 893.90 / 572.29 | 2114.06 / 2132.99 |
| 10 | 1704.58 (19) / 1231.33 (20) | 1469.15 (19) / 987.72 (20) | 2624.35 / 2637.47 |
| 20 | 2797.48 (20) / 2143.25 (19) | 2566.19 (20) / 1817.48 (19) | 2831.69 / 2854.94 |

Unparenthesized cells have 20 successful observations. The qualified 5 ms cohort
reduces renewal p95 by **35.98%** and restoration p95 by **27.84%**, both 20/20.
The 10/20 ms pure-path cohorts contain failures, so their success-only p95 is not
an accepted 20-sample improvement. Overall native HTTP does **not** improve.
Both revisions return the exact original 42,549-byte HTTP body in all 80 SSD
cold requests and both subsequent warm requests. Native SSD cold p95 misses the
separate 2,500 ms benchmark target at 10 and 20 ms before and after. The actual
product request ceiling remains three seconds; 2,500 ms is not a new runtime
timeout. Revalidation scheduling alone does not establish an HTTP speedup.

At 5 ms, each successful 13-view restore/renewal performs exactly 14 LIST and
725 catalog GET, transferring 937,987 classified response bytes, with zero
forecast descriptor/raw GET, raw parse or fold. The rolling window changes
scheduling, not authoritative I/O count. Memory reuse performs zero forecast I/O.
Native HTTP uses seven forecast views and also reads other datasets; thousands of
unclassified metric entries remain in its raw maps. Neither an unclassified
entry count nor zero forecast reads establishes zero total storage cost. The
invalid historical zone-support fixture remains separate from the forecast
oracle and was not repaired to improve this benchmark.

A retained single 20 ms HTTP trial makes the remaining work concrete. Unclassified
LIST deltas for cold/warm1/warm2 are 661/550/18 before and 530/692/18 after; GET
deltas are 39/60/0 and 3/100/0. KASI rise/set listing accounts for 549/503 and
436/622 of the first two LIST intervals, with warning and other optional-input
work also present. These peer-wide intervals can contain continuing background
owners. They are one trial per revision, not a cohort statistic or attribution
of those operations to the HTTP critical path. They show why forecast-only I/O
must not be described as the cost of the whole response.

Whole-child measurements include startup, diagnostic output/oracles and detached
work retirement, rather than phase-only CPU or RSS. Across delays, the before
13-view diagnostic CPU p95 is 8.18–8.38 CPU-seconds, after 8.19–8.57; peak RSS is
76.95 versus 77.58 MiB. Native SSD diagnostic CPU p95 is 1.82–1.98 versus
1.84–2.02 CPU-seconds; peak RSS is 89.80 versus 89.63 MiB. These do not establish
a CPU or memory improvement. Observed peer handler peaks rise from about eight
to thirteen for the catalog diagnostic. Handler lifetime can outlive a completed
response, so these are not measured client in-flight counts. No peer-refusal
counter was installed for this wrapper and no zero-refusal claim is made.

Two strict cache-path failures are retained. Before at 10 ms, a Transport error
during restore triggers correct raw fallback; exact Docs pass, but the diagnostic
zero-parse assertion fails (eight parses). After at 20 ms, all 39 output rows
have exact Docs and zero parse/fold; a Transport error during one Mid renewal
causes safe SSD restoration instead of renewal. The final counter is 12 renewals
instead of 13, so the whole wave fails strict path qualification. No wrong
response or peer-slot attribution follows from these failures, and they are not
erased by retries.

The first host also attempted native requests without folded SSD: base
`307defeb` failed all 80 cold requests; current `0c163912` failed its 35 attempted
cold requests before the host's measurement cutoff. Missing current cohorts and
warm phases are not successful observations, and no successful cold-latency
comparison is inferred. A fresh paired cohort and selector-boundary comparison
remain pending at this point in the campaign.

The first pilot failed in launcher syntax before a benchmark child. A second
pilot exhausted the Python coordinator's memory while retaining duplicate verbose
Doc/status maps; kernel evidence identifies that coordinator, while Rust children
completed. The runner now validates one row at a time and retains full raw JSONL
in gzip files. These are measurement-tool failures, not manufactured product Red
or discarded source regressions. The first full raw archive is 8,956,216,280 bytes
(SHA-256 `3ee50dab5290e564e6fd4da64097a5dd1bac5cd440f16a57c5a785c1c9278fbf`);
its full transfer, archive checksum and 1,392-file safe index were verified before
cleanup. All outcome/CPU/RSS/source metadata was also independently downloaded
and checked against 483 original file hashes with zero mismatches. The owned
instance terminated, its recorded root volume disappeared, the temporary security
group and key pair disappeared, and the local temporary SSH private key was
removed. Verification completed at 04:05:42 UTC, within the approved two-hour
host limit. No renewed PR review is claimed yet.

The initial 180-second compression and 2 GiB transfer guards were too small for
full raw retention. The original remote archive continued after the local SSH
timeout; recovery reused that immutable archive and resumed an interrupted SCP
from byte 5,521,382,400. Independent host/operator expiry guards were adjusted
to 117/118 minutes, still below the approved 120 minutes. With at most 12 GiB
export, the conservative per-host bound is USD1.783 before tax, rather than an
observed bill. No second host was created before full first-host cleanup.

CloudWatch basic five-minute metrics contain 22 observations: maximum CPU
utilization 78.02%, credit balance reaching zero and surplus credit balance up
to 45.18. The EC2 credit-mode API independently confirms Unlimited. These coarse
metrics qualify the host conditions; they do not attribute CPU use to an
individual trial or establish an invoice.


The working verification candidate subsequently adds explicit CI invocation of
the existing seven smoke and ten matrix controls. Both standalone commands pass
from the server2 working directory, as do the placement check and CI-source
compilation. The CI path was declared before its edit. This changes only the
task declaration and CI command selection after the target packet was frozen;
all runtime, example and matrix-runner bytes used by the measured binaries stay
unchanged. The 16-file candidate is
`sha256:d93934c5ea0751d92684e437f63224ca2b50a1e586b0be4b5db0c354db04d888`.
Existing benchmark execution hashes are retained rather than relabeled as the
new verification aggregate. Full remote Linux CI on the eventual commit is still
required.


### Second host: paired cold comparison and budget split

A fresh second Seoul t3.small completed the same-host no-SSD comparison:
base `307defeb` and current `0c163912` each attempted 20 requests at each
0/5/10/20 ms delay, and all 80 cold requests per revision returned 502. There is no successful
cold p95 or claim that this correction fixes uncached first-request availability.
The original first-host partial cohort remains separate.

Boundary diagnostics then completed 16 independent 0 ms waves with exact 13-view
prime/future-clock Docs. Whole-child times were about 27–29 seconds, including
independent expected replay and verbose evidence; measured future-view work
was about 8.1–8.8 seconds plus roughly 0.6–0.7 seconds prime. These 16 waves are
underpowered and are not a 20-sample percentile. The coordinator recorded a
prospective resource split before any after-variant result, interrupted only
the owned next boundary child with SIGINT and retained its INTERRUPTED receipt.
The resulting partial report and missing phases are not a product Red or a new
passing cohort. This avoids exceeding the host time budget and does not replace
failed samples with successes.

All second-host evidence was exported as 762,193,072 bytes / 572 files, SHA-256
`91347a26ecbb14b7f6d330a3c12fb719a18e4b16e45de49ca4889fe30ef6af40`.
The full archive hash/index and 202 selected metadata file hashes were verified.
Its instance, root volume, temporary security group and imported key pair were
verified absent. A conservative local-key path assertion then stopped because
the OS temporary directory differed from the expected prefix; the exact created
directory, permissions and public-key run identity were checked before deleting
only that task's local SSH inputs. No cloud resource remained for this repair.

Only after complete second-host cleanup, a third dedicated host started the
unchanged boundary-only source/binary/corpus/runner comparison. Observed whole-
child durations (about 27–29 seconds at 0 ms and 34–35 seconds at 5 ms) showed
that all four before/after delay groups would not fit one host's workload and
export allocation. Before any after result, the operator divided the primary
comparison by delay: 0/5 ms on the third host, 10/20 ms on a fresh fourth host
only after verified third-host export and resource/key cleanup. Each delay still
has 20 independent attempts per revision on the same host. Percentiles are never
pooled across hardware, and no allocation depends on success counts.

The third host preserves its first 20 attempts at 0 and 5 ms and its interrupted
next child. Its replacement sequential controller runs the after variant at
0/5 ms. The workload stop is 80 minutes; independent 110/118-minute host/operator
expiry stays below the approved 120 minutes. Four internal USD 2 per-host bounds sum to USD 8 before tax, rather than an
observed bill, within the approved USD 100 campaign. Rate-based estimates and
their unit assumptions remain in the dated operator records. The third host completed and cleaned up at 05:41:58 UTC. Its original archive is
2,651,991,978 bytes / 279 files, SHA-256
`ce70df8714d461256e9cd1f32abd8a3480af52d297951003c0ddf8109e20f925`.
Full archive hash/index verification preceded verified instance/root/SG/key-pair
and local temporary-key cleanup. The fourth host started only after that check;
its 10/20 ms comparison completed and full cleanup was verified at 06:40:09 UTC.

| Boundary delay ms | Before p95 ms (successful / attempted waves) | After p95 ms (successful / attempted waves) |
| ---: | ---: | ---: |
| 0 | 8027.31 (20/20) | 8072.90 (19/20, insufficient) |
| 5 | 15702.77 (20/20) | 15605.36 (20/20) |
| 10 | 23115.71 (20/20) | 22612.58 (20/20) |
| 20 | No successful boundary result (0/20) | No successful boundary result (0/20) |

These diagnostic times sum future-clock work across all 13 views. They do not
satisfy a native HTTP target. The 5 ms difference is about 0.62%; no material
boundary-speedup claim is made. Whole-child CPU p95 is about 24.6–25.2 CPU-seconds
and peak RSS about 112–114 MiB, including expected replay and output. Those
measurements do not demonstrate a resource improvement.

After 0 ms, trial 4 exits 101 in 315 ms before emitting any phase row: a diagnostic
`__catalog/status` request gets `hyper::Error(IncompleteMessage)` at example line
514. This is not an observed wrong Doc or a proven peer-slot rejection. The
original report has a separate failed `missing-output` sample; its boundary group
contains 19 emitted observations, while receipts retain all 20 attempted waves.
That missing row is not zero latency, and the failed wave is not replaced.

The 0/5 ms pairs share the third host; the 10/20 ms pairs share the fourth.
The 10 ms difference is about 2.18%, without a statistical-significance or broad
rebuild-speedup claim. At 20 ms, all 40 before/after child failures contain
`forecast cache: raw storage: Timeout`. Their retained traces show the existing
owner operation reaching about 8,001 ms. Each emits 13 prime rows but no future-
boundary row. The diagnostic caller allowance is 60 seconds; the eight-second
owner ceiling was never relaxed. No successful boundary p95 exists at 20 ms,
and no zero-latency observation is substituted. The correction does not resolve
this raw reconstruction limit.

Fourth-host raw evidence is 1,991,386,116 bytes / 271 safe files, SHA-256
`b5e5ae89ee4a7fbc9a184159afb8c5166c30acc5c01f82eecbb7d0587981b169`.
Its initial SCP timed out after 509,967,360 bytes. The exact local/remote prefix
hash matched before an offset-resumed transfer; full archive SHA/index checks
preceded verified instance/root/SG/key-pair and local temporary-key cleanup.
All four task hosts and temporary SSH resources are cleaned. No source cohort
was rerun to recover the transfer or replace its failed results.

### Source-bound correction checks

The rolling-window source passes the two focused progress/bound and rejection-
cancellation checks. The Red control extracts the original eight-read barrier
algorithm into the same helper and fails the intended progress timeout; it is
an algorithm control, rather than an unmodified production executable.

| Check | Actual result | Environment / scope |
| --- | --- | --- |
| Library | 173 passed | Offline Linux x86_64 musl release |
| Domestic integration | 177 passed, 2 ignored | Same source-bound Linux build |
| Runtime services | 48 passed, 3 ignored | Same source-bound Linux build |
| Python controls | 17 passed | Seven existing smoke plus ten matrix controls |
| Clippy, all targets, warnings denied | Passed | Darwin ARM64, Rust 1.99.0 |
| Linux image Clippy invocation | Not passed: component absent | No component was silently installed |

Separate local functional smoke uses the same optimized binary
`5003803b…` and current runner `aaf6ba51…`: one native SSD cold/two-warm sequence
and two 13-view future-clock boundary waves pass their original child oracles.
Their reports still say insufficient / acceptance false because one or two
observations do not meet the fixed twenty-sample performance qualification.
They establish functional wiring, not a local p95 or target-host substitute.

The full target measurement outcomes, current-commit Linux CI and independent
source/evidence review remain separate gates. A successful coordinator exit
never converts failed child/path samples into successful performance results.
