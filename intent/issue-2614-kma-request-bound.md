# One bound for a KMA request

AK requires that a client request waits at most 3 s, answers from what was gathered by then and omits what is late. On 2026-11-05 the first real measurement (EC2, real providers and S3) showed the first request of a process taking 4.2 to 5.8 s, with or without stored data. A warning cycle and the AirKorea forecast images held it: both publish to S3 before anything waiting on them finishes, each wait had its own 3 s, and the waits added up.

## Outcomes

- **BOUND:** the observed response stops waiting for everything it started 2.5 s after the request reached the handler, air and life by 2.7 s and the narrative by 2.9 s.
- **WARNINGS:** the warning zone state reaches requests once fetched, before the collector's publications, as AK asked for weather data. A later cycle does not hold a request that already has a current state.
- **IMAGES:** a request does not wait for an image acquisition that takes longer than a request may wait. It continues and a later request reads the result.
- **SHORTEST:** a missing ultra-short forecast no longer leaves the rest of the response in its internal shape.
- **TOWNS:** the geocoder's new names for Gangwon and Jeonbuk find their listed towns and mid forecast, and a town outside the list gets its forecast within the bound. EC2 showed Gangneung at 6.6 to 8.0 s with no mid forecast on any response.
- **MEASURED:** the first request of a process is measured again on EC2 against the same scenarios.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Decisions for AK

Each changes what a first response carries, so this change is not merged without AK:

- The 2.5 s wait replaces the 8 s budget for everything the observed response waits on. Stored reads keep the longer budget, so a slow S3 can still delay an answer past 3 s instead of failing it. The town geocoder runs before the handler and keeps its own 3 s cap.
- A first response no longer waits for forecast images. In the measurement they took 3 s or more, so they were late anyway.
- The guard differs from legacy's failure path, where the exception skipped the remaining conversions.
- `regionName` in those two provinces becomes the listed name, `강원도` or `전라북도`, while `address` and `name` keep the geocoder's. Legacy's exact lookups miss the new names, and the production Lambda is outside this repository, so what production does there was not checked.

## Exclusions

Not in this change: a packaged AirKorea station list, the warm 5-minute warning refresh beyond what the offer already covers, and the collector's restart probing (KMA-SR-06 of #2862).
