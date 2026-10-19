# D3 world cold-load implementation handoff

Stable task: `issue-2819-world-cold-load`. Owner: delegated worker prepares this contract; root alone owns SDLC stage state, implementation gate and shared-document integration. Worktree `/private/tmp/tw-world-cold-load-work`; branch `fix/world-cold-load-2819`; base `c1ae9082b2c86f0087727be9872b0cf82b4e3bb1`; endpoint pre-merge. [Intent](../intent/issue-2819-world-cold-load.md), [spec](../specs/issue-2819-world-cold-load.md), [exact path declaration](../server2/config/tasks/WorldColdLoad2819.json).

## Current checkpoint and boundary

Root approved the prepared triage/intent/investigation/spec/design/plan/test design and authorized build1. The worker completed intended tests-only Red, scoped runtime/test implementation and the local checks recorded below. Root alone writes SDLC stage state and owns integration. The worker had no commit/network/shared-document authority. Root subsequently delivered PR2838 under the existing pre-merge contract; merge/queue and production actions remain prohibited. Ignored execution evidence is in `reports/sdlc/issue-2819-world-cold-load/build1/`; root links this task into its existing canonical notebook.

One coherent PR: same-cell cold restore outcome ownership and aggregate restore limits. Both prevent cold-read amplification without changing provider semantics. Domestic warm-history D2, world CPU offload/shared core admission, metrics export, S3 class fairness and production qualification are separate PRs. No new generic framework, S07 primitive changes or dependencies are planned.

## Source evidence and access limits

Reusable source research: coordinator's ignored `reports/sdlc/issue-2819-followup-research/capacity.md`. Necessary facts are restated here so maintained contracts do not depend on that local report. Graft was tried first at the frozen base: two asks had no nodes; one grep reported no graph. No rebuild occurred. `rg` was unavailable; grep/find/Python source fallback was used. Savings reported by Graft: none. This is source inspection and fixture arithmetic, not execution or independent review.

- `world/engine.rs::loaded/load_cell`: one spawned load per cold caller, success recheck under `CellEntry::op`, failure leaves Db absent and each queued caller can restore again; load deadline starts after cell-lock wait.
- `world/store.rs::load`: 21 finite partitions, fanout 4 gate and accumulating raw results; the permit currently ends before JoinSet result consumption. `load_first_dates` accumulates sequentially.
- `storage/catalog_model.rs::CatalogLimits::default`: 32MiB output and 2048 entries. `storage/catalog.rs::raw_checked` charges raw length per S06 operation. `storage::Limits` supplies 8MiB raw and 8MiB+64KiB compressed caps. Existing bounded/decompression-checked behavior is not missing.
- `resolver/owned.rs::OwnedFlights::join/entry`: three-second waiter cap; owner deadline begins at admission; one task survives waiters; completed `Some(result)` and owner-expired outcomes are retained with monotonic completion time; panic otherwise drops its sender and permits retry. Existing outer timeout does not preempt synchronous CPU.

### Static fixture basis for proposed defaults

Read-only Python gzip/JSON inspection on 2026-10-19: `tests/world/fixtures/oracle.json.gz` SHA256 `54825f967c5cd422fd9b625e8c863ab6c519657697f944198ba22524f92fe864` contains 37 scenarios and 81 body strings, 5,008,657 total UTF-8 bytes, largest 77,598 bytes. Counting every request's recorded combined/recent/forecast body (an intentional overcount of restore inputs) yields 83 calls and 5,554,402 bytes across all scenarios; the largest scenario total is 436,204 bytes/7 calls (`london-dst-end`). The widget fixture uses the same Tokyo source recording in existing tests. No fixture mutation or executable test was performed.

Default whole-load 32MiB/2048 caps reuse existing S06 source constants rather than inventing measured production allowances and exceed this entire retained VC corpus. The corpus is not a long-lived production-history maximum. Defaults still require actual candidate oracle/recovery regressions and explicit operational qualification; prior legal histories above the new aggregate cap will fail closed. The 160MiB logical raw reservation arithmetic is documented in WC4 and is not a host/RSS estimate.

## Selected small design and original interface sketch

One settled sketch uses existing ownership primitives; no independent arena/panel selection is claimed. Alternatives rejected: a new generic flight manager (duplicates S07), a process flight retaining `Arc<CellEntry>` (pins idle trim), a retained Db copy keyed only by cell (can revive stale state after eviction), and a load mutex alone (repeats errors). A cell-local flight preserves the existing identity owner and makes completed-error retention disposable with the cell.

The following sketch was prepared before implementation. The current implemented interface is in world/store.rs; this sketch records the design, not an unimplemented-status claim:

