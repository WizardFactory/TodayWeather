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
