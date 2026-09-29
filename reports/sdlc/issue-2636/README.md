# Issue 2636 evidence

- [Intent](../../../intent/issue-2636.md), [specification](../../../specs/issue-2636.md), [plan](../../../plans/issue-2636.md), [user amendments](amendments.md).
- [Investigation](investigation.md), [build](build.md), [test plan](test-plan.md), [self verification](self-verification.md), [test results](test-results.json), [candidate source hashes](candidate.json).
- [Operations, pending acceptance and rollback](operations.md). Operating key expiry is user-confirmed; renewal/entitlement, deployment, scheduled readback and physical iOS/Android checks remain separate.
- [Collection diagram](../../../docs/architecture/diagrams/weather-collection.html), [nation recovery design](../../../docs/architecture/diagrams/nation-air-recovery.html), [visual assessment](diagram-visual.md).

The task endpoint is pre-merge. Local state accounting and full browser sidecars are retained in the task workspace; exact-head CI/review/readiness receipts belong to the PR record. No merge, auto-merge, merge queue or production action is authorized.
