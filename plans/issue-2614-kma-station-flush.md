# Plan for the station product after a fill and the early fold

Task declaration: `server2/config/tasks/KMA-STATION-FLUSH.json`. Follows PR-A of the restart re-examination (#2921, the allocator and the accept clock) and its diagnosis of restart b1 (2026-11-10). Section 12 (PR-V) of the re-examination design, with the recommendations of design review 5, is the contract.

1. Tests first, with Red recorded on the unchanged code: the end-of-fill product (no fold in between, and a running worker), the ten-minute gate and its one-time bypass (unit), and the early fold with held minute pages and with a held older-day product. Characterization tests for the residual lag and for two processes' products in reverse order.
2. V1: the fill pass records the days it held new pages for. At its end it hands them to the single product worker, which lets each changed day pass the ten-minute gate once. A running worker compares again before it ends, and a worker that ended as the flush arrived is followed by another. `hourly_page` reports whether it held a page.
3. V2: the restart read lists, compares and folds today's and yesterday's pages beside the older days' catalog and product reads (which keep the remaining lookups). The fold waits only for a fold already running. The minute pages follow both, and the load stays in flight until it ends (S16).
4. Update the architecture document: product writes, restart read order, and the residual lag with its costs.
5. Local commits with fmt, clippy, the artifact policy and the placement gate. A PR, CI, cross-provider review and the EC2 acceptance (C) are separate steps; AK decides on the merge.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user after a deployment | `rn1` of today and yesterday on the first answer | The previous process's fill acquired hours after it stored the day's product | Request weather from the new process | The day's product holds the filled pages; nothing restored page by page | The previous process stopped before its fill ended: the pages are restored once, then the day's product is stored | FLUSH, RESIDUAL |
| App user after a deployment | Hourly rows before slow parts of the read | The minute pages or an older day's product read slowly | Request weather from the new process | Today's and yesterday's rows in the first answer; the rest follows | Today's own comparison is slow: as before, the rows come with a later fold | EARLY-FOLD |
| Summary recorder | Record only complete days | A restart read in progress | Answers during the read | Not complete until the read ends | A day partial (an excluded group): stays partial | S16 |
| Operator | Two hosts store products of one day | Different pages in each, stored in reverse order | A third process starts | It reads the newest product, restores the other pages from the catalogs and answers as a cold read | None beyond the restores counted | FLUSH |
| Reviewer | Placement and policy | Commits | Run the gates | Pass | An undeclared path fails | PLACEMENT |
