# First answer after a restart: the allocator and the accept clock

The EC2 restart comparisons of #2900 and #2907 (2026-11-08 and 09, t3.small, 2 vCPU) answered the first request after a restart on a populated bucket in 3.6 to 4.6 s, and 3 of 7 first answers were 501. Both vCPUs were saturated for 4 to 5 s, 47 to 70% of the CPU samples were in musl's malloc lock (the static musl release binary uses mallocng, which takes one process-wide lock for every allocation and free), and the 2.5 s wait of the observed source counted from the KMA dispatch, after geocoding. PR #2916 then grew restore machinery through ten review rounds. On 2026-11-10 AK asked for the root problem to be examined again and the cheapest hypothesis to be measured first (review-loop analysis: `reports/sdlc/issue-2614-kma-restart-bound/review-loop-analysis.md`, not tracked).

This change keeps only two commits of #2916 on top of #2907: mimalloc as the global allocator and the observed KMA waits counted from the HTTP accept. In the restart re-examination design (`reports/sdlc/issue-2614-kma-restart-reexam/design.md`, not tracked; section 11 approved by design review 4 and by AK on 2026-11-10, "권고대로 진행"), it is PR-A of four parts: PR-A, PR-Z (the forecast-zone newest list), PR-V (the rn1 gap one first answer showed) and C (EC2 acceptance with client validation). Completing PR-A does not complete the restart goal.

## Outcomes

- **ALLOCATOR:** mimalloc serves every allocation of the server2 binaries, examples and tests, so restart work no longer serializes on one malloc lock. Its defaults are kept; no option bounds its memory.
- **ACCEPT-CLOCK:** a native backend's budget counts from the instant the gateway accepted the request. The observed KMA source derives its 700 ms head start and its 2.5, 2.7 and 2.9 s waits from it, so the geocode before the dispatch counts toward them.
- **MEASURED:** an EC2 A/B on 2026-11-10 (t3.small, one bucket filled for 55 minutes by master, 14 restarts in ABBA order) compares #2907 (43d02167) with this change (aa7e2e9d):

  | | #2907 (musl malloc) | This change |
  | --- | --- | --- |
  | First answer, accept to response | 3,327 to 5,640 ms, 7 of 7 over 3 s | 2,550 to 2,616 ms, none over 3 s |
  | 501 | 2 of 7 (at 12 and 13 stored zone lists of the day) | 0 of 7 (up to 15) |
  | First-answer assembly, median | 643 ms | 65 ms |
  | Malloc-lock share of the CPU samples | 54 to 55% | 0% |
  | Peak RSS in the first 60 s, median | 192 MB | 300 MB |

  Evidence: `reports/kma-ec2-20261110a/summary.json` (local, not tracked).
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Notes for AK

- mimalloc costs about 110 MB of peak RSS on the 2 GiB t3.small (300 MB against 192 MB). The restart acceptance (C) checks the memory over at least ten minutes.
- The 501 path is unchanged. This run avoided it because the stored reads became fast, while the day's forecast-zone partition still gained one identical list per start. PR-Z addresses that.
- One of the seven first answers lacked `rn1` that the same process gave 5 s later (A: 3 of 5 answers lacked station values or `rn1`). PR-V diagnoses it before C.

## Exclusions

Not in this change: the forecast-zone selection and acquisition (PR-Z), the rn1 gap (PR-V), client validation on EC2 (C), a request-time bound on stored reads during an S3 outage (AK decision 3 of 2026-11-10 keeps today's behaviour), and #2916's owned restores, budgets and resumable zone refresh.
