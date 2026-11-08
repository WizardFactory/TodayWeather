# Plan for the first parity fixes

Task declaration: `server2/config/tasks/KMA-RESPONSE-PARITY.json`. Based on origin/master. Evidence: EC2 parity run 2026-11-07 and its root-cause research.

1. Current row: exempt it from the primary-mode wipe and merge observed fields over the forecast as legacy does; read or fetch the previous publication when the newest no longer covers the slot.
2. Sentinels: guard the s06 conversion, apply legacy `adjustShort` for pop, write -100 for missing ASOS wind components.
3. Yesterday: add the same-station live-vs-ASOS branch to `can_compare`.
4. Tests per outcome (failing first), full suite, fmt, clippy; documents; draft PR; CI; cross-provider review; re-judge the parity pairs' failure classes with the tool where reproducible. AK decides on the merge.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user | See the chance of rain and snow for the current hour | A publication covering the hour | Open the weather | pop/s06 of the current row as in production, never -1% or -10 | Publication fetch fails: pop 0 as legacy | CURRENT-ROW, SENTINELS |
| App user | Compare with yesterday | Live station observation now; ASOS of the same station yesterday | Open the weather | "than yesterday" shown with yesterday's temperature | Different stations: withheld | YESTERDAY |
| Reviewer | Changes stay in server2 and declared docs | PR diff | Placement gate and artifact check | Pass | Undeclared path: fix before review | PLACEMENT |
