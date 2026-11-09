# Plan for the restart bound work

Task declaration: `server2/config/tasks/KMA-RESTART-BOUND.json`. Stacked on #2907 (`feat/2614-kma-restart-cpu`). Evidence: ignored `reports/kma-ec2-20261109a` (seven restarts of the #2907 binary, server logs, probe timelines, perf).

1. Identify the reads behind the three 501 answers from the logs and the bucket listing (intent, R4).
2. NO-501: regression tests first (a forecast-zone read and a grid read held past the catalog deadline on the S06 loopback peer), seen failing; then a stored read that fails because the store is slow, busy or unreachable (`records::absent`: timeout, transport, capacity, error status) leaves its part absent: grid, RSS and mid listings and partition reads (`Reader::available`), and the zone list (the zones held or those of an empty store). Grid and RSS reads not done at the head start race their providers (the listed publications the request needs), and so does the latest mid partition. Corrupt or invalid objects keep failing.
3. ACCEPT-CLOCK: a paused-clock gateway test with a 300 ms geocoder, seen failing (2.8 s); then the gateway passes its accept instant to the native backend, whose budget (the KMA deadline the source derives its instants from) counts from it.
4. ALLOCATOR: mimalloc as `#[global_allocator]` in the library crate (every binary, example and test links it), a test that heap allocations come from mimalloc's heap (dev-dependency `libmimalloc-sys` with `extended`); `Cargo.lock` updated; CI's Linux job builds the musl release artifact (not buildable locally).
5. Documents, declaration, fmt, clippy, placement gate and artifact policy; focused tests (the coordinator runs the full suite).
6. MEASURE by the coordinator: EC2 restart comparison with the CI musl binary.
7. Codex review of #2916 (Required): the observed grid, RSS and mid restores end at the request bound with their listings raced from the head start (RB-store-deadline, RB-listing-race), and a late zone read leaves the mids to the held or empty-store zones at the head start (RB-zone-mid-starvation); regression tests first, seen failing.
8. Codex review round 2 (Required): the restores the request stops waiting for run on as owned work (`records::Restores`, the owned zone refresh) and later requests answer from their results; one zone list per answer; the process's acquired list installed in the held zones; regression tests first, seen failing.
9. Codex review round 3 (Required): owned reads keep each partition as it completes, the needed ones first; the process's acquisitions stay usable under a byte budget; an earlier listing suppresses S16; restored bodies live only in the budgeted `Bodies` (flights name partitions); regression tests first, seen failing.
10. Codex review round 4: the yesterday-comparison partitions right after the newest required publication; acquisition flights hold only whether they acquired (bodies in the budgeted acquisition cache); regression tests first, seen failing.
11. Codex review round 5 (Recommended, adopted): flights hand their acquisition to registered waiters independently of the cache's eviction; the warning-flight expiry test on a paused clock.
12. Round 7 (full-suite failure on fb9ab02b): the zone refresh reads each group of the day's partition in its own catalog read (identical lists once); the zone-refill test made deterministic on observable GET completion.

R2 (a shorter bound on the assembly's CPU permit) is not done: the permit wait already ends at the request deadline, and a shorter bound would have to drop required data or answer without the assembly; the allocator removes the measured cause of the slow assembly, and MEASURE shows whether more is needed.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user after a deployment | An answer, never 501 | Restart with a stored bucket, CPU saturated | Open the weather | 200 with the parts S3 or the providers deliver by the bound | A stored read passes the catalog deadline: its part from the provider (raced at the head start) or answered as absent | NO-501, MEASURE |
| App user after a deployment | First answer within the bound | Restart, geocoder 0.1-0.3 s | Open the weather | The waits end 2.5/2.7/2.9 s after the request arrived | Geocoder slower: less time for the KMA inputs, not a later answer | ACCEPT-CLOCK |
| Operator | No allocator lock contention | Release musl binary | Restart under load | CPU spent decoding and folding, not in `__unlock` | mimalloc fails to build for musl in CI: the PR is not merged | ALLOCATOR |
| Operator | Corrupt data stays visible | A corrupt or malformed stored object | Request | Dependency failure (501), counted as a native defect | — | NO-501 |
| Reviewer | Placement and docs | PR diff | Gates | Pass | Undeclared path | PLACEMENT, DOCUMENTS |
