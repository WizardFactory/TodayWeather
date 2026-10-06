# Plan: document and later implement server2

Source: [intent](../intent/issue-2614.md), [spec](../specs/issue-2614.md).
Current endpoint: documentation PR, no merge/deployment or runtime implementation.

## This PR

1. Read #2614 and its amendments, inspect current source entrypoints, and reconcile
   the accepted [traffic baseline](../docs/evidence/aws/api-traffic-2026-09-22.md).
2. Maintain `docs/architecture/server2.md`, its Archify JSON/HTML and index link;
   retain intent/spec/plan and selected verification evidence.
3. Check source claims, route counts, arithmetic, links and diagram artifact,
   browser and visuals separately. Run staged and outgoing artifact-policy checks.
4. Commit/push this branch, create PR linked to #2614, obtain independent review,
   resolve selected findings and report the actual PR/CI state. No merge action.

Generated stage receipts, notebook, screenshots and browser receipts remain in
ignored reports/.planning/.archify; maintained evidence links only to tracked
inputs. No client/server/runtime/CI/configuration changes are planned.

## Later implementation phases

Each route port depends on P1 and recorded issue decisions; one PR per phase.

| Phase | Scope and proof |
| --- | --- |
| P0 | Record remaining issue choices; keys/IAM/bucket/versioning/lifecycle, actual runtime/Spot prerequisites and rollback ownership. No persistent gp3 requirement. Use accepted traffic report; supplement only its scope gaps/new paths before their cutover. |
| P1 | Golden harness for the 19 observed groups and retained internal dependencies; current deployment/source/client contract reconciliation, error/CORS/cache/304/preflight fixtures, #2609/#2620 and acquired-history cases. Freeze clock and raw input; two runs byte-identical. |
| P2 | Rust storage/resolver, synchronous publication, memory/single-flight limits; property/crash tests with recorded providers and local S3-compatible peer. Measure actual host build compatibility, S3 tails/throughput, RSS/CPU and cold request fan-out. Raw packs are a measured optional optimization. |
| P2b | Gateway/geocoder with backend switches to legacy, exact validation/errors/cache/deadline and privacy-safe coordinate handling. Whole-gateway shadow and rollback rehearsal. |
| P3/P4 | World providers used by gateway and warning catalogs/restore; no deletion of a backend solely due to unused direct public paths. |
| P5/P6 | Domestic raw JSON, legacy-history export, summaries and v000903 assembly; close O-1/O-11 acquisition gaps and Rust time-box. Active health/air behavior follows current fixtures. |
| P7 | Used older versions, nation and town, including v000705 town; exclude only supported zero-observed public paths. |
| P8 | Used push/state and applicable notice supplement; durable acceptance, send ownership, duplicate window and reversible migration. Do not revive retired purchases. |
| P9 | Retire legacy/Mongo only after every included family and scope gap is dispositioned, parity/shadow/performance/quota gates pass and AK approves cutover. |
| Later scale-out | Independent per-host caches, shared S3, durable global provider admission, fetch/background ownership, concurrent catalog CAS, readiness/drain and bounded S3 warm-up. No shared-cache implementation now. |

## Scenarios and acceptance mapping

| ID / user and goal | Prerequisites and ordered actions | Expected result / failure | AC and future proof |
| --- | --- | --- | --- |
| S1 / app user refreshes domestic weather | Published S3 fixtures, empty memory, providers disabled; GET an included address weather path, then repeat | Cold output equals legacy frozen-input bytes; warm output unchanged; missing history must not produce invented fields | AC1/2; golden + cold/warm smoke |
| S2 / coordinate user receives correct label | Exact coordinate geocoding cache empty; invoke weather/geocode with recorded provider reply | Same label and bytes as legacy; no precise-geocode object/catalog/pack/log persisted; provider failure preserves route error/fallback | AC1/2; privacy/schema and gateway fixtures |
| S3 / old client updates push/town/nation | 19-route fixture matrix, including failed-only and OPTIONS groups; replay each method/version | Existing validation, body/status, authentication, CORS and 304 preserved; zero-observed exclusions do not remove used internal functions | AC2; inventory reconciliation and golden harness |
| S4 / client survives replacement | PUT raw, interrupt before/after catalog publication, start empty process and request | Published revisions rebuild identical field merge; partial pages never complete; missing index repairs or fails safely, no blind provider quota spend | AC1/2; kill/fault/property smoke |
| S5 / concurrent/cancelled callers | Several same-key cold requests; cancel initiator during S3 acquisition | Remaining callers share operation; bounded owner completes publication; no unbounded CPU/I/O or lost acknowledged record | AC1; single-flight and shutdown tests |
| S6 / client uses historical pack | Build pack from durable fixtures, introduce late revision, corrupt/delete serving pack in test peer | Late fields retained; verified canonical fallback yields same bytes; pack-before-index crash harmless | AC1/2; pack hash/range/fallback smoke |
| S7 / operator checks outage and warning history | Valid memory, S3 outage; then empty memory; providers disabled with old type 2/3 and type 4 fixtures | Memory within TTL works; new undurable success rejected according to decided contract; warnings equal legacy at +10h/+19h | AC1/2; failure matrix/golden |
| S8 / reviewer assesses speed and future scale-out | Fixed fixture workload; clear caches; measure 8/16/32/64 concurrency and mixed requests | Report full p50/p95/p99, bytes/RSS/CPU/provider time; no arithmetic estimate relabeled as p95; future coordination remains a prerequisite | AC3; P2 benchmark and later scale-out fault tests |

## Risks, rollback and proof

Riskiest changes are raw/catalog publication after interruption, incomplete
history acquisition, volatile precise geocoding, and output parity after merging
revisions. Raw packs can trade fewer GETs for more bytes/CPU/storage; disabling
packs must fall back to the same canonical raw set. Multi-process API workers
and inter-instance shared caches are rejected initially because they add cache
duplication/IPC/coordination before a measured need.

Keep the legacy process and family switches during coexistence. Document reverse
state migration before P8; switch-back alone does not roll back accepted state
mutations. Preserve CloudFront policy and rehearse rollback with cached responses.
Only per-family AK-approved cutover changes deployment. A design-document revert
has no runtime side effects.

Proof for this PR is recorded in
[selected verification evidence](../docs/evidence/tasks/issue-2614-design/verification.md).
Rust/property/provider/latency/shadow checks above are future requirements, not
tests claimed to have run in the documentation PR.
