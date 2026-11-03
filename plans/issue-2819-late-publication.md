# #2819 B3 execution plan

Owner: coordinating OpenAI /root. Canonical execution notebook remains the root `.planning/2026-10-13-server2-next-sequence-after-s10/`; this document is the task plan, not a competing notebook.

1. Intake and inspect the existing publication/owned-flight/backfill contract. Declare paths before edits.
2. Settle a bounded interface/ownership design and verify an illustrative Archify source/HTML. Reject a global three-claim limit and timer/pre-collection.
3. Test-first latest-short windows, sparse/cold demand, concurrent callers/cancel, new base and unaffected historical/non-short behavior.
4. Implement the smallest selected design and run relevant regressions plus a separate local functional scenario with owned dependencies. Retain any unchanged baseline failures honestly.
5. Check docs/placement/artifacts, commit/push a PR stacked on B2, obtain native independent review and exact-head CI. End pre-merge without integration or production action.

## User scenarios

| User and goal | Prerequisites and ordered actions | Expected result and failure boundary | Criteria |
| --- | --- | --- | --- |
| Weather caller needs a late short forecast | Synthetic cell, empty latest, NotPublished peer; request each minute for one three-hour base | Only HH12/15/20 latest acquisitions, then stop; never new timer/precollection | AC1/2 |
| First cold caller arrives late | No prior demand; first request after final window, repeat before next base | One latest attempt and no catch-up burst; original request deadline retained | AC2 |
| Several callers share collection | Same latest cell, provider operation pending; overlap and cancel one waiter | One owned acquisition, surviving waiter/owner unaffected; usable saved data suppresses recollection | AC2/3 |
| Caller needs history after a new base | Missing older publication plus new latest; issue request | Latest window cap resets for new base; existing historical backfill and non-short policies remain | AC3 |
| Reviewer assesses the bounded fix | Inspect Red/Green/source/binary binding, real owned smoke, declaration/docs/diagram and current CI | No manufactured Red, baseline failures remain visible, no full readiness/merge claim | AC4 |
