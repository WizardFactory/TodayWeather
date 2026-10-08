# S09 feasibility benchmark operations

## What this delivery measures

This tool exercises the actual Rust raw store, catalog, resolver and funded-acquisition libraries against fresh volatile HTTP peers. It measures synthetic origin work, not a deployed weather route. The local runner calls no real AWS/providers. A separately armed approved driver can use one dedicated same-region test bucket after eligible review. This delivery has not executed that mode and proves no API parity, CloudFront latency, actual IAM/TLS or intended-host musl feasibility. S09 remains open: same-region intended-host measurements and O-2/O-5 decisions still block S10/S13.

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

Local runner trials use fresh resolvers. The approved-driver warm case instead reuses one resolver across observation waves, with one complete prewarm and maintenance idle; cold trials still start with empty resolver memory. Warm prerequisites must all succeed before counters are sampled. A warm report with idle baseline must have zero wire I/O. Foreground and background maintenance counts are separate. Capacity, Timeout and other typed outcomes remain visible; they cannot become a partial success or provider miss.

Offered clients are distinct keys, not parallel raw reads. The owner deadline remains 3 s, logical cache 128 MiB and owner reservation 64 MiB. View CPU=2; catalog/raw libraries each have their own bounded I/O=16 and CPU=2 pools. These are not a process RSS limit. S06 descriptor normalization is sequential; FullHistory page-size 1 repeats normalization and can hit page/deadline bounds. No optimization or old parallel-wave latency claim is made.

Client adapters record elapsed time, received status and known request/response body sizes. Cancellation leaves received status unknown. The first 4096 completion samples per operation are retained; a truncated distribution does not prove the full tail. All-call counters remain. Peer service durations use a separate capped 20000-sample distribution, not network RTT. Counters include LIST, status/conflict outcomes, bytes, peak in-flight requests and catalog current/version body bytes. Local version accounting is not AWS billing/conformance proof.

Warmup view timings are separate from foreground parse/assembly totals. Process-specific wait4 CPU and peak RSS include startup/seeding; cold request quantiles do not. Darwin RSS is bytes; Linux KiB is converted to bytes; unknown units remain null. Parse/assembly spans are elapsed wall time inside the view pool, not per-thread CPU. Seed, foreground, maintenance and fresh durability checks are recorded separately. Costs/prices remain null until supplied with provenance.

## Funded miss and durability checks

Provider modes run real local S08 reservation/executor code through a benchmark-only adapter. Data receives raw+descriptor+catalog publication before client success, followed by a fresh S3-only lookup that checks exact bytes. NoData/code 03 remains RAM-only and terminal. Funding denial and provider errors cannot archive weather raw/group/catalog objects; their zero PUT fence is validated independently of allowed budget writes. Denial makes zero provider calls. This fixture seam does not deliver a production S07/S08 provider adapter or weather semantics.

Every report retains requires_intended_host_and_same_region_measurements, pending_O2, pending_O5, api_parity_verified=false and production_cutover_authorized=false. A fast local result cannot change these gates. The fixed resource scope is approved, but creation and live measurement wait for frozen tooling and an eligible review. The local CLI has no live fallback.

## Verification and references

Regression tests cover failure-inclusive quantiles, null/unavailable denominators, RSS units, target/budget bounds, cold/idle-warm HTTP, orphan siblings, actual eight-day identities, admission pressure and funded Data/NoData/denial/error fences. The distinct release runner supplies the usage capture below. Its low-sample results demonstrate tool behavior only. Existing S05-S08 tests and placement/artifact checks remain required.

See the [architecture](../architecture/server2.md), [task specification](../../specs/issue-2694.md). No live host or AWS run is asserted by this manual.

## Approved driver and operator boundary

The [resource approval](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6052596161) expires 2026-10-10T04:49:59Z. It permits one dedicated Seoul c6i.large host for at most two hours, one hour of benchmark work and an operator stop at USD 5. No production hosts, actual weather/geocoder providers, MongoDB or notification state are used. The fixed account is 141248341265; the bucket and temporary role names are fixed by the inert templates. Synthetic S3 objects and all their versions remain after cleanup. Owned host/root storage, temporary IAM and security-group cleanup never delete bucket objects.