```rust
// world/store.rs; public through the existing public world::store module.
#[derive(Clone, Debug)]
pub struct WorldLoadLimits {
    pub raw_bytes: usize, // default: 32 * 1024 * 1024
    pub fetches: usize,   // default: 2048
}
impl WorldLoadLimits {
    pub fn validate(&self) -> Result<(), storage::Error>;
}
impl<T: CatalogTransport + 'static> CatalogWorldStore<T> {
    // Existing new(transport, catalog_limits) delegates with default load limits.
    pub fn with_load_limits(
        transport: T,
        catalog_limits: CatalogLimits,
        load_limits: WorldLoadLimits,
    ) -> Result<Self, storage::Error>;
}
// WorldStore::{load,publish} and load_first_dates signatures remain unchanged.

// world/engine.rs private CellEntry field:
// OwnedFlights<(), Result<(), Failure>>; running=1, entries=1, retain=3s.
// loaded joins with min(caller deadline, now+3s), owner gets config.load from
// initial admission. Owner mutates only its current CellEntry.db, then returns().
```

`world/runtime.rs::build_with_air` explicitly chooses the named default load policy through this constructor; no environment selector or changed provider construction. Tests import `world::store::WorldLoadLimits` directly, avoiding an unrelated `world/mod.rs` re-export. Keep `WorldConfig` public layout intact. `load_cell` retains its operation trace, existing success/failure counters and provider-fetch mutual exclusion. A world-local unwind-to-`Failure::Error` adapter may be used inside the owned future to publish panic failure through S07's ordinary result channel; `futures-util` is already a dependency. No new observability policy is introduced.

Rolling partition scheduling holds at most 4 scheduled results/reservations, including completed unconsumed tasks. Check a returned partition's total count/bytes with checked arithmetic before extending the retained Vec. The partition-to-RawFetch conversion is fallible and count/byte capped too. On failure drop pending tasks/results and propagate capacity; do not fetch a provider or return a partial load. Preserve existing per-partition S06 control/raw limits and sorting. `load_first_dates` uses the same accumulator sequentially.

## Ordered work after the root gate

1. Root records design/intent approval and the active stage receipt in its existing state. Review exact defaults, idle-eviction memo scope and the changed deadline start. If a path/interface must change, update declaration and spec before dependent edits.
2. Add the smallest public same-cell failure/cancel checks to new `server2/tests/world/cold_load.rs`, registered by `tests/world.rs`. Run on untouched engine/store and record the intended load-counter mismatch. For configurable policy, add the source-compatible constructor and validated policy storage as the minimum interface scaffold after approval, with existing load behavior still unchanged. Then run tiny-cap tests and retain the intended over-cap success-versus-Capacity mismatch before implementing enforcement. A missing-interface compile error is not behavior Red; do not require huge fixtures merely to cross the32MiB production default.
3. Implement cell-local S07 ownership and the world-local aggregate policy/scheduler in declared runtime paths. Keep every completed behavior check green as the coherent slice progresses. No CPU/S3/metrics framework refactor.
4. Run scoped new tests and existing world target (chain/parity/privacy/requester/restore/switch/widget), resolver owned-flight regressions and applicable storage/catalog regressions. Inspect selected test dependencies first. Run fmt/clippy and task placement/artifact checks appropriate to the candidate. Preserve failures separately; no concurrency/deadline weakening. Root schedules Cargo targets/builds after checking disk/free-space and the 3GiB reserve; this worker has created no build artifacts.
5. Additional functional proof: use the existing unmodified `server2/tools/world_smoke.py` with the candidate `loopback_server` executable, owned S3/VC/WAQI peers, allowlisted environment and empty working directory. It exercises real process HTTP, one funded cell fetch and provider-down S3 restart recovery, separately from focused fault tests. Retain exact source/executable hashes, observed status/body/counter deltas and closed-listener cleanup. The existing smoke alone does not prove 16-failure sharing or cap boundaries; focused actual HTTP S3 tests own those. If a new smoke executable/tool becomes necessary, root must approve its exact declaration before editing.
6. Root updates shared architecture/operations/parent status and existing Archify JSON; root regenerates and validates artifact/browser/visual output. Worker owns task-specific selected verification evidence after actual execution. Source assertions and proposed outcomes must not become PASS by documentation.
7. Only when separately authorized beyond preparation: root advances pre-merge delivery through candidate commits/push/PR, eligible independent review/correction and exact-head CI. Reconcile any new base. Keep merge disabled and #2819/#2704/#2705/shadow/production gates open.

## Proposed behavior checks and scenarios

