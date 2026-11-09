# First answer after a restart: never 501, a multi-threaded allocator and the accept clock

Seven EC2 restarts of the PR #2907 binary (2026-11-09, t3.small, 2 vCPU; ignored evidence `reports/kma-ec2-20261109a`) answered the first request with 501 three times (restarts 3, 6 and 7) and in 3.3-5.0 s otherwise. The root-cause analysis found:

- **R1:** for about 4-5 s after a restart both vCPUs are 96-100% busy; 47-70% of the perf samples are in musl's `__unlock` and 7-16% in malloc/free. The release binary is static musl without a `#[global_allocator]`, so every allocation passes musl mallocng's one process-wide lock. The request assembly takes 857-1,041 ms instead of 42-81 ms warm.
- **R2:** after the 2.5 s wait nothing short bounds the CPU permit and assembly or the encoding; stored reads keep the 8 s budget.
- **R3:** the 2.5 s wait counts from the KMA dispatch after geocoding, adding 121-215 ms to every first answer.
- **R4:** in the three 501 restarts a stored read the request waits for passed the catalog's 3 s operation deadline; the snapshot failed and the gateway answered 501. The logs (debug in restarts 3 and 7, info in 6; S3 operations carry no key) and the bucket listing identify the reads by their shape: in all three, one catalog lookup started about 0.25 s into the request and restoring group after group, which matches only the day's forecast-zone list (`data-go-kr/forecast-zone`, partition `20261109`): every process start stores the same 15 KB list again (3 groups at restart 3, 6 at restart 6, 7 at restart 7; every other catalog of the bucket held one group), and the read restores and decodes each on the saturated CPU (restart 7: the catalog and four groups read, a 1.7 s CPU wait before the fifth group's page, cancelled at the deadline). In restart 3 six more lookups started together at 0.38 s and timed out after two reads each: by their number most likely the second chunk of a grid family's 54 h read (the newest six of the 14 `ultra-srt-ncst` partitions per cell, read eight at a time).

On 2026-11-09 AK chose the recommendation ("권장대로 진행").

## Outcomes

- **NO-501:** a stored read that fails or times out because the store is slow, busy or unreachable never turns the answer into 501. A part the request can acquire from a provider is treated as absent and acquired within the bound, as on an empty store; a grid family or RSS read not done at the head start races its providers as the restart race does for the other families. A part that is only stored is answered as absent (the forecast zones of an empty store; no older mid save). Corrupt or invalid objects and panics keep failing the answer.
- **ALLOCATOR:** mimalloc is the global allocator of the server2 binaries, examples and tests.
- **ACCEPT-CLOCK:** the observed request's waits (2.5, 2.7 and 2.9 s, and the 700 ms head start) count from the gateway's accept of the request, threaded as the native backend's deadline, without global state.
- **MEASURE:** an EC2 restart comparison by the coordinator (7 or more restarts): no answer with 501; first-answer time and client validation against the same process later and against production.
- **DOCUMENTS:** `docs/architecture/server2.md` and `docs/architecture/server2-kma-data-design.md` describe the bound and the restart behaviour.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Exclusions

No change to the 2.5/2.7/2.9 s bounds, the 8 s stored-read budget or the catalog deadline; no runtime mode or flag; no deployment. The CPU-permit wait of the assembly (R2) keeps its current bound (the request deadline). Stacked on #2907.
