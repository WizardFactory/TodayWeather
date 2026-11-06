# The nation composition waits as long as legacy did

The EC2 verification of 2026-11-07 (all weather families native, one round every 5 minutes) answered `/v000903/nation/KR` with the legacy error page (`response.statusCode=500 {"method":"getWeather"}`) in 6 of 13 steady requests, every round after 02:52, and successful compositions took about 3 s. The nation backend assembles fifteen cities concurrently with one absolute three-second deadline, and each city (`KmaBackend::outcome`) also caps its own wait for the KMA CPU admission at its three-second request budget. Each city's inputs end at about 2.9 s under the observed source; the fifteen assemblies then queue for the CPU admission (two permits), and both limits cut them. Legacy gave each child request 9 s (`route.nation.js`: "못 받으면 다음 요청에 받도록 timeout을 길게 함"). AK approved the fix on 2026-11-07 ("진행").

## Outcomes

- **QUEUE:** a city whose inputs end near the bound and whose assembly waits for the CPU admission past three seconds still answers, on the KMA backend itself.
- **SLOW:** cities that answer after more than three seconds still compose the nation answer (all fifteen, legacy order).
- **INPUTS:** air, the narrative and each city's inputs keep the three-second budget; only the city answers get the eight seconds.
- **STUCK:** a city that never answers still yields the legacy child error page, at eight seconds, within the 9-second gateway deadline.
- **UNCHANGED:** the nation parity and request-edge suites pass unchanged.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Exclusions

Not in this change: the per-city S3 lookups and their cost, the size of the CPU admission, partial nation answers (legacy has none), and fixes 1, 3 and 4 of the EC2 report.
