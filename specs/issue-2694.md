# S09 local feasibility tooling specification

## Scope and evidence boundary

[Intent](../intent/issue-2694.md) and [architecture](../docs/architecture/server2.md) govern this tool-only delivery. The CLI operates exclusively on literal HTTP loopback peers with fixed dummy credentials and has no live adapter fallback. Existing runtime bounds/deadlines stay unchanged. Local results cannot pass intended-host musl/TLS/SigV4/IAM, same-region S3, O-2/O-5, route parity or cutover gates. The original issue remains open.

## Interfaces and validation

`server2-feasibility --config PATH` accepts a version-1 JSON configuration (unknown fields rejected, at most 64 KiB). It contains a literal loopback S3 endpoint, a literal loopback provider endpoint, a bounded run identifier and cases. Endpoint URLs prohibit credentials, query, fragment, redirects and DNS names; only http://127.0.0.1:PORT/ is accepted. No credentials are read from the environment or profiles.

A case specifies workload `revisions` or `history8`, mode `cold`, `warm`, `provider_data`, `provider_nodata`, `provider_denied` or `provider_error`, selection `targeted`, `latest` or `full_history`, offered clients in 1..64, owner admission in 1..16 (default 4), trials in 1..100 and record bytes in 32..65536. Revision counts are 1..240. At most 32 cases, 128 total trials and 4096 offered client samples are permitted per invocation; calculated fixture and process bounds are validated before any request. Same-case identities are isolated by deterministic grid keys/run namespace. No precise user coordinates enter fixture identity/body/metadata. Aggregate fixture bounds are 2048 groups, 32 MiB raw bodies and a conservative 128 MiB identity-catalog version estimate. Consequently history8 at clients 16/32/64 exceeds this local fixture bound and is rejected, not claimed measured; offered concurrency at these levels remains supported for smaller valid revision workloads.

The existing resolver uses 3 s owner deadline, its own view CPU=2 and logical cache=128 MiB/64 MiB owner reservations; S05/S06 have independent I/O=16/CPU=2 pools. Offered clients are simultaneous distinct keys, not an admission increase. Runtime errors remain samples and never trigger benchmark retries. Explicit warmup and fixture seeding are excluded from request quantiles and counted separately.

## Workloads and correctness

Revision stress creates 30/60/100/160/240 immutable singleton groups (config also allows small test fixtures), one period per key, full fetched-time/hash identities and a valid owning catalog. Each publication uses S06. Each trial constructs a fresh resolver; within the trial offered clients share its configured admission. Latest/Targeted/FullHistory are reported separately. FullHistory can legitimately fail Capacity/Timeout under existing 64-page/3 s limits; it must not become partial success.

`history8` has eight actual day partitions, 24 hourly slot identities per day, 192 singleton groups per key. Since ResolutionRequest permits at most 16 periods, the batch uses two scopes (16+8) per day: 16 resolutions. The report labels this a synthetic multi-resolution workload, not one deployed API. It reports batch and component outcomes, records, distinct identities, revisions, groups, catalogs and request fan-out. It does not invent missing legacy grid-hour values.

The view builder validates synthetic JSON, counts actual parsed bytes/acquisitions and emits a bounded synthetic digest/count response. Parse/assembly elapsed durations inside the view CPU pool are measured explicitly; these wall-clock spans are not per-thread CPU time. Process CPU is independently measured by the runner. It does not implement weather response semantics. Targeted subset is never folded as all history. Warm cases prewarm each key and wait for maintenance idle before baseline counters; unexpected warm misses or I/O are visible rather than discarded.

Provider-miss uses real local S08 BudgetStore/FundedExecutor through a benchmark-only FundedAcquirer. One funded candidate is sufficient for these fixtures; maximum two attempts are pre-funded. Data is exact provider bytes and becomes a validated singleton acquisition; client success follows S06 raw+descriptor+catalog publication. NoData stays in RAM and maps to a terminal sanitized outcome, never an archive or fabricated empty weather row. Denied funding and provider errors are terminal, never a fallback. Peer counters assert zero weather raw/group/catalog PUTs for these cases, separately allowing budget authority/witness PUTs. Each key gets an isolated opaque quota identity and bounded current window; unused issued reservations are not recovered.

## Measurement report

Report schema 1 contains immutable config/binary/source revision and lock hashes, platform/runtime bounds, cases, samples, all-outcome nearest-rank p50/p95/p99 and separate success-only quantiles (null when no successes). Quantiles operate on integer microseconds; every offered client produces an outcome or explicit task failure. Empty/underpowered samples are marked insufficient; no statistical confidence or AWS latency guarantee is inferred. No failures are filtered from the principal latency distribution.

Client adapter wrappers record actual elapsed/status/body sizes, including cancelled futures with unknown status, for raw/control/LIST/budget/provider operations. Their first 4096 completion samples per operation have a complete/truncated flag; a truncated retained distribution cannot prove the full operation tail. All-call counters remain visible.

The loopback peer records sanitized method/prefix/status request counts, body bytes received/sent, in-flight peak, cumulative per-operation service durations and capped 20000-sample service quantiles (separate from client adapter round trips), current objects/bytes and retained version body bytes. Credentials/URLs/raw contents are not logged. LIST is distinguished from GET, budget writes from raw/group/catalog writes. The report includes seed, foreground interval and completed maintenance/drain deltas, not just desired concurrency. These are local HTTP observations, not AWS billed requests or version-conformance proof.

Runner executes the release binary with fresh volatile peers, captures process-specific wait4 user/system CPU and max RSS with platform-unit conversion, records binary/config/lock hashes and exit status, and bounds execution/output. Process metrics include startup/seeding; request quantiles do not. Unsupported metrics are unavailable, never zero placeholders. Cost estimates are operator-supplied prices with explicit provenance or null. Catalog-version body bytes and request counts are cost inputs, not an actual AWS bill; no lifecycle decision is automatic.

Every report ends `gate_status: requires_intended_host_and_same_region_measurements`, `rust_decision: pending_O2`, `lifecycle_decision: pending_O5`, `api_parity_verified: false` and `production_cutover_authorized: false` regardless of local speed.

## Tests and delivery

TOOL1: invalid remote/query/auth URLs, excessive cases/clients/trials/records and unknown schema are rejected before peer I/O; cold/warm/history identities and admission errors are exercised over actual local HTTP.
TOOL2: known quantiles include slow failed samples; empty success subset is null, report completeness/counts/hash provenance and RSS units are checked.
TOOL3: Data publication completes and fresh S3-only lookup matches; NoData/denial/error archive PUTs remain zero; budget/provider calls are accounted.
TOOL4: intended Red → Green → post-refactor, distinct release HTTP smoke, fmt/clippy/test/release, placement/artifact checks, actual screenshot and inspected PDF, CI and root-dispatched independent review. Existing S05/S06/S07/S08 regressions remain unchanged.
