# Plan for the restart allocator and the accept clock

Task declaration: `server2/config/tasks/KMA-RESTART-ALLOC.json`. Stacked on #2907 (`feat/2614-kma-restart-cpu`). Design: section 11 of `reports/sdlc/issue-2614-kma-restart-reexam/design.md` (not tracked); this is its PR-A.

1. mimalloc as the global allocator, with the heap-region test (commit 002be6ce).
2. The observed KMA waits counted from the HTTP accept, with the paused-clock gateway test (commit 9dc007ba).
3. EC2 A/B against #2907 (done 2026-11-10; local evidence `reports/kma-ec2-20261110a/`).
4. Intent, spec, plan, `docs/architecture/server2.md` notes on the allocator and the accept clock, the wait statement of `docs/architecture/server2-kma-data-design.md`, and the declaration's outside paths.
5. PR #2921 is reviewed as a real PR and passes CI. AK decides on the merge. PR-Z (the forecast-zone newest list) is stacked on it; PR-V and C follow.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user after a deployment | First answer within the bound | Restart on a populated bucket, t3.small | Open the weather | Answered about 2.6 s after the accept, no 501 in the A/B | A stored read that fails is still a 501 (decision 3); PR-Z removes the zone history read | ALLOCATOR, ACCEPT-CLOCK, MEASURED |
| App user with a slow geocode | The waits do not grow with the geocode | Geocode before the dispatch takes 300 ms | Open the weather | The waits end 2.5 s after the accept, not 2.8 s | A direct caller keeps its bound from the call | ACCEPT-CLOCK |
| Operator | Memory headroom on 2 GiB | t3.small | Restart and serve | Peak RSS about 300 MB in the first minute (+110 MB) | Checked over a longer window in C | MEASURED |
| Reviewer | Placement and documents | PR diff | Run the gates | Pass | An undeclared path fails | PLACEMENT |