These validation commands perform no network I/O:

```sh
server2/target/release/server2-feasibility \
  --validate-aws-config server2/config/benchmarks/aws.json
python3 server2/deploy/benchmark/aws_operator.py
```

The operator template is inert. Actual execution requires reviewed source/config/lock hashes, actual host-musl binary hash, an eligible native review receipt, explicit authorization and a fresh private state file. The operator first creates a host with no egress, proves the stock timer/kernel guard, then permits outbound IPv4 HTTPS to 0.0.0.0/0:443 for the entire run. This is a port restriction, not an AWS destination allowlist; it does not authorize arbitrary workloads. It verifies an Online SSM agent with a strictly parsed AgentVersion of at least 3.3.40.0 before the first RunCommand, build hashes and the actual getconf CLK_TCK value. A private source-bound manifest grants one allocation; worker.claim is exclusive and cannot be resumed. A lost worker has cleanup authority only. Operator calls, IMDS, SSM/log export and bootstrap traffic have separate bounded grants.

The live binary entry requires --aws-config, --run-manifest and --execute-approved-run together. It refuses arbitrary endpoints and requires the fixed private manifest location, Linux x86_64 musl, source/binary/config hashes and the actual role identity. IMDSv2 credentials stay in RAM and refresh coherently; no profile discovery, secret output or URL logging is allowed. Protocol preflight uses actual HTTPS adapters, hash/MD5/gzip checks, 404, conditional 200/412 and CAS/version checks. Signed missing-condition and forbidden-namespace probes must return 403 before any measured sweep. None of those real-host proofs is asserted by local tests.

## Attempt, byte and version accounting

Worker limits are 390,000 GET/HEAD, 18,000 PUT/LIST, 26 GiB reserved download and 63 MiB stored-version charge. Controller limits are 10,000 GET/HEAD, 2,000 PUT/LIST, 3 GiB bootstrap plus 1 GiB administration and 1 MiB store. IMDS uses at most 512 MiB of controller administration, not an additional grant. Every potential PUT permanently charges body length plus 16 KiB, including failed, denied, duplicate and ambiguous attempts. This allowance is conservative bookkeeping, not exact billing. No refund or object inventory renews it.

Read phase caps are protocol 5k, cold 280k, repair 60k, warm 10k, funding 10k and failure 25k. Every delegated retry/CAS/LIST/repair/budget operation receives a ticket before dispatch. Credential waits and local validation may make admitted attempts an upper bound rather than exact received requests. Confirmed status/body sizes, reserved bytes and unknown completion are separate. Unknown S3 or metadata work fails overall compliance. The controller independently checks metadata requests at most 1,024, bytes at most 512 MiB, unknown_calls=0 and worker overall compliance.

Canonical fixture estimates include gzip, descriptor and every intermediate catalog version. Read limits use the largest generated raw/control body plus 1,024 bytes of margin, within existing runtime bounds. The estimate can refuse a case; actual tickets remain authoritative. A read one byte above its cap cannot certify accounting. Real NIC arrivals/retransmissions are not physically bounded by application counters; stock guards and operator observations provide separate backstops.

## Interpret the approved-driver report

The bounded 32-case template covers cold/warm/targeted/latest/full-history, a synthetic eight-day batch, one first-flight orphan repair and local funded Data/NoData/denial/error behavior at selected offered levels. It is not a full Cartesian matrix. Reuse immutable physical fixtures across fresh cold trials; report groups, revisions, day catalogs, resolution count, response keys and offered/admitted clients separately. Repair samples describe one initial orphan wave, not later healthy-catalog requests as repair p95.

The target_samples field counts offered client observations. independent_RAM_empty_resolver_trials counts actual fresh trials, approximately ceil(samples / clients). Shared waiters are not independent backend samples. The current template does not prove the original 300 independent cold trials per level; omitted/refused or underpowered coverage is INSUFFICIENT. Warm resolver metrics are case-cumulative; ledger before/foreground/owned-work deltas isolate each wave. A verified second warm wave must add no S3/provider I/O.

