# KMA verification and live measurement — 2026-10-24

## Result

The bounded pilot executed real provider acquisition, durable canonical S3
publication and native HTTP replay. Frozen CORE/Rich replay passed **312 output
comparisons with zero body or functional-header mismatches**. The live run
retrieved seven ASOS calendar dates, but did **not** qualify complete historical
phenomena, unchanged live client values or production p95/p99.

The strongest storage finding is discovery fan-out: **18,520 LIST operations out
of 21,113 native S3 reads, 87.718%**, across capture and 18 partial/unqualified
HTTP responses. This supports measuring and reducing repeated discovery and
sharing a bounded input closure before investing in raw-body packs. These are
aggregate operation counts, not an attribution of wall time to each family.

[Selected machine-readable evidence](kma-validation-measurement-2026-10-24.json)
contains acquisition/coverage identities, separate profiles, operation counts,
receipt hashes and explicit qualification flags. This follows the
[independent design reassessment](kma-storage-reassessment-2026-10-24.md) and
[selected design](../../architecture/server2-kma-data-design.md).

| Check/profile | Actual result | Interpretation |
| --- | --- | --- |
| Frozen native CORE / Rich | 220 / 92 comparisons; zero mismatches | Paired legacy-fixture parity, including four disk phases per request; excludes live parity |
| Empty weather namespace, acquisition and publication | 17 logical jobs, 14 published groups; 2.347 s for the parallel batch, N=1 | Fixed Seoul owners plus diagnostic reach probes; excludes full client assembly |
| Canonical S3, fresh Source and no disk cache | 13 requests; p50 2.718 s; empirical p95/p99 2.721 s | Partial/unqualified HTTP 200; 12 S3 permits; underpowered and reservation-limited |
| Read-only continuation, actual Source reuse | 3 reused requests: 2.717, 2.509, 1.723 s | Separate four-permit profile; excludes its initial setup request; no qualified speedup or tail estimate |
| ASOS seven-date range | 168 hourly rows/timestamps, 7 daily rows | Field presence and row counts; excludes QC, PTY/LGT mapping and final boundary qualification |
| Remove short/RSS from frozen input | 82 past weather-field differences across 9 `short` slots | Concrete unchanged-value conflict for this available input closure |

Nearest-rank empirical p95/p99 coincide with the maximum of 13 samples. They are
**not production tail estimates**. There were zero history-qualified completions;
history-completion percentiles remain null. HTTP status and stable body hashes
do not establish complete forecast or historical coverage.

## Scope and reproducible tools

Runtime baseline: `82f7a4838dda046be966ee9c25c9cb66561d099d`. No production
runtime source, Cargo dependency or lockfile changed. New task-owned tools are
[the native example](../../../server2/examples/kma_cold_measure.rs),
[bounded S3/provider adapter](../../../server2/examples/kma_cold_measure/scope.rs),
[runner](../../../server2/tools/verification/kma_cold_measure.py),
[guard tests](../../../server2/tools/verification/test_kma_cold_measure.py) and
placement declaration (`KMA-MEASURE.json`, kept outside the repository history because a PR holds one declaration).

Measurements ran on a macOS arm64 workstation against ap-northeast-2, not the
deployed EC2/CloudFront/API Gateway path. Source RAM and disk inputs were empty
for each fresh-Source request; native TLS clients, connections and process/OS
state were reused. Process startup and network cold start were not measured.
HTTP timing started after Source/route construction. Native background work
could continue between requests, so cumulative operation totals include that
work and must not be divided into an exact per-grid or per-request cost.

The live interval was 2026-10-24 **06:31:31–06:54:56 UTC** (15:31:31–15:54:56
KST), including an idle gap before continuation. Fixed public targets were grid
60/127, ASOS/outlook station 108, land region 11B00000 and temperature region
11B10101. Native v000903 address requests used Seoul/Jongno/Cheongunhyoja.
This does not qualify exact location-selector behavior across Korea.

The restored route was the existing full native route with providers/geocoder
disabled. Only captured weather products populated the namespace; empty
ancillary air/life/warning discovery still contributed control reads. This was
not a pruned weather-only pipeline. Internal disabled-provider attempts were
retained in local receipts and made no external calls. Real production fallback
acquisition could change both coverage and latency.

Raw/catalog/budget operations used existing direct native TLS/SigV4 transports.
Index LIST used the same signer, timeout, bounded gate and complete XML checks,
but a separate instrumented HTTP client pool to account for response bytes.
This pool difference is a measurement limitation. No SDK/proxy, provider mock or
new bucket was used for live capture. Restores used the actual captured raw.

Original logical RawId, envelope and group-declaration bytes stayed unchanged.
The adapter inserted the exclusive namespace after each permitted v2 root and
restored logical LIST keys for native readers. Only these physical prefixes in
the existing server2 bucket were writable:

```text
raw/v2/verification/kma-20261024-2088bed9a96e4f62/
index/v2/verification/kma-20261024-2088bed9a96e4f62/
budgets/v2/verification/kma-20261024-2088bed9a96e4f62/
```

CLI checks proved all three empty before writes; native raw/index empty checks
also ran. Provider admission still passed through native S08 budget CAS under
the task budget prefix. Credentials came from the existing local AWS profile
and private provider configuration into a narrow child environment; credential
values were not retained. No production objects were overwritten or deleted;
test objects remain at the listed prefixes for retained raw evidence.

The main invocation, from the repository root, was:

```sh
python3.11 server2/tools/verification/kma_cold_measure.py \
  --binary reports/kma-validation-20261024/artifacts/examples/kma_cold_measure \
  --out reports/kma-validation-20261024/live-1 --samples 30
```

The owned `reports/` directory holds ignored exact receipts and as-run source
snapshots; maintained documentation depends only on the selected evidence
linked above. Pilot and continuation binaries/source hashes are distinct and
recorded there. Both source/binary identities stayed unchanged during their
respective live runs. A later XML test-literal raw-string correction preserves
its string bytes and does not change the measured runtime.

## Provider acquisition and durable publication

Four concurrent jobs acquired latest ODAM, VSRT and SHRT; the three distinct
mid-range products; ODAM/VSRT reach probes at 1, 6, 24 and 168 hours; ASOS hourly
and daily ranges; and current town RSS. No historical SHRT request was made.
Current RSS was captured to replay the existing contract, not admitted as a new
historical source policy.

| Product | Acquire + publish, ms | Captured shape |
| --- | ---: | --- |
| Latest ODAM | 580.263 | 8 category rows |
| Latest VSRT | 680.572 | 66 category rows |
| Latest SHRT | 1,522.932 | 798 category rows; one complete page |
| Mid outlook | 561.615 | One row |
| Mid land | 292.992 | One row |
| Mid temperature | 273.464 | One row |
| ASOS hourly | 1,041.915 | 168 rows, 2026-10-17 00:00 through 2026-10-23 23:00 |
| ASOS daily | 561.617 | Seven dates, 2026-10-17 through 2026-10-23 |

Each timing is one observed acquisition, including native admission, provider
work and durable publication. They are not per-product percentiles and cannot
be added to obtain provider-to-client latency. The batch's 2.347 s includes the
diagnostic probes and excludes subsequent HTTP restore.

The ODAM 24-hour and 168-hour probes and VSRT 168-hour probe returned native
`Provider(Rejected)`. VSRT at 24 hours **did publish**, so this experiment does
not support a universal 24-hour retrieval cutoff. There were 17 provider
transport admissions. Redirect hops were not individually instrumented; the
native four-hop bound gives an upper bound of 68 wire attempts, not a measured
count of 68.

ASOS hourly had 168 cloud fields present and 25 nonempty `dmstMtphNo` strings.
Presence alone does not establish valid/QC-compatible cloud values. Phenomenon
tokenization, empty-value meaning and equivalence to existing PTY/LGT remain
unqualified. This single afternoon run does not test the documented pre-11:00
D−1 availability boundary. A calendar range ending D−1 23:00 also does not prove
the legacy 01:00..24:00 day attribution or availability of D0 midnight.

Fourteen one-page groups published with 42 raw/catalog/group PUTs and 56
verification GETs, matching the existing publisher accounting for this shape.
Native budget work added 16 PUTs and 8 GETs; two native empty LISTs bring capture
to 58 writes and 66 reads/LIST. Three initial CLI LISTs are counted separately.

## Restore profiles, guards and discovery cost

The first profile requested 30 samples per phase, but stopped after 13 fresh
Source requests and one subsequent phase-setup request. The setup request was
2.332 s and **did not reuse a Source**. Thirteen ledger denials occurred under
concurrent byte reservation pressure: each in-flight index LIST reserves up to
8 MiB before sending. The final conservative charge was 159.326 MiB, below the
250 MiB cap; the stop was not evidence that 159 MiB crossed the network or that
provider quota was exhausted. Successful partial responses after a guard denial
remain visible; this profile cannot qualify complete-response performance.

A read-only continuation carried the exact prefix, settled parent counters,
charges and original 30-minute deadline forward. Writes were rejected before
sending; no provider job ran. Lowering S3 concurrency to four allowed a setup
request (2.717 s) and three actual same-Source requests without new denials.
All four returned HTTP 200. Do not pool these samples with the 12-permit profile
or infer an optimized shared-RAM speedup from three sequential requests.

