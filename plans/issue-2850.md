# Forecast cache retention implementation plan

[Intent](../intent/issue-2850.md) · [Spec](../specs/issue-2850.md).
Owner /root; execution notebook `2026-10-22-issue-2850-forecast-cache-retention`;
local SDLC index under ignored reports/sdlc/issue-2850. Base `307defeb`, dependent
PR targets `fix/domestic-warm-cache-2819` while PR #2841 is open. One coherent
PR covers the source-view lifetime and disk optimization; no merge/deployment.

## Ordered slices and ownership

1. **Key fences (AC1):** forecast_cache registry/held generations and request-key
   mapping; isolate writer entry/drop and flight generations. Test two-key memory
   reuse, cancellation/panic and active-build installation. Root owns shared state.
2. **Selector boundaries (AC2):** derive expiry from existing latest/last_run,
   retained partition thresholds and day/month/future-fetch transitions. Add fixed
   clock minute-crossing, equality, rewind and all-13 golden comparisons.
3. **Identity renewal (AC3):** records/forecast_manifest searched scope and canonical
   controls; read-before/raw/read-after fence; 30-second wall/monotonic checks in
   owned single flight. Test unchanged zero-raw/parse/fold, newer same-partition
   acquisition, missing/new partition and failed/concurrent controls.
4. **Disk restore (AC4):** forecast_disk bounded bit-preserving encoding and restricted
   shared DiskCache API; eager fill/admit under generation fence. Test memory
   eviction, process restart, wrong identity/revision/hash, truncation, cap and
   fallback. Measure serialized/allocated sizes and restore time for 13 views.
5. **Evidence and documentation (AC5):** update D2/operator/diagram. Run focused and
   neighboring Rust checks, fmt/Clippy, placement and artifact policy, plus separate
   owned-peer native HTTP smoke. Preserve source fixture/original hash; no live S3.
6. Commit/push, create stacked PR, independent required reviewer/fallback plus
   available optional reviewers, fix selected findings, rerun affected checks and
   CI. Re-observe head/base, protections and auto-merge state; stop merge-ready.

Each slice depends on previous slices. No parallel builders; one target and build
owner. Use server2/target with CARGO_INCREMENTAL=0, DEV/TEST_DEBUG=0, jobs=2; check
space before builds (137 GiB initially, target absent, 3 GiB reserve). Preserve
smoke binary/hash before eligible cache cleanup. No global toolchain change.

All exact path operations are declared in the intent; add no implementation outside
server2. No dependency additions. Existing goldens, source interfaces, response
and S16 identity remain the oracle. Internal optimization introduces no product
feature/UI/API; update existing operator Markdown and diagram, no new manual flow.

## Scenarios and proof

[Structured scenarios](issue-2850.scenarios.json) map users/actions/failure paths to
AC1–5. Focused checks use module unit tests and `tests/domestic/forecast_cache.rs`.
All-13 goldens and native HTTP use existing `domestic_warm_cache_smoke` and its
owned loopback peer; extend existing measurement tooling only as needed. Test-first
each missing behavior; post-change regression and separately executed runtime smoke
are required. Missing environment is blocked, never intended Red.

## Risk, alternatives and rollback

Most dangerous: mixed catalog/raw snapshots and post-write stale admission. Prove
with held asynchronous operations and final key/identity fences. Key-state ABA is
prevented by retained Arc identity; decode/copy stays bounded by workspace and
same admission budgets. Shared disk cap counts raw and views together.

Rejected LIST-only fingerprint (misses existing-partition writes), separate disk
owner (lock/cap conflict), projected API JSON (lossy), incremental fold (unproven).
No migration: schema revision misses. Rollback code or disable the existing local
cache; canonical S3 data is unchanged. Affected behavior remains single-process.

## Approved EC2 performance extension (2026-10-22)

Owner remains /root. This extends the existing stacked PR2851 on307defeb and retains all stage counters and historic source reviews. AK approved one dedicated Seoul t3.small/2GiB/CPU Unlimited, max32GiB root and2hours per host, with a totalUSD100 campaign ceiling and no repeat budget questions below it. Source-bound operator records live under ignored ec2-v1; no production/IAM/live-S3/provider/merge action.

Before dependent edits, add the exact tools `server2/tools/forecast_retention_matrix.py` and `server2/tools/test_forecast_retention_matrix.py` to the task declaration. Existing declared example, cache/manifest modules, regression tests and operator/selected-evidence documents may change only for this campaign. No catalog_peer change is needed: the matrix wraps its existing bounded Handler in an isolated loopback child. Outside paths remain the nine existing declared documents/contracts; no new outside implementation.

Dependency order:

1. Source-bound Linux preparation: build the frozen0c example and base307 example offline in the existingColima context with a private cloned cache. Preserve existing2849 cache and globalDocker configuration. Bind executable hashes, Rust toolchain, corpus and source maps; locally run the original13goldens before spending EC2 time.
2. Portable measurement tool: fresh helper per child for exact resource usage; normalize LinuxKiB/Darwinbytes; preserve timeout/error samples and all operation counters. Add only example disk-prime and disk-check modes to separate valid cache preparation from independently delayed restore/renewal trials. Set the example's transport to the unchanged product gate12 and label historicalgate4 explicitly. Pure tests cover p95/sample denominators, RSS units, failures and delay validation; an isolated peer self-check proves controlled delay/counts and cleanup.
3. Approved host lifecycle: pin officialx86_64AMI, one task-tagged host andSSHresources, IMDSv2/noIAMprofile, rootdeleteontermination, /32SSH ingress and bounded outboundbootstrap. Arm host/operator expiry before workloads. Upload only synthetic source-bound measurement inputs. No public application listener.
4. Target pilot: run originalcold/native, diskprime0delay, then independent diskcheck/http-disk at0/5/10/20ms. Capture exact failures, actualcatalogconcurrency, per-phasecosts, CPU/RSS and output/counter equivalence. Base has noSSD mode; compare its realcold/aged behavior without fabricated disk rows.
5. Select only a reproduced #2850 bottleneck. Record a dated design update, regressionRed/Green and existingidentity/race/capacity/codec tests; then compare initialversuscorrected candidates using20independent observations perapplicable phase/delay andnearest-rankp95. Do not count13correlatedviews as13independenttrials. Keep native3s/owner8s and report any2.5s benchmark-target miss.
6. Update selectedtarget evidence andaffected operator/architecture/Archify claims, freshlint/tests/smoke, independentreviews andcurrentCI. Exportoriginalfailures andselectedresults, terminateverifyownedcloudresources, cleanonlytaskbuildoutput afterconsumersfinish, preserve runnablebinaries. Renewpre-mergereadiness; no merge.

Runtime architecture is unchanged during tool preparation, so reuse existingdiagramchecks with an explicit scope limitation. Revisit affecteddiagram evidence after a selected runtime change. Reusable tool tests go in server2; all runs/private source copies remain ignored. No existingtest/CIgate is weakened.

### EC2 correction candidate: bounded identity validation window

The first actual t3.small pilot (one observation, not acceptance) measured the
13-view restore/renew corpus at 611/399 ms with loopback reads and 1809/1447 ms
with 10 ms added per read. Catalog revalidation already uses batches of eight;
it is not serial. Test a rolling window of at most twelve active catalog
reads, matching the existing global S3 admission of twelve. A completed read
can release its window slot without waiting for the slowest member of a batch.
No task is spawned, no catalog result is reused across authority checks, and a
mismatch/error drops pending reads. Partition selection, full-envelope hashes,
writer/epoch fences, the caller deadline and the memory/SSD admission rules stay
at their current contracts. Select the candidate only after the same target
matrix demonstrates improvement without response/identity/IO regression.

Use the existing batched algorithm as the before-change behavioral control: a
stalled first catalog prevents remaining catalogs from starting. The regression
requires progress in other available slots while that catalog remains pending,
and checks bounded concurrency and cancellation on mismatch/error. Preserve all
failed native trials and insufficient sample groups; do not retry them away.

### Target input isolation and remaining verification

Run boundary reconstruction in a separate matrix with the original SSD snapshot
restored before every independent trial. Its diagnostic60s limit and original
future-clock Doc oracle cannot be presented as native latency acceptance. Record
20waves at0/5/10/20ms before/after; do not mix a boundary-mutated SSD with the
native restore matrix. Whole-child CPU/RSS includes output/oracles, while phase
latency excludes those costs. Distinguish functional success from2500ms p95.

The first approved host owns sequential current/rolling12 SSD matrices and
base/current native cold comparisons. Stop workloads before the host expiry,
export raw failures plus hashed source bindings, and verify instance/root/SG/key
cleanup. If the remaining boundary/cold scenarios exceed that host's time limit,
prepare inputs locally and use a replacement dedicated host only after the first
host's cleanup is verified. Keep one live host and the per-host2hour/32GiB limit;
all hosts share the approvedUSD100 campaign ceiling. Repeat each before/after
comparison on the same host and report host identity rather than pool different
hardware into a percentile. Never restart a failed cohort to erase its failures.

The actual batched-control Red and rolling-window Green are retained. Reuse
current source-bound library173, domestic177, runtime48, all-targetClippy,
Python17 and separate native HTTP smoke only while the tested bytes match.
Refresh the candidate after tool/code changes. Finish remaining measurement,
current self-verification, independent source/evidence reviews and fresh fullCI
before renewed pre-merge readiness. No merge or production action is selected.


### Export sizing and source terminology clarification

The2.5s target is benchmark acceptance, while the existing native request ceiling
is3s. Keep failed responses and partial cohorts distinct from that latency target.
The first fullrawarchive is8.956GB;180s compression/2GiB export proved too small.
It was preserved by an offset-resumed transfer, verified before complete task-only
cleanup within the approved2hours. A replacement host starts only after that
cleanup. Reserve30minutes after the80minute workload stop for export using
900second compression/transfer bounds, a12GiB upper bound, host110minute
termination and an independent118minute operator deadline. These remain below
the approved120minutes; the conservative12GiB per-host bound isUSD1.783 before
tax, not a bill, within the internalUSD2/campaignUSD100 limits. No new runtime
change or repeat-success substitution is introduced by this operator repair.