The following rows preserve the original pre-implementation test design. Actual runs and residual coverage limits are in the build1 and review1 correction sections below; these proposals are not blanket execution claims. New test code belongs only to `server2/tests/world/cold_load.rs`; existing shared helpers and fixtures are reused without changes. Use small injected policies, explicit barriers/latches and virtual monotonic time where practical; do not sleep 8s/3s per case or generate huge fixtures merely to trip a default.

| ID / requirement | Scenario and independent expected observation |
| --- | --- |
| T1 / WC1,WC6 | Counting fake WorldStore blocks one cold error until 16 same-cell callers join. Release `Storage(Transport)`; all 16 return existing error, loads = 1 and VC = 0. The unchanged engine should load repeatedly. A second call inside completed 3s retention does not read again. |
| T2 / WC1,WC2 | After T1, advance 3s retention and make storage return recorded complete raw. Concurrent demand admits 1 recovery owner, installs Db and returns exact oracle response with VC disabled. Failure never made an empty success. A different cell has independent ownership. |
| T3 / WC2 | Cancel/drop the initiating HTTP/library waiter after store admission; other waiters remain. Release the store and observe 1 publication of restore outcome, Db reuse and 0 VC. A short caller deadline does not shorten the 8s owner; a late joiner cannot extend it. Use an 8s virtual boundary with a store that honors deadline and one that remains pending. |
| T4 / WC1,WC2 | Block two callers then finish/panic/expire the owner. Error maps fail closed with no stuck pending key; retention behavior follows the spec. Existing idle busy-burst trim tests stay unchanged. With max_cells=1, eviction/recreation must restore fresh storage rather than receive an old retained successful Db. |
| T5 / WC3 | Actual owned S3 catalogs contain individually valid records across multiple partitions. Under small bytes cap (e.g. 128B payload cap, two 80B records), load returns Capacity rather than 160B or a partial Vec; exact-boundary 128B succeeds. Separate count cap 2 with 3 tiny fetches tests count independently. Invalid limits fail construction, 0 provider calls. Existing cap checks remain enabled. |
| T6 / WC4 | Latch-controlled partition transport observes at most 4 outstanding results. Let first four finish while parent completion consumption is held; no fifth partition may start. Consume one under cap and permit one replacement. Trigger aggregate overflow and verify no next wave, pending cancellation/result release, no success and no extra provider call. Count completed unconsumed output as reserved, not only network inflight. |
| T7 / WC3,WC4 | Same small over-cap history through load_first_dates fails wholly; under-cap strict reads preserve excluded-group refusal and exact `(fetched_at_ms,sha256)` ordering. Duplicate identities count toward declared retained bytes/count unless existing source already eliminates them. |
| T8 / WC5 | Run unchanged world recorded parity/empty-memory restore and widget suite under defaults. Include DST, negative/polar/dateline cells, units/locales, no-yesterday/range fallback, provider funding/backoff and cold unreadable S3→0VC. Additional executable HTTP smoke proves the selected public process path separately. |

For T5's tiny bodies, direct WorldStore loading tests need legal RawRecord/catalog structure, not semantically useful VC weather; the success control for whole response uses existing actual VC raw. For T6, avoid adding production test hooks: use transport barriers and observable dispatched requests; if consumption cannot be deterministically held through that boundary, keep the scheduling invariant as a private unit test within declared `world/store.rs` and a separate actual transport peak/count assertion. Both observations must be reported honestly.

## Integration and remaining risk

Root owns `docs/architecture/server2.md`, its existing Archify source/generated HTML, `docs/operations/server2-native-verification.md` and `plans/issue-2614.md`; this worker must not edit them. The declaration lists those exact outside paths and reasons for coordinated integration. No new runtime dependency, include, symlink or source/data read may reach legacy. Review every added/modified/renamed path against the declaration before completion.

The new aggregate default can refuse a historical cell that 21 individually bounded partitions previously accepted; this is intentional fail-closed behavior, not measured operating capacity. Per-cell limits do not bound all concurrent cells or RSS. Three-second completed-error retention trades bounded retry traffic for short recovery delay; idle cell eviction can clear the disposable gate. The remaining synchronous CPU sites and cooperative timeout limits are explicit follow-ups. This paragraph originally described preparation. Root later approved implementation, delivered PR2838 and received independent review1 Request Changes. Current test-only correction and source evidence are recorded below; no final independent PASS, merge-ready or production qualification is claimed here.

## Historical preparation content checks (before implementation, 2026-10-19)

