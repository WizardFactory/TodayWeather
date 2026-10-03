# #2648 current-grid quota regression evidence

Verified 2026-10-03 on the resumed correction candidate before commit. Synthetic provider data only; no deployment, provider call or production write.

- Intended Red: Manager fetched an already complete publication again; both daily-exhausted keys were called again on the next cycle. Regressions failed before the corresponding fixes. Additional Red cases covered per-second classification, stalled DB reads and delayed prior-day rejection.
- Green and post-refactor: pinned Mongoose 5.1.2 query construction; DB 1.0/2.0 coverage; valid zero/negative values; missing/invalid fields; same-hour joins; different-hour exclusion; read errors/deadlines; failed persistence; current daily cooldown; other-product independence; continuation-page accounting; KST rollover.
- Full offline suite: Node 22.22.2, exit 0. Includes prior gather policy/quota and client/gateway regressions.
- Functional HTTP/Mongo smoke: Node 16.20.2 and 22.22.2; actual gather route, Manager, collector and DB writers, synthetic loopback provider and temporary Mongo. Each format persisted 2,032 grids across two hours. Same-hour overlap joined; later repeated polls made no HTTP calls. DB 2.0 partial-row repair fetched exactly one grid. DB 1.0 had 4,064 total HTTP attempts; DB 2.0 had 4,065.
- Mongo 7 smoke uses isolated Mongoose 5.13.23 driver. Production remains pinned at 5.1.2, tested separately for query construction. The smoke does not prove live Mongo/provider compatibility.
- Archify source/HTML passed artifact and browser checks; light/dark rendered flow visually inspected. Source is a scoped design diagram, not deployed-state evidence.

For one successful collector and 2,032 fixture grids, repeated current first passes fall from 292,608 to 48,768/day (83.3%). Pages, failures, retries, other products and processes remain additional traffic. Actual approved entitlement remains unverified. Production daily/hourly recovery and the issue’s broader historical-coverage acceptance require separately approved rollout/readback.

Reproduction commands and dependency caveats: [offline README](../../../../server/test/offline/README.md#current-grid-collection-2648). Behavior and rollout: [operations](../../../operations/current-grid-collection.md).

Independent PR review required two corrections: R3-001 mixed daily cooldown plus per-cycle key rejection could reselect the remaining rejected key; R3-002 structured receipts omitted separate failed/rejected counts. Both were reproduced with failing regressions, corrected and tested; see PR #2670 for final re-review disposition.

## Resumed lifecycle correction — 2026-10-03

AK reopened2648 after original-criterion reassessment. A partial stored wind/REH
observation is intentionally pending under the eight-field contract; the prior
refetch-only finding needs reviewer reassessment, not relaxed completeness.
The real defect reproduced before correction was an indefinitely retained active
guard: two joined timeout callbacks remained uncalled. The corrective lifecycle
adds a nine-minute current-only deadline, real HTTP abort, delayed-retry cancellation,
save admission checks and stale callback/own-run fencing. Issued Mongo operations
may settle once at their original identity; no database transport cancellation.
Follow-up review found late DB1/DB2 writer reads could admit a new save after the
run deadline. The current control now reaches both real writer callbacks; a new
regression delays those reads past cancellation and confirms zero writes for either
format. The full Node22 offline suite and Node16/22 temporary-Mongo and loopback
cancellation smokes passed after this correction.
Current master integration preserves MFDS and unified data.go.kr key handling.
No new provider call, production readback, merge
or deployment. Actual quota approval/onset and original hourly/daily recovery stay
unfinished;2648must remain open.
