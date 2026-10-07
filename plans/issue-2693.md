# S08 provider budget implementation plan

Consumes the [specification](../specs/issue-2693.md) and the frozen root
[admission diagram](../docs/architecture/diagrams/server2-provider-admission.html).
Task #2693 remains an internal primitive; no routes or infrastructure are enabled.

1. Define validated policy, authority, immutable witness and bounded error types in
   `server2/src/budget/`. Port rejection classification into `src/providers/` with provenance.
   Fix executable tests for the ceiling and status/body matrix before filling behavior.
2. Implement a separate budget HTTP transport using the existing coherent credential
   snapshot and signing/client configuration. Four visibility promotions are the only
   changes to existing storage transport. No CatalogStore quota arithmetic.
3. Implement serialized local block ownership, global CAS, write-once witness, private
   request/attempt permits, clock/window fence and deadline-bounded waits. Test competing
   stores and ambiguous/late commits against actual loopback HTTP.
4. Implement a generic funded executor: all candidates funded first, at most two HTTP
   attempts total, typed denial/unknown, kind-specific successful JSON validation. Keep
   S07 trait glue separate until both branches integrate.
5. Run post-refactor checks and a distinct release example against owned synthetic peers.
   Document operations with actual output capture and rendered PDF. Run Rust, placement,
   artifact checks and CI, then request root's actual independent review on an exact head.

## Operator scenarios and acceptance mapping

- S1 (AC1/AC2): cold grant, warm subdivision, provider observation after witness.
- S2 (AC1): two stores compete; durable ranges do not overlap or exceed ceiling.
- S3 (AC1): interrupted/unknown CAS and witness deny HTTP; replacement burns leftovers.
- S4 (AC2): JSON/XML rejection matrix, candidate funding, rotation and deadline/window fence.
- S5 (AC3/AC4): isolated release run, raw-group publication owned by the caller, manual,
  exact path audit and unmerged independent review.

Model tests cover validation, overflow and costs. Wire tests use finite loopback peers
and actual request counters; they do not validate AWS IAM/SigV4 or real latency. Red is
an executed assertion failure on compiled scaffolding, not a missing dependency. Smoke
has a distinct execution ID/log and release binary, not a replay of unit tests.

## Safety, costs and rollback

Ceiling authority advances before witness and HTTP. Issued request units are not refunded;
all pre-funded candidates burn even when unused. Default blocks are 256 units, configurable
only by trusted policy. Replacement discards unused capacity. Cold funding is GET/CAS/witness
(three dependent waves); warm local funds need none. Unknown writes have no provider fallback.
Do not delete/refund reservation state to recover capacity. Operational rollback disables
new acquisition and preserves durable authority; future route fallback follows legacy gates.

Alternative unique-ID reservations alone cannot enforce a global ceiling. Redis/shared
instance caches and server-side multi-object transactions are outside scope. S3 trust,
clock/configuration ownership, real quota/key provisioning and measured headroom are S09
prerequisites. No precision coordinates or secrets belong in budget identities or logs.

Only declared paths may change. Root exclusively reconciles the common architecture and
sequence diagram. S07 owns its resolver API. Preserve existing S05/S06 tests and CI behavior.

QA1 selected S08-R1–R4: compiled Red tests for JSON/XML03 and10/12, quota/auth precedence; real loopback terminal no-data/no retry and duplicate pre-funding rejection; 412 contention separate from exhaustion. Extend release smoke with JSON/XML03,10/12 terminal outcomes and zero raw publication for these bodies. Render PDF inline links/code and inspect all pages. Runtime changes require root committed-source diagram handoff and fresh full CI plus independent release smoke, then actual cross-provider rereview. No live calls or route/S07 glue.
