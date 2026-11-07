# Plan for the restart race

Task declaration: `server2/config/tasks/KMA-RESTART-RACE.json`. Stacks on PR #2872 (`feat/2614-kma-restart-observe`), which stacks on PR #2866. Design draft: `reports/sdlc/issue-2614-kma-restart-race/design-draft.md` (ignored), summarized in the intent.

1. Add the head-start helper and compute `race_at` beside `until` in the observed source; the legacy source keeps `race_at = until`.
2. Station pages: wait for the load only until `race_at`, then join it with the owned page acquisitions; fill absent hours of today and yesterday.
3. ASOS: prefetch history alongside the stations with the default station list; start the run at `race_at`; load hourly and daily kinds concurrently.
4. Life: restore the answer's slots first; start flights at `race_at`.
5. Narrative: start the read with the request as owned work; one fetch per office when absent at `race_at`.
6. Warnings: read the zone state alongside the warning cycle on the request lane.
7. Bulk lane for reads no request waits for.
8. Tests for each outcome with the existing doubles; full suite, fmt, clippy.
9. Documents and the data design diagram; draft PR; CI; cross-provider review; EC2 restart measurement judged with the client validation tool. AK decides on the merge.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user after a deployment | The first answer has everything the app shows | A bucket written by the previous process; S3 slow after the restart | Open the weather | Current observations, yesterday values, past days, today's UV and the narrative within 3 s | Provider also late: that part on the next request | RACE, NEEDED-FIRST, NARRATIVE |
| Operator | No extra provider calls when S3 is fast | Prompt S3 | Restart and request | Same answer as before the restart; no added provider calls | n/a | FAST |
| Operator | Bounded provider use | Bucket with 8 days | Restart | Only absent hours of today and yesterday fetched; ASOS one range pair per station | Restore later than the race: a second stored copy | FILL, ASOS |
| Operator | Background work does not hold answers | Warning replay and product writes running | Requests arrive | Request reads admitted on the request lane | Bulk lane full: background waits | LANES |
| Reviewer | Changes stay in server2 and declared docs | PR diff | Placement gate and artifact check | Pass | Undeclared path: fix before review | PLACEMENT, DOCUMENTS |