All 18 HTTP responses were 44,230 bytes with SHA-256
`dc19b48a251ca003af20783b0e9cca6530f3d9e74776b85d66d6d6d01152f797`.
This shows repeatability of this captured partial input, not equivalence to a
simultaneous live legacy response. Source reuse still performed S3 I/O; the
proposed shared raw-input closure and packs remain unimplemented.

| Cumulative native operation | Count |
| --- | ---: |
| Raw LIST | 1,771 |
| Index LIST | 16,749 |
| Control/catalog GET | 2,115 |
| Group GET | 228 |
| Raw GET | 242 |
| Budget GET | 8 |
| Raw/control/budget PUT | 14 / 28 / 16 |

Native reads total 21,113; add the three initial CLI namespace LISTs. The
read-only continuation added 1,772 reads and zero writes/provider sends.
An earlier bucket-region prerequisite read is outside benchmark counts.
All counters settled to zero reserved bytes. The final conservative body/header
charge was **173.901 MiB**; it includes fixed header allowances and maximum
charges for unknown/cancelled operations, not measured wire traffic. No dollar
cost was measured or estimated.

The original limits stayed fixed: 256 provider-wire-attempt upper bound
(64 admissions × at most four native hops), 50,000 reads including CLI preflight,
5,000 writes, 250 MiB conservative application charge and 30 minutes. The
continuation reset neither counts nor deadline. No larger campaign was run.

LIST dominance is directly measured, but the ledger does not tag every LIST by
logical family/prefix. Therefore a particular historical warning scan or a
particular grid catalog is not proved to be its exact cause. The full route and
empty ancillary controls are part of this baseline. Before an ownership-changing
catalog migration, instrument family-level discovery and compare a bounded,
deduplicated in-memory closure with unchanged fallback and output eligibility.

## Frozen replay and historical-source counterexample

The retained release binary ran the existing `native_suite.py` CORE and Rich
checks. CORE checked 55 requests across four disk phases (220 outputs); Rich
checked 23 across four phases (92). Both had zero body/functional-header oracle
mismatches. Perturbation controls detected eight unexplained differences in each
suite, showing the comparator rejects changed results. These are native-loopback
fixture checks, not deployment startup or live value-equivalence tests. The
older 98 assembly-only dependency cases were not relabelled as native coverage.

A separate deterministic probe removed whole `short` and `rss` raw families
from the existing CORE fixture, keeping other raw inputs, native code, request
and clock (`2026-09-24T06:31:00.000Z`) fixed. Both responses were HTTP 200. The
comparison restricted weather fields to dates before KST today and found **82
field differences across nine past `short` slots**. Affected fields include
`pop`, six-hour rain/snow values and interval metadata, humidity, temperature,
wind and wave values. Life-derived differences were excluded from this count.

There were zero past daily differences in this particular fixture. This probe
does not establish daily-overlay equivalence generally, an affected-date census
or the result of a minimally changed production source policy. It demonstrates
that deleting past-forecast inputs is not value-preserving for the frozen
available closure. Additional equivalent measurements are a separate proof
obligation; missing values must not be invented.

## Verification, retention and remaining gates

The final harness passed four Rust guard tests, three Python controls, rustfmt
and release Clippy with `-D warnings`, using existing Rust 1.99.0, locked/offline
dependencies and the shared target. The tool tests check namespace isolation,
admission/cancel accounting, complete index XML, settled continuation counters,
credential narrowing and failure denominators. The build's optional
`rust-objcopy` LLVM debug-extraction warning did not prevent builds or execution.

Task-scoped placement passed, along with 55 offline evidence-identity/count
checks, 328 local links/fragments and 63 source-line targets. The selected
snapshot passed `check-artifact-policy.py --staged` in an isolated temporary
index/object directory; the real index SHA-256 was unchanged. The full-worktree
placement command also sees
unrelated pre-existing uncommitted documentation; it must not be described as a
clean whole-worktree pass. Existing user files were preserved. No runtime flow
or architecture diagram changed; the existing validated diagram remains the
proposed design, with this report linked as its measured baseline.

The pre-existing shared `server2/target` remains protected because other consumers
are not ruled out. Required release executables and both as-run source snapshots
were copied into the ignored task evidence directory with SHA-256 identities.
No cache was deleted and zero disk space was reclaimed; final free space stayed
well above the 3 GiB reserve. No deployment, commit or push was performed.

The next qualification gates remain explicit: automatic equivalent seven-day
cloud/PTY/LGT input including day boundaries; the unchanged-value/source-policy
conflict; family-level discovery/input-closure measurements; then complete
provider-to-client tails on the deployment class with sufficient samples and
failure/completeness accounting. The present pilot supports prioritizing
discovery and reuse, while complete-history activation remains blocked.