Network clients are shared after protocol and seeding. RAM-empty measurements therefore include warmed TCP/TLS/DNS pools and do not model a fully fresh Spot process. Phase-tagged first protocol samples are separate. Process RSS/CPU includes protocol and seeding; Linux tick conversion needs the actual host getconf receipt. The local history8 batch took 14.054289 s in a historical fixture: this is a feasibility risk, not an existing weather API or CloudFront latency claim.

The maintained operator test can drive the compiled worker through a fake CLI/SSM controller and real loopback S3/provider peers. This functional proof uses the same source-bound manifest, claim, ledger and workload code; it asserts real AWS=0, metadata=0 and host gate=false. It cannot substitute for the approved intended-host measurement or AK O-2/O-5 decisions. S09 stays open and S10/S13 stay blocked until those original gates hold.


## Fixed host reads and placement guard

The [exact33-path amendment](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6054300695) permits four source/operation/path roles only: Path::new on /opt/server2-s09 and /opt/server2-s09/run for private ownership checks, and read_to_string on /proc/self/status and /proc/self/stat for this process's diagnostics. The gate validates the canonical S09 declaration on later whole-tree audits too. Declarations cannot add source files, other operations, prefixes/globs or compiler/encoded/legacy exceptions. Static checks remain an aid to human review, not a filesystem sandbox.


## Failure reports and uncertain work

After a valid one-use worker claim, an aborted run emits a bounded JSON report on stdout and exits 2. run_status is ABORTED, abort_reason is a sanitized stable class, requested_case_coverage_complete is false and overall_accounting_compliance_pass is false. Completed cases and the current partial case retain summary denominators, typed outcomes, received-status counters, admitted attempts, bytes and permanent version charges. No later case is dispatched. Details that exceed the 2 MiB export limit are omitted explicitly while summaries remain; this omission also prevents a compliant result. No credentials, signed URLs or arbitrary provider errors are copied into abort_reason.

A configuration, source, manifest or exclusive-claim rejection before execution may exit 1 without JSON. The controller preserves bounded stderr and a missing-report diagnostic with false compliance. For a claimed run it exports at most 2 MiB of result and 64 KiB of sanitized worker errors, exclusively creates private local evidence and persists its digests and false compliance before validating worker status, identity or accounting. Rejected, failed or timed-out work never becomes a successful measurement. Cleanup runs after evidence preservation; export failures are themselves recorded, not treated as an absent failure.

IMDS accounting distinguishes confirmed non-200 status and response-header/length/stream-cap rejection (failed_known) from incomplete transport, cancellation or unknown completion (unknown_calls). Confirmed failures retain conservative reservation and status information; they never permit metadata preflight to continue. Truly unknown work remains charged and makes overall compliance false. Local controller-worker proof uses no actual IMDS, IAM, SSM service or AWS endpoints.

## Host I/O inventory and guard limitations

