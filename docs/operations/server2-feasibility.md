# S09 local feasibility benchmark

## What this delivery measures

This tool exercises the actual Rust raw store, catalog, resolver and funded-acquisition libraries against fresh volatile HTTP peers. It measures synthetic origin work, not a deployed weather route. It neither calls live AWS/providers nor proves API parity, CloudFront latency, TLS/SigV4/IAM or the intended Linux host's musl feasibility. S09 remains open: same-region intended-host measurements and O-2/O-5 decisions still block S10/S13.

## Run an isolated release measurement

From the repository root, build the single benchmark binary. Rust workspace files and benchmark implementation stay under server2. Python 3.9 or newer is required; the measured reference run uses Python 3.11.

```sh
cargo build --locked --manifest-path server2/Cargo.toml \
  --release --bin server2-feasibility
python3 server2/tools/benchmark/run.py \
  --config server2/config/benchmarks/local.json \
  --output reports/s09-local.json
```

The maintained runner creates a fresh literal 127.0.0.1 peer and rewrites both endpoints in an effective configuration. The template's port 1 is a placeholder; the direct CLI does not discover or start peers. `--validate-config PATH` checks the complete schema before I/O. Remote/DNS/auth/query/fragment endpoints and unknown fields fail closed. Only fixed dummy local credentials are used; profiles and environment keys are not loaded. The peer checks protocol shape, not AWS authentication.

The runner validates the requested configuration from one byte snapshot. It records that hash and the rewritten effective-config hash separately. Binary, lock, driver, model, runner and peer hashes are captured before execution and checked afterward; changed files invalidate the run. A dirty checkout revision does not assert that current source bytes belong to HEAD. The runner limits process duration to 1..600 seconds (default 300), kills only its owned process group on timeout and rejects output above 8 MiB. Keep output under ignored reports; it is an observation, not source.

## Choose a valid workload

Each case specifies name, workload, mode, selection, clients, owners, trials, revisions and record_bytes. Selection is targeted/latest/full_history; offered clients are 1..64, owner admission 1..16, revisions 1..240, trials 1..100 and body size 32..65536 bytes. Optional siblings=2 and layout=orphan/partial exercise record/group recovery. Revision stress uses valid immutable singleton groups; counts 30/60/100/160/240 are configurable, not automatically claimed measured.

`history8` uses eight actual day catalogs, 24 hourly identities per day and 192 singleton groups. Existing request period limits require 16 scopes (16+8 hours per day). It is a synthetic 16-resolution batch, not one existing API. Any component failure makes the batch unsuccessful; all component outcomes remain visible. No missing legacy history is fabricated.

Aggregate limits are 32 cases, 128 trials, 4096 offered samples, 2048 groups, 32 MiB fixture raw bodies and a conservative 128 MiB catalog-version estimate. Thus history8 with 16/32/64 clients is rejected before I/O. Smaller revision workloads support higher offered client counts. Validate each proposed matrix; do not silently reduce revisions or increase production limits to obtain a result. Workload generation itself may hit existing bounds; a setup failure yields no successful report.

## Read durations and failures correctly

Principal all-request p50/p95/p99 uses nearest-rank integer microseconds for every attempted success or failure. A separate success-only distribution has its own denominator. Warm-unavailable entries have null duration, never zero; both distributions flag fewer than 100 measured samples as insufficient. The small default smoke has two clients per case and cannot establish a latency tail.

Each trial uses a fresh resolver. Warm prerequisites must all succeed, then maintenance reaches idle before counters are sampled. A warm report with idle baseline must have zero wire I/O. Foreground and background maintenance counts are separate. Capacity, Timeout and other typed outcomes remain visible; they cannot become a partial success or provider miss.

Offered clients are distinct keys, not parallel raw reads. The owner deadline remains 3 s, logical cache 128 MiB and owner reservation 64 MiB. View CPU=2; catalog/raw libraries each have their own bounded I/O=16 and CPU=2 pools. These are not a process RSS limit. S06 descriptor normalization is sequential; FullHistory page-size 1 repeats normalization and can hit page/deadline bounds. No optimization or old parallel-wave latency claim is made.

Client adapters record elapsed time, received status and known request/response body sizes. Cancellation leaves received status unknown. The first 4096 completion samples per operation are retained; a truncated distribution does not prove the full tail. All-call counters remain. Peer service durations use a separate capped 20000-sample distribution, not network RTT. Counters include LIST, status/conflict outcomes, bytes, peak in-flight requests and catalog current/version body bytes. Local version accounting is not AWS billing/conformance proof.

Warmup view timings are separate from foreground parse/assembly totals. Process-specific wait4 CPU and peak RSS include startup/seeding; cold request quantiles do not. Darwin RSS is bytes; Linux KiB is converted to bytes; unknown units remain null. Parse/assembly spans are elapsed wall time inside the view pool, not per-thread CPU. Seed, foreground, maintenance and fresh durability checks are recorded separately. Costs/prices remain null until supplied with provenance.

## Funded miss and durability checks

Provider modes run real local S08 reservation/executor code through a benchmark-only adapter. Data receives raw+descriptor+catalog publication before client success, followed by a fresh S3-only lookup that checks exact bytes. NoData/code 03 remains RAM-only and terminal. Funding denial and provider errors cannot archive weather raw/group/catalog objects; their zero PUT fence is validated independently of allowed budget writes. Denial makes zero provider calls. This fixture seam does not deliver a production S07/S08 provider adapter or weather semantics.

Every report retains requires_intended_host_and_same_region_measurements, pending_O2, pending_O5, api_parity_verified=false and production_cutover_authorized=false. A fast local result cannot change these gates. Actual host/bucket/role creation or measurement requires separately approved scope; the CLI intentionally has no live fallback.

## Verification and references

Regression tests cover failure-inclusive quantiles, null/unavailable denominators, RSS units, target/budget bounds, cold/idle-warm HTTP, orphan siblings, actual eight-day identities, admission pressure and funded Data/NoData/denial/error fences. The distinct release runner supplies the usage capture below. Its low-sample results demonstrate tool behavior only. Existing S05-S08 tests and placement/artifact checks remain required.

See the [architecture](../architecture/server2.md), [task specification](../../specs/issue-2694.md). No live host or AWS run is asserted by this manual.
