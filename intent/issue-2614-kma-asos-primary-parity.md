# KMA answer parity under ASOS-primary (second part)

AK defined client validation on 2026-11-07 (all data the client gets today, except slow-provider parts) and said legacy omission rules are last-resort safeguards. The EC2 parity run (2026-11-07, server2 master on an empty bucket against the production API) left two groups of gaps after the first part (#2899), both from the ASOS-primary history contract (`docs/reference/external-apis/kma.md`, ASOS-primary merge): past 3-hour rows lose their forecast values, and ASOS-filled hours keep an unknown precipitation type or amount. On 2026-11-08 AK chose the recommended options ("권고대로"):

1. **Past forecast values:** a past row keeps the values of the stored forecast publications that covered it (`pop`, `wav`, and the other fields that observations do not supply, as legacy keeps them); without a stored publication (empty S3, a cell's first request) it sends what legacy sends for a missing past forecast (`pop` 0 via `adjustShort`). Older publications are not fetched for this.
2. **ASOS precipitation:** the wet-bulb rain rule (`wet-bulb-rain-v1`, rain at a wet-bulb temperature of at least 5 °C) applies in every month, not only April to October; hours of the last 23 h whose precipitation is still unknown are filled from the grid nowcast (`getUltraSrtNcst`, the source production uses), one owned acquisition per cell and hour. Winter off-mark blank hours stay unknown (option B was not chosen).

## Outcomes

- **PAST-FORECAST:** past rows keep the stored publications' non-observed values; observed values still come from ASOS where ASOS supplies them; without a stored publication the row sends legacy's missing-forecast values, never -1 for `pop`.
- **WET-BULB:** uncoded ASOS precipitation at a wet-bulb temperature of at least 5 °C is typed as rain in every month; below that it stays unknown.
- **NOWCAST-FILL:** for hours of the last 23 h whose precipitation (PTY, RN1) is still unknown after the ASOS rules, the cell's grid nowcast for that hour is read from S3 or acquired (owned, single-flight per cell and base time, stored as raw records, legacy timeouts); the first answer uses what is ready by the request bound and later answers the rest.
- **DAILY:** the half-day fields and daily summaries of past days follow from the filled hours (no `wfAm`/`wfPm` reduced to a prefix when the hours are known).
- **DOCUMENTS:** the ASOS-primary contract in `docs/reference/external-apis/kma.md`, the history contract `server2/config/contracts/kma-history.v1.json` and `docs/architecture/server2.md` state the new rules.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Budget

Nowcast fill: at most one `getUltraSrtNcst` call per unknown hour of the last 23 h per cell, normally a few per new cell and none for cells whose hours are known or stored (data.go.kr 10,000 per key per day).

## Exclusions

No fetch of older forecast publications for past rows; winter off-mark blank hours are not read as dry; no deployment or production change. Stacked on #2899.
