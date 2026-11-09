# Plan for the restart CPU work

Task declaration: `server2/config/tasks/KMA-RESTART-CPU.json`. Stacked on #2900. Design note: `reports/sdlc/issue-2614-kma-restart-race/p1-design-note.md` (options 1 and 2 first, 3 if needed).

1. Async DNS resolution for the HTTP clients (reqwest hickory-dns or equivalent), musl release build checked.
2. Disk cache on a dedicated thread with a bounded queue; drop writes when busy; keep the cross-process lock.
3. Tests for both; full suite, fmt, clippy; documents; draft PR; CI; cross-provider review.
4. EC2 restart comparison with the CI binary; if needed, a restore CPU admission as a further commit, measured again. AK decides on the merge.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user after a deployment | Complete first answer within the bound | Restart with a stored bucket | Open the weather | Current observation and today's UV in the first answer, about 3 s | Still CPU bound: restore admission next | MEASURE |
| Operator | No DNS or cache stalls | Busy restart | Requests | No 0.5 s stalls of unrelated operations | Cache thread busy: write dropped, read from S3 later | DNS, DISK-CACHE |
| Reviewer | Placement and docs | PR diff | Gates | Pass | Undeclared path | PLACEMENT, DOCUMENTS |