The [nonliteral inventory clarification](https://github.com/WizardFactory/TodayWeather/issues/2694#issuecomment-6055549129) is recorded in S09.json for manual source review. It is distinct from the unchanged four literal machine waivers. Review covers the bounded private manifest read and validated ancestry; adjacent exclusive worker.claim create/write/fsync; hashes of the frozen 33 source paths and Cargo.lock under the build checkout; bounded current_exe hash; and caller-owned configuration plus bounded private result/error/state files. The local seam uses its owned temporary inputs and ignored reports. Computed paths, concatenations and aliases are not a complete static security boundary; every nonliteral access requires manual ownership and source review. This inventory grants no arbitrary create/open/include exemption.

The stock kernel thresholds are intentionally stricter than the accounting grants: 2 GiB bootstrap, 24 GiB benchmark and 28 GiB global, compared with 3/26/30 GiB application grants. They reserve headroom for uncontrolled traffic and may drop traffic and abort a run earlier. A grant is a ceiling, not an entitlement to consume the full amount. Independent host/guard/version proof remains unexecuted until the approved live preflight succeeds.

## Cost assessment and operator stop

The USD 5 operator stop is an operational authorization limit, not a dynamic billing monitor or hard invoice cap. A fresh regional price assessment precedes arming. The 2026-10-08 official rates imply known maximum components of approximately USD 0.43610055: c6i.large two hours (0.192), public IPv4 two hours (0.010), 16 GiB gp3 for two hours using a 730-hour month (0.00399781), 400,000 GET/HEAD (0.140), 20,000 PUT/LIST (0.090), and 64 MiB S3 retention for 48 hours (0.00010274). These are conservative authorized quantities, not actual usage or an invoice.

The estimate excludes taxes, unknown bootstrap/log transfers, billing granularity, delayed termination and permanent retention. Retained 64 MiB alone is approximately USD 0.0015625 per month at USD 0.025/GiB-month. Objects are not deleted to control cost. The operator must assess these gaps and stop within authority; code cannot guarantee the total bill. Rates are revision-bound observations from the [official Seoul S3 regional offer](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-northeast-2/index.json), [EC2 regional offer](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/ap-northeast-2/index.json) and [VPC public IPv4 pricing](https://aws.amazon.com/vpc/pricing/). Actual host cost and feasibility remain pending.

## Case admission and export time reserve

Before the next case's estimates, seed publication or resolver construction, prior unresolved S3 uncertainty closes admission. Completed and partial earlier outcomes and permanent charges remain in the bounded non-compliant report. Bounded reconciliation already owned by the current operation remains allowed. The two-cold-profile final-trial response-loss fixture checks that no next-case request, PUT body or stored-version charge is added.

The controller reserves 15 minutes before the earlier host or approval deadline. The effective benchmark window is at most 59 minutes 30 seconds, within the approved 60-minute ceiling, with up to 30 seconds of completion grace inside the reserve. At least 14 minutes 30 seconds then remain for bounded best-effort export and owned cleanup. A worker window below 5 minutes is refused before arming and is checked again after transfers before dispatch. The SSM command cap stays 3,600 seconds. This reserve does not guarantee SSM availability or completed export and does not extend host life or grants.

A non-compliant abort still goes directly to conservative cleanup after preserving available failure output. Post-abort guard readback and observed version inventory may be unavailable; this is an accepted safe evidence limitation, not a compliant result or a reason to renew the allocation.

## Local CLI rejection and watchdog diagnostics

A newly observed AWS CLI exit 252 with its exact Unknown options marker is classified as a sanitized local parsing rejection. Raw stderr and argument values are not published; digits in a rejected option cannot become an AWS HTTP status. Other unknown subprocess outcomes remain conservative. See the [official return-code contract](https://docs.aws.amazon.com/cli/latest/userguide/cli-usage-returncodes.html). This classification applies to the new observation only. An offline reproduction of an old invalid command does not recover its discarded stderr or establish the original launch's absence.

Watchdog writes owned_termination_requested only after verifying an owned host and successfully requesting termination. An attempted launch with no resolved unique host is original_launch_unresolved; no recorded launch is no_launch_recorded. All three diagnostics set host_absence_verified=false. A requested termination is not root-volume disappearance or completed cleanup. UNKNOWN zero/multiple discovery still blocks every destructive cleanup action; do not adopt or delete ancillary resources based on an empty list.

The maintained local check is `python3 server2/deploy/benchmark/test_aws_operator.py --cleanup-functional-smoke`. It exercises actual isolated fake CLI subprocesses, truthful watchdog states and the unchanged UNKNOWN cleanup fence. It calls no AWS/IMDS and reads no configured account profile or original private run state. Existing synthetic release workload capture remains a separate local benchmark demonstration.

The explicit cleanup-only exception permits at most total fifteen corrective builds, including the historical ten. The installed ten-attempt helper remains unchanged; the same-task exception journal describes its structural limit and manual gates. No second launch, measurements, grant renewal or ancillary-only deletion is authorized. The later AK instruction supersedes that historical allowance: only the current ordinal11 may continue, and any actual final-check, commit, push or QA failure requires stop/RCA without retry, further fix or ordinal12. Intended Red is a planned defect reproduction; prior setup failures remain recorded. Actual original launch remains UNKNOWN until separately reviewed evidence proves otherwise; S09 stays open and S10/S13 remain blocked.
