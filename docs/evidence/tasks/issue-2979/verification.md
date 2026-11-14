# Verification: server2 log pipeline LP-2 (#2979)

Selected evidence for [#2979](https://github.com/WizardFactory/TodayWeather/issues/2979), stacked on LP-5 and LP-1. Same disposable VM, collector and server binary as [LP-1](../issue-2978/verification.md). No deployment or AWS change.

## Bounded experiments (2026-11-14)

| Question | Observation |
| --- | --- |
| Does a failing destination hold back the other? | No. With S3 answering 503 for 75 s, CloudWatch received all 102 records; after recovery S3 received all 102 exactly once. |
| Do checkpoints follow acknowledged delivery? | Yes. The S3 checkpoint advanced when its 60 s object closed; both checkpoints matched after a normal stop of a run longer than one S3 window. |
| Restart after a stop a few seconds into a run | Without a drain, at least once: the stop flushed 2 S3 objects but the checkpoint stayed behind them, and the next start resent 15 of 20 records (35 lines, 20 unique). After review (CX-LP2-001) the collector's stop waits for every destination to confirm delivery up to the journal end (at most 75 s); the restart scenario then resends nothing. |
| Are retries counted as failures? | No. During a 2-minute S3 failure `vector_component_errors_total` stayed absent and the counters showed no failure, so the status record reports the age of the oldest unconfirmed record instead (`unshipped_seconds`, `behind`). |
| Journal overrun after rotation | Detected at the next collector start from the checkpoint (or, for a reader with no acknowledged delivery yet, from the recorded baseline) against the oldest remaining entry. |

## Checks

- `python3 -I server2/deploy/logging/test_logging.py`: 47 tests OK (16 for LP-2). Four seeded defects in `status.py` were caught before the review; the review correction added regression cases for each finding.
- `linux_check.py` run 7 (report SHA-256 `f44354d7470e99fc4583114ae0bb9e4a4156d5623f96306ff61907dfcf73db69`): **PASS, 128 checks**. Earlier runs, retained:

| Run | Result | Cause and change |
| --- | --- | --- |
| 1 | FAIL | The loopback check matched the peer column (test bug). S3 had no checkpoint yet, so an overrun went unreported → baseline position for readers without one. The status read the counters before the endpoint opened → short retry. The status timer was enabled but never started → `install.sh` starts it. |
| 2 | FAIL | The loopback check ran before the endpoint opened → wait for it. |
| 3 | FAIL (crash) | The check read a stand-in file mid-write → atomic S3 writes, append-tolerant reads. |
| 4, 5 | PASS (103, 105) | First PR head `9e4dc8b1`. |
| 6 | FAIL (126 of 127) | After the review correction: one status interval was 97 s because the status service skips a tick while the collector restarts (its drain waited for S3) → the check allows one longer interval across the restart and requires the cadence to resume. |
| 7 | PASS (128) | Correction candidate. |

Run 7, LP-2 scenarios:

| Scenario | ACs | Observed |
| --- | --- | --- |
| isolation | AC1 | Collector active (or stopped), and each failure seen at the stand-in before the comparison; identical status and body digests for `/health` (200), a weather route (501) and a 404 path in all five conditions (baseline, collector stopped, S3, CloudWatch, both failing); server stop 0.02–0.11 s, within the 6 s HTTP-only bound. |
| restart-exactly-once | AC3 | Collector stopped 3 s after the reads: its drain waited 57.7 s and confirmed every destination; after a restart and a combined stop (server then collector, 58.9 s), both destinations held every record exactly once, including the server's shutdown records. |
| outage-and-redelivery | AC2 AC3 AC5 | CloudWatch got the newest record 0.5 s after it was written while S3 failed; the timer's status showed S3 behind (189 s unconfirmed, `warn`) and CloudWatch current; a collector restart during the outage; S3 had every record 60.8 s after recovery; exactly once, in order; timer intervals 61.4, 65.0, 97.6 (across the restart), 63.4 s; every timer record reached both destinations. |
| journal-overrun | AC4 | Counters listen on `127.0.0.1:9598` only and refuse the host address; after rotating the journal past the S3 position, one S3 `collector.journal_overrun` record with its range, counted in the status record (`warn`), delivered to S3 and CloudWatch. |

The LP-1 and LP-5 scenarios in the same run still pass.

## Independent review

| Reviewer | Head | Verdict | Findings and disposition |
| --- | --- | --- | --- |
| Codex `gpt-6.1-sol`, high (required) | `9e4dc8b1` | CHANGES_REQUIRED | CX-LP2-001 (Required, HIGH): exactly-once after a collector restart was documented as a limit instead of met → stop drain. CX-LP2-002: a moving journal start re-reported a gap → reports continue from the last reported boundary. CX-LP2-003: inactive destinations were baselined and reported → only active ones. CX-LP2-004: a failing `journalctl` read as "nothing pending" → distinct error, status `warn`. CX-LP2-005: isolation did not prove the failures happened and used 45 s → failures observed first; S3, CloudWatch and both; 6 s bound. CX-LP2-006: the timer cadence was not observed → timer-written records, intervals and delivery checked. Red for the unit cases in `correction-red` (mostly signature errors; Codex's reproductions are the semantic Red). |
| Codex, same context (round 2) | `6c682452` | CHANGES_REQUIRED | CX-LP2-002..006 resolved; CX-LP2-001 not resolved: CX-LP2-007 (Required, HIGH) — the drain waits for a fixed target, so a collector-only restart while the server keeps writing can still flush unconfirmed records and resend them (Vector checkpoints only deliveries confirmed before SIGTERM); escalated as a design decision. CX-LP2-008 (Required): a checkpoint with another sequence ID counted as drained → same ID required. CX-LP2-009 (Required): the 75 s limit excluded the target lookup → one deadline. Red `correction2-red` (1 failure, 1 error), then Green. |
| Gemini 4 Argon high (additional) | `9e4dc8b1` | CHANGES_REQUIRED | GEM-LP2-001/002 match CX-LP2-003/002; additionally, a reader without a checkpoint now moves its baseline after an overrun so its unconfirmed age is measured from what remains. GEM-LP2-003 (Recommended): the overrun scenario checks the S3 record by destination. GEM-LP2-004 (Recommended): install table, unit list and counter wording in the guide. |
| Grok 4.7 high (additional) | — | not attempted | Usage quota exhausted earlier in the session. |

## Limitations

- The overrun was simulated by rotating and vacuuming the journal; a real 1 GiB overrun was not produced. The reported range covers entries the reader never saw, which can include collector diagnostics that are never shipped.
- Counters restart with the collector; the status record reflects counts since the collector's start.
- A collector stop now takes up to one S3 window (observed 57–60 s), or 75 s plus 20 s while a destination fails; LP-4 sets the Spot budget.
- Real AWS, Amazon Linux 2023 and native x86_64 were not run.
