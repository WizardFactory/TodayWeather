# The station product after a fill, and today's pages first

On 2026-11-10 the restart re-examination on EC2 (t3.small, PR #2921: #2907 with mimalloc and the accept clock) found one first answer, restart b1, without the station rain (`rn1`) of `short[]`, `dailyData[]` and `current.yesterday`, which the same process answered seconds later. These values come from the KMA AWS hourly pages (`KMA_STATION_HOURLY`, the page's `rs1h`), not from ASOS. The diagnosis of b1 (operation traces of the run, kept with the re-examination's local evidence and not committed) found the cause:

- The previous process, a1, stored the 11-09 station-page product while it held one of that day's hours. Its fill pass then acquired the other 23 hours, and the ten-minute product gate (`PRODUCT_EVERY`, per day and process) kept a1 from storing the day again before it stopped.
- b1 read that product and restored the 23 pages its catalog listed one after another (one member at a time, about 85 ms per page with parsing).
- Pages restored during the restart read were folded only when another part of the request ended, so that fold came after the request's 2.5 s wait.
- b2 to b7 read b1's complete product with one GET and answered `rn1`.

S3 held the pages, so the gap is not an allowed omission (AK, 2026-11-07: only a slow provider's part may be left out). AK approved the design on 2026-11-10 as section 12 of the re-examination (PR-V), with the four recommendations of design review 5 (Codex, APPROVE).

## Outcomes

- **FLUSH:** when a fill pass ends with new pages for a day, that day's product is stored once at the end of the pass. This store passes the ten-minute gate, and it happens only when what the day is made of changed. The single product worker honours this flush: a worker that is already running stores the day before it ends, and the store does not wait for a fold of the filled pages. A day that cannot be stored yet (not read without failure, or before the process's first fold) keeps the flush until it can, and the read that makes it storable has it compared even when that read changed no page. The per-day rules (every hour in the window, read without failure) and the bookkeeping after a store are unchanged. Each fill pass adds at most one product PUT per filled day. When two processes store products of one day with different pages in either order, a restart reads the newest and restores from the day catalogs the pages it lacks.
- **EARLY-FOLD:** a restart read lists, compares and folds today's and yesterday's pages before the older days' catalogs and products and before the minute pages. The first answer therefore carries the hourly rows and their `rn1` without waiting for unrelated parts. The older days and the minute pages follow in the same read. While only an older day's city page names a city station, this order usually costs the restart a full read of today's and yesterday's AWS pages after the first answer, and their products are stored again (see the spec's failure paths).
- **S16:** per-day accounting (known, excluded and unreadable groups), the newest page of each hour, the page identities and the response-first durability set are unchanged. An early fold never makes an answer complete: the load and the rest of the read stay in flight until they end.
- **RESIDUAL:** the fill-end store bounds the product's lag to the pages acquired after the last fill pass or product store; it does not keep every product current. A quick restart after a request-time acquisition, a restart in the middle of a fill pass and a stop before the end of a fill pass each cost the next restart one targeted restore per page the stored product lacks. The tests count two, three and four pages; b1, whose cause this change removes, restored 23. That restart then stores the day's product, so the restart after it restores none (checked for the first and third case).
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Decisions (AK, 2026-11-10)

- PR-V as designed: a store at the end of a fill pass, and an early fold of today and yesterday. The root cause is fixed first.
- Not now: concurrent chunk restores (more S3 permits during a restart). They are revisited only if the EC2 acceptance of the restart work shows that the lag remains.
- No new caches, budgets or background restore machinery.

## Exclusions

Not in this change: the EC2 acceptance (C) of the restart re-examination; the backfill pass of the legacy policy (not used by the observed source), which keeps the ten-minute gate; and a fill pass cut by its owned deadline (600 s) or stopped by a crash, which leaves the residual lag described above.
