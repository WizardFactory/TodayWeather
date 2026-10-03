# #2648 current-grid quota regression evidence

Verified 2026-10-03 before commit, based on 1bc5669c. Synthetic provider data only; no deployment, provider call or production write.

- Intended Red: Manager fetched an already complete publication again; both daily-exhausted keys were called again on the next cycle. Regressions failed before the corresponding fixes. Additional Red cases covered per-second classification, stalled DB reads and delayed prior-day rejection.
- Green and post-refactor: pinned Mongoose 5.1.2 query construction; DB 1.0/2.0 coverage; valid zero/negative values; missing/invalid fields; same-hour joins; different-hour exclusion; read errors/deadlines; failed persistence; current daily cooldown; other-product independence; continuation-page accounting; KST rollover.
- Full offline suite: Node 22.22.2, exit 0. Includes prior gather policy/quota and client/gateway regressions.
- Functional HTTP/Mongo smoke: Node 16.20.2 and 22.22.2; actual gather route, Manager, collector and DB writers, synthetic loopback provider and temporary Mongo. Each format persisted 2,032 grids across two hours. Same-hour overlap joined; later repeated polls made no HTTP calls. DB 2.0 partial-row repair fetched exactly one grid. DB 1.0 had 4,064 total HTTP attempts; DB 2.0 had 4,065.
- Mongo 7 smoke uses isolated Mongoose 5.13.23 driver. Production remains pinned at 5.1.2, tested separately for query construction. The smoke does not prove live Mongo/provider compatibility.
- Archify source/HTML passed artifact and browser checks; light/dark rendered flow visually inspected. Source is a scoped design diagram, not deployed-state evidence.

For one successful collector and 2,032 fixture grids, repeated current first passes fall from 292,608 to 48,768/day (83.3%). Pages, failures, retries, other products and processes remain additional traffic. Actual approved entitlement remains unverified. Production daily/hourly recovery and the issue’s broader historical-coverage acceptance require separately approved rollout/readback.

Reproduction commands and dependency caveats: [offline README](../../../../server/test/offline/README.md#current-grid-collection-2648). Behavior and rollout: [operations](../../../operations/current-grid-collection.md).
