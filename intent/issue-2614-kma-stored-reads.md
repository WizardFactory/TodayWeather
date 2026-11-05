# KMA requests with an empty or partly stored S3

AK asked on 2026-11-04 and 2026-11-05 how fast a request with nothing in S3 can produce a response that passes client validation, then whether the location of cached data can be designed so that checking for it costs less, and whether partly stored data was considered. AK approved the recommended order and a computed sunrise while stored KASI is not fully read, and asked to proceed to a reviewed PR. The endpoint excludes merge, auto-merge, merge queues, deployment and provider or AWS calls.

## Outcomes

- **EMPTY:** with nothing stored, each existence question costs about one S3 request, and the first response carries the whole forecast.
- **PARTIAL:** how a cell's data is split between S3 and the providers does not change the response, apart from stored fields inside the read window, and stored history does not delay what is absent.
- **WINDOW:** the observed response reads the stored grid and RSS publications it uses, and a region's newest mid publication. The legacy path keeps its behavior.
- **WARNINGS:** a new process replays warning days only since a stored zone state, and a later seed import still takes effect.
- **KASI:** a long restore does not hold a request, and a new process restores from one stored object.
- **CHECK:** the full-response check reports a missing forecast day and a short list that ends early.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Exclusions

Not in this change: the 3 s budget, the guard for a failed VSRT, a packaged AirKorea station list, stopping the wait for air and life providers, and warm warning refresh. Evidence and the options are in `docs/evidence/research/kma-speed-options-2026-11-04.md`.