At that preparation checkpoint only four files were untracked and runtime/tests were unchanged at the frozen base. Declaration JSON parses, its exact server2 paths are under server2, and links among the preparation files resolve. The placement command first could not start under PATH python3 because tomllib was absent; this is not a passed check. Re-running the existing read-only checker with installed python3.11 and the exact declaration/base exited0 and reported valid task paths/layout/literal boundaries. This is a preparation placement result only, not runtime verification, TDD, independent review, CI or implementation approval. No Cargo, build/test binary, commit, network or tracker command had run at that preparation checkpoint. The root gate and later actual execution are recorded below.

## build1 local execution handoff (2026-10-19)

Root approved the design and test plan, then granted the sole shared Cargo lease. The frozen-source Red1 compiled and failed both new public cohort checks exactly at storage load count16 versus1, after existing-error and0-provider assertions passed. Red2 used only the validated policy constructor scaffold with unchanged store loading; individually legal80B+80B partitions returned160B under a128B whole-load policy instead of Capacity. Both actual exits101 and source/test copies/hashes are retained.

The candidate implements the specified cell-local S07 flight,3s completed failure retention, original8s owner admission deadline/at-most3s waiter, world-local panic-to-failed-outcome conversion, and32MiB/2048 aggregate output limits for ordinary and summary restoration. Rolling scheduling includes completed unconsumed outputs in its four slots. No generic S07, shared CPU, process metrics or S3-class policy changed.

Candidate results, counted once: world50 passed (41 existing +9 new D3); resolver owned4 passed/40filtered; raw_records34 passed; catalogs33 passed; summary27 passed:148 distinct tests total. All-target Clippy `-D warnings`, fmt check, exact-base placement and git diff whitespace check exited0. Earlier focused8-test Green is not added again. The release loopback example built successfully. An independent invocation of the existing owned HTTP executable smoke exited0 with17 same-cell requests sharing one funded VC call, identical provider-down/empty-memory S3 weather+air restart bytes, cell-only stored identity and development coexistence rollback. These are local checks, not independent review, exact CI, main integration, whole-native qualification or production capacity.

Logs/exits/source maps are in the ignored build1 directory. `before-inputs.json` and inputs retain Red1; red2-inputs/source retain the unenforced policy scaffold. Candidate source hashes are final-source.json; copied optimized loopback executable and world test executable, with hashes, are outside the shared target under artifacts/. The readiness coordinator's separately copied artifacts were untouched. PATH python3 lacked tomllib for the first preparation placement attempt; installed python3.11 executed the real placement checker successfully.

Capacity/process handling: shared target resolved to `/private/tmp/server2-parallel-target`; pre-run free space133GiB and target1.9GiB, final free133GiB and target1.7GiB. Both dev and release server2 package output were cleaned on each worktree switch; shared dependencies were preserved. No additional caches were deleted, and no precise space-recovery attribution is claimed because root borrowed the target for its own F1 Red between runs. Final compiler and owned smoke process checks found no active Cargo/rustc or this task's peer. Two old catalog peers belonged to other Claude worktrees from October15/16 and were left untouched. Root has the Cargo lease back; the shared target is protected for its pending F1 consumers.

Shared architecture/operations/Archify/evidence integration remains root-owned. A draft is in build1/shared-doc-draft.md. No source/test edit followed the successful candidate runs. This plan update changes documentation only; root decides the next stage and review/delivery eligibility.

## Current review1 correction (2026-10-19)

PR2838 review1 requested independent-cell progress coverage (WORLD-REVIEW-001). Root also selected003 pending-sibling abort/sorting coverage and004 this plan status correction. The two new tests and strengthened sorting run pass: world52, owned4, summary27, catalogs33 and raw34 =150distinct checks, not150+11focused. All-target Clippy and format check pass. Production code and optimized smoke inputs remain byte-identical to9bda00c5; the original optimized owned HTTP smoke is reused explicitly, not re-executed or relabelled as main/full-native qualification. Original failed scaffolding runs are retained as test harness failures, not runtime Red.

The new independent-cell case holds A pending while B completes its own recorded restoration and then releases A. The aggregate case overflows128B with two80B partitions while pending siblings exist; Drop guards prove cancellation and dispatch is bounded. Under-cap inputs are deliberately reversed and exact fetched-time/hash output sorting is checked.

Root did not select002 private-cell-lock contention coverage or005 automatically deriving the separate whole-load admission policy from per-operation S06 constants. The existing8s-value waiter test is not a discriminating lock-contention experiment; deadline-before-lock is supported by source. Logical160MiB arithmetic remains distinct from RSS, CPU and concurrent-cell capacity. Original Required/Recommended findings remain open for independent reviewer2 disposition; author application is not reviewer resolution. No additional tracking is created for unselected recommendations.
