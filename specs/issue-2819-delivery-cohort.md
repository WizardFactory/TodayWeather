# Admitted delivery cohort behavior

## Acceptance

- AC1: A finite due recipient list selected by the existing scheduled cycle and durably claimed is eligible to complete beyond its first UTC minute. Test more than concurrency6 and a conditional alert after the minute boundary; no extra POST for any member and no added member or replay after restore. Select and document lateness before implementation.
- AC2: On a definite no-POST conditional-alert result after state mutation, this attempt must not leave a six-hour suppression or consume the unsent selected transition. Preserve concurrent user/token edits and newer engine state; restore missing values as missing. Later fresh scheduled evaluation may send once. Keep prior claims; actual Accepted/Rejected/Unknown results keep existing durable one-shot semantics and never auto-retry. Cancellation/panic with uncertain external progress is not a no-POST receipt.
- AC3: Keep selection checks, configured alert window, initial scheduler stale-tick rejection, provider payload/clock behavior and shutdown-before-POST guard. No blanket timestamp clearing, whole-document rewind, failed/unknown send retry, new scheduler, schema or verification mode. Writer ambiguity/unavailability remains fail-closed and explicitly bounded.
- AC4: All changed paths match DeliveryCohort2819 declaration and no runtime legacy dependency is added. Meaningful pre-fix symptom checks, scoped Green/regressions, an additional actual isolated loopback functional scenario, retained source/executable evidence, maintained docs/checked diagram and required independent review/current CI precede pre-merge completion. Global #2819/#2704/#2705/shadow and production remain open.

## Design gate

Finite-cohort lateness is implemented in child PR2826 at e97a5090 (independently reviewed, separate CI gate). Parent C2 compensation interface selection and mapped user scenarios still precede parent runtime edits. Child source/review/evidence are not a parent compensation PASS. Existing known wholeDOM capacity failure is not this slice's result; retain source-bound historical context without weakening assertions.


## Ownership obligations for C2 implementation

A committed receipt is issued by the single writer, not inferred from a bool timeout or caller values. It owns only the selected sending channels' changed derived leaves and exact stored presence. Observation-only updates stay committed. Construct message/canonical afterimage before selected-send commit. On typed definite noPOST, one ordinary bounded writer transaction may restore only still-owned leaves, preserving configuration/token/nonselected observations and newer actual derived-state transitions. Sticky invalidation across every intermediate applied entry must reject A-to-B-to-A, deletion/recreation and incompatible parent replacement. No full-document rewind, released claim, externalfailed/unknown retry, background repair timer or persisted schema change.

A same-value no-op filtered by Txn::changes is not a new persisted transition; no write-intent ownership is claimed. Lost initialack, unresolved writer/storage progress or unavailable compensation remains explicitly uncertain/fail-closed, with no successfulrestore or retryability claim. Cancellation/panic is not a typed noPOST receipt. ParentAC2 is not complete until these cases are exercised and independently reviewed. Child lateness does not erase this requirement.
