# Plan for forecast zones from the newest stored list

Task declaration: `server2/config/tasks/KMA-ZONE-NEWEST.json`. Stacked on PR-A (#2921, `plans/issue-2614-kma-restart-alloc.md`). Design: section 11 of `reports/sdlc/issue-2614-kma-restart-reexam/design.md` (not tracked).

1. Tests first, against the fold: the selector cases, the GET counts, the memory and 24-hour cases and the oracle at answer level. The fold failed the incomplete newest day (a read error), the GET counts (1 LIST, 11 catalogs, 53 descriptors, 53 pages), the newest-list documents and the freshness and install cases.
2. `Reader::listed_groups`: every group of a catalog with its completion and its members' raw hashes in page order, from the control object alone; `Reader::listed_acquisitions` keeps its answer on top of it.
3. The selector (anchor day and its previous day, one restored group per try, identity recheck), the zone memory (zones, identity, check time; installs only when newer), the 10-minute check, and the owned acquisition when the newest list is more than 24 h old or none is stored. The fold, the daily refold and the per-process gate go.
4. Documents: `docs/architecture/server2.md`, the KMA data design and the D1 verification note.
5. Draft PR, CI and cross-provider review; AK decides on the merge. PR-V and the EC2 acceptance (C) follow.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user after a deployment | First answer without a 501 from the zone read | Restart on a bucket with many identical lists | Open the weather | One LIST, three catalogs, one group read; the mid temperature region found | A corrupt newest list is still a read error (decision 3) | SELECT, COST |
| App user | Same answers as legacy | Any stored lists | Ask for a town's zone | Legacy's `regId`s and count | No list stored: land zones (observed) | ORACLE, FALLBACK |
| Operator | No identical list per restart | Newest list under 24 h old | Restart | No acquisition | Older than 24 h or none: one owned acquisition, retried after 5 minutes on failure | FRESH |
| Operator | A long-running process keeps its list current | Process up for days | Serve requests | Acquired again 24 h after the last list | Acquisition fails: memory keeps the last good list | FRESH, INSTALL |
| Reviewer | Concurrent results stay ordered | A late acquisition and a newer stored list | Check and install | The newer list stays | Same list found again: check time moves | INSTALL, ORDER |
| Reviewer | Placement and policy | PR diff | Run the gates | Pass | An undeclared path fails | PLACEMENT |
