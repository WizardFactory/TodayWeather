# Plan for the restart reads

Task declaration: `server2/config/tasks/KMA-RESTART-READS.json`. Follows `plans/issue-2614-kma-optional-arms.md`.

1. `BoundedS3`: a lane semaphore shared by every clone (`limit / 3`, at least one); `bulk()` returns a view that takes a lane permit before the shared permit; every S3 operation goes through one admission helper.
2. `gateway::runtime::warning_store` and `warning_feed`: build the process warning store and the persisted warning feed on the bulk view; both wirings (`runtime_services`, `gateway::runtime`) use them.
3. Tests: the lane bound and the admitted request read; the wiring of the warning store and feed.
4. Update the architecture document (S3 admission and the shared WarningStore).
5. Draft PR, CI, EC2 restart comparison, cross-provider review. AK decides on the merge.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user after a deployment | A valid first answer | Stored bucket with warnings; process restarted | Open the weather | A body that passes the client validation within the bound | Observations, past days or warnings not ready: they come on a later request | LANE, WARNINGS, RESTART |
| Operator | Warning work keeps going | Warning acquisition running | Requests arrive | Requests admitted; warnings finish later | Admission closed: Capacity error as before | LANE |
| Reviewer | Placement and policy | Commits | Run the gates | Pass | Undeclared path fails | PLACEMENT |
