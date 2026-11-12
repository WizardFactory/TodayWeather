# Plan for ASOS-primary parity (second part)

Task declaration: `server2/config/tasks/KMA-ASOS-PRIMARY-PARITY.json`. Stacked on #2899 (`feat/2614-kma-response-parity`). Evidence: `reports/client-validation-research/parity-rootcause/findings.md` (Q2-Q4), EC2 parity run 2026-11-07.

1. Past rows keep stored forecast values under ASOS-primary (limit the wipe to fields ASOS supplies), legacy missing-forecast values otherwise.
2. Wet-bulb rain rule in every month.
3. Nowcast fill for unknown hours within 23 h: required publications, owned acquisition, stored reads, quota owner.
4. Daily summaries from the filled hours.
5. Tests per outcome (failing first), paired replays unchanged, full suite, fmt, clippy; documents and history contract; draft PR; CI; cross-provider review; an EC2 parity re-run against production judged with the client validation tool. AK decides on the merge.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user | See past hours' chance of rain as before | Stored publications for the cell | Open the weather | Past pop/wav as production | No stored publication: pop 0 as legacy | PAST-FORECAST |
| App user | See rain in past hours | ASOS amount without a weather code | Open the weather | Rain shown when wet-bulb >= 5 °C | Below 5 °C: unknown, nowcast fill within 23 h | WET-BULB, NOWCAST-FILL |
| App user | Past days' AM/PM weather | Filled hours | Open the weather | AM/PM text and type | Unknown hours: half-day withheld as before | DAILY |
| Reviewer | Placement and docs | PR diff | Gates | Pass | Undeclared path | PLACEMENT, DOCUMENTS |
