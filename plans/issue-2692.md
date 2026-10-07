# S07 execution plan

Owner: `/root/s05_raw_records`. [Issue #2692](https://github.com/WizardFactory/TodayWeather/issues/2692), [intent](../intent/issue-2692.md), [spec](../specs/issue-2692.md). One isolated branch/PR from merged master `94019cf5`; endpoint pre-merge. [Exact path declaration](https://github.com/WizardFactory/TodayWeather/issues/2692#issuecomment-6046142667) covers runtime, tests, operations manual and four root-owned shared documents.

## Sequence

1. Establish test-first cache/index contracts: typed exact request and geocode keys, byte leases including pinned evicted values, bounded sharded hash/LRU, sorted revision ranges, KST midnight attribution and DST-aware epochs. Capture an actual assertion Red against a narrow valid baseline stub, then implement and verify.
2. Implement the S06 backend adapter with shared transport, finite scoped repair, bounded paged/targeted selection and explicit coverage. Dependency refresh includes absent catalogs; excluded descriptors/groups prevent response cache admission. Preserve every existing S05/S06 regression and format.
3. Add resolver ownership: bounded caller and owner admission, one flight per full resolution key, independent waiter deadlines, fixed owner deadline, cooperative drain, CPU permits and temporary buffer leases. Include cleanup on panic/cancellation and complete publication before response assembly.
4. Expose the abstract funded acquisition seam agreed with S08. Exercise only recorded fixtures locally. An unresolved S3 repair is a terminal typed failure, never permission to call a provider. Actual S08 composition remains a later gate.
5. Run focused Green and post-refactor checks, then a distinct maintained release HTTP example against the isolated local S3 peer. Generate the editable operations manual, actual usage capture and PDF; render and inspect every page.
6. Review declared paths, dependencies, maintained links and artifacts; run fmt, clippy, workspace tests, release, placement and the full CI entrypoint. Reuse unchanged legacy oracle checks with an explicit rationale; no live provider or production work. Commit and check actual outgoing snapshots before PUSH.
7. Open one PR, publish exact head/base and full candidate file map, observe CI, and reserve an actual root-dispatched independent Claude review. Preserve all findings and fix selected issues through the original bounded stage counters.
8. After actual PASS and no selected changes remaining, validate fresh remote head/base, CI and manual/diagram state, post final readiness and stop with `merge_authorized: false`.

## User scenarios and evidence

| Scenario | Observable outcome | Criteria | Coverage |
| --- | --- | --- | --- |
| Exact locale and boundary geocode labels | Separate volatile exact keys, invalid precise archival projection rejected | AC1/4 | Key/privacy tests and manual |
| Cold S3 and warm memory | Identical frozen bytes; warm S3/provider work is zero | AC2 | Actual HTTP wire and distinct release smoke |
| Cancelled initiator and concurrent request | One owned operation; remaining waiter receives checked result | AC3 | Milestone-controlled async tests and wire fixture |
| Cache pressure and pinned values | Evicted values remain charged until the last reference drops | AC3 | Byte/admission tests and smoke |
| Late revisions and negative dependencies | Known changes invalidate immediately; external changes appear after bounded refresh | AC2/3 | Catalog/absence/exclusion tests |
| Spot drain | New requests rejected; admitted owners finish or report bounded unfinished work | AC3 | Controlled publication and CPU tests |
| Revision and hourly indexes | Deterministic full-hash order, previous-day midnight, distinct DST instants | AC1 | Range/permutation/KST/DST tests |
| Proven empty provider acquisition | Only finite CompleteEmpty calls recorded funded seam; complete S3 publication precedes response | AC2/3 | Wire miss/publication/error fixtures |

## Risk, alternatives and rollback

The riskiest behavior is ownership under cancellation and memory pressure: an evicted Arc must stay charged, and a cancelled HTTP caller must not cancel another waiter's durable work. Operation and cache byte limits are logical admission bounds, not a hard RSS guarantee. CPU pools are bounded per layer, not one global two-thread limit. Scoped indexes must never label selected records as complete history.

Rejected alternatives: whole-history cold reads that poison mature partitions; a shared cache or disk database; cache-wide locks across async I/O; new Moka dependency before explicit pin-lifetime accounting. S06 targeted access and bounded pagination remain usable, while exhausted work returns documented typed failures.

This can break future assembler integrations if they omit an output parameter from the key or misuse coverage. Constructors and private checked values guard the reusable API; S10/later route parity and parser integration remain required. S08 provider funding and S09 real AWS feasibility are not demonstrated by the local callback/peer.

Rollback is removal of the internal modules/call sites on this branch. No route or deployment switch is introduced, and S3 records are not deleted or rewritten. Root owns shared architecture and diagram changes; this builder consumes their validated hashes. Every stage has at most ten total attempts; no counter reset.

The initial actual suite covers 19 cache/index/HTTP cases. Scoped selection skips unrelated periods but preserves whole acquisitions; excluded descriptors never enter the response map. Raw retention does not avoid GETs, and history page-size-one normalization remains a measured-feasibility limitation. Root will pin final diagrams to the first committed implementation before PR freeze.
