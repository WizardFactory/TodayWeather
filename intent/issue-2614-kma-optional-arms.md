# Supplementary inputs do not hold a KMA answer

On 2026-11-06 the EC2 measurement of #2864 showed first requests on stored data ending at about 3.0 s for both binaries, 3.01 to 3.05 s at the client in six of ten runs. The forecast, observations and air were in by about 2.2 to 2.5 s. The life arm (the UV index walking earlier slots) waited to its 2.7 s bound, and the narrative read added 0.1 to 0.3 s after the assembly. AK approved option 2 of the report ("2번 진행"): once the required information is in, do not wait further for supplementary information such as the UV index or the forecast narrative.

## Outcomes

- **LIFE:** under the observed source the life inputs (UV, pollen, food poisoning, sunrise and sunset) do not hold the answer once the required inputs are in. The required inputs are the grids, RSS, mid forecast, station observations and history, air, and warnings. The answer takes the life data this process holds; the reads and acquisitions continue and serve later requests.
- **NARRATIVE:** under the observed source the narrative is read beside the snapshot and is in the answer only when that read has ended by the time the answer is assembled; it never holds the answer.
- **LEGACY:** the legacy-path source (`S3Source::new`) keeps joining the life inputs and waiting for the narrative.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Decisions for AK

- Air stays required. The app shows it prominently, and in the measurements it was in before the observations, so waiting for it costs little.
- A first answer may now lack UV, pollen, food poisoning or KASI sunrise and sunset (computed instead, as approved on 2026-11-05) and the narrative, when they are not held yet. Later requests carry them.

## Exclusions

Not in this change: the required inputs' own time (current-observation pages take about 2 s on a cold process), the AirKorea key quota, and an EC2 measurement without AK's go-ahead.
