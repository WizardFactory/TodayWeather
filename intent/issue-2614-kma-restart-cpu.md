# First answer after a restart: blocking pool off the critical path

The EC2 restart comparisons of PR #2900 (2026-11-08, t3.small, 2 vCPU) restored past days, yesterday values and the history mapping on the first answer, but the current station observation was missing in up to 2 of 3 first answers, UV in 3 of 3, and the first answer took 3.6-4.4 s (master 3.8-3.9 s). The diagnosis (`reports/sdlc/issue-2614-kma-restart-race/p1-design-note.md`, ignored) found the four blocking threads (`src/lib.rs`) saturated after a restart: pages arrive by about 1.2 s but their parsing and folds queue behind restore decoding, disk-cache loads and writes (with a cross-process lock), and DNS lookups (reqwest without an async resolver). On 2026-11-08 AK chose the recommendation ("권고대로"): take DNS and the disk cache off the blocking pool first and measure again; if that is not enough, limit the CPU the restore work may take.

## Outcomes

- **DNS:** name resolution for S3 and providers no longer occupies a blocking thread (async resolver), with the same hosts, timeouts and address order behaviour the deployment needs.
- **DISK-CACHE:** disk-cache loads and writes run on their own thread; a write may be dropped when that thread is busy (S3 stays the truth, a dropped write costs a later S3 read); the cross-process lock keeps working; request work never waits for a disk-cache write.
- **MEASURE:** an EC2 restart comparison (same method as #2900, info logging, away from the HH:40 publication boundary) judges the first answers with the client validation tool and records the latency; if the current observation or UV still miss or the first answer still exceeds the bound because of CPU queueing, a restore CPU admission (restore decoding and folds limited so first-answer work keeps threads) is added and measured.
- **DOCUMENTS:** `docs/architecture/server2.md` describes the threads and the cache path.
- **PLACEMENT:** the placement gate and the artifact policy pass on the outgoing commits.

## Exclusions

No change to the 3 s bound, no runtime mode or flag for verification, no instance-type change, no deployment. Stacked on #2900.
