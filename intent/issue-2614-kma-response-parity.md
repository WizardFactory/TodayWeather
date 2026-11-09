# KMA answer parity with what the client gets today (first part)

AK defined client validation on 2026-11-07: a server2 answer gives the client all the data the client receives today, except parts left out because their provider is slow. AK also said that legacy omission rules are last-resort safeguards: `current.yesterday.t1h` must be sent, and a value is withheld only when no comparable value can be obtained. An EC2 parity run on 2026-11-07 compared server2 master (starting on an empty bucket) with the production API, same paths and times, five places, every ten minutes for an hour. Judged with `kma_client_validation.py` (PR #2879), every pair missed data. The research of the run (`reports/client-validation-research/parity-rootcause/findings.md`, ignored) separates defects that do not depend on what S3 holds from those that follow the ASOS-primary history contract and wait for AK's decisions.

This task fixes the first group.

## Outcomes

- **CURRENT-ROW:** the 3-hour row of the current time keeps the forecast fields of the newest publication that covers it (`pop`, `wav`, `s06`, `r06` and the rest legacy keeps), with observed fields merged over them as legacy `_mergeShortWithCurrent` does; it is never wiped as a past row. When the newest publication no longer covers the current slot (HH+2:10 to HH+2:59), the previous publication is read or fetched (at most one call per cell per three hours).
- **SENTINELS:** a missing `s06` stays a missing value through the cm-to-mm conversion (never -10). A missing `pop` reaches the client as legacy sends it (`adjustShort`: 0, never "-1%"). Wind components filled from ASOS carry legacy's missing value -100, not -1.
- **YESTERDAY:** `current.yesterday.t1h` is sent when the current temperature is the live observation of station X and the yesterday row is station X's ASOS hour exactly 24 h earlier (same thermometer); the comparison safeguard still withholds it for different stations or hours. A stored grid row for yesterday keeps taking precedence as today.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Evidence

- Parity pairs and analysis: `reports/kma-ec2-20261107p/results/parity/`, `parity-analysis-2.{txt,json}` (ignored).
- Current row: `server2/src/domestic/kma/short.rs:1407-1443` wipes rows with slot <= now under primary mode; legacy `server/controllers/controllerTown.js:4786-4877` copies only observed keys; `controllerTown24h.js:111-115` turns a missing `pop` into 0.
- s06 -10: `present.rs:561-565` multiplies without a sentinel guard.
- Yesterday: `policy.rs:651-669` (`can_compare`) has no live-vs-ASOS same-station branch; in all 35 pairs the two temperatures came from the same station 24 h apart.

## Exclusions (waiting for AK)

Past-slot forecast values (`pop`, `wav`) removed by the ASOS-primary contract, the ASOS precipitation rules for winter and stations without weather codes, provider fetches of older grid nowcasts or publications, and the daily summaries that depend on them. No deployment or production change.
