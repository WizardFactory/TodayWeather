# Verification: server2 log pipeline LP-2 (#2979)

Selected evidence for [#2979](https://github.com/WizardFactory/TodayWeather/issues/2979), stacked on LP-5 and LP-1. Same disposable VM, collector and server binary as [LP-1](../issue-2978/verification.md). No deployment or AWS change.

## Bounded experiments (2026-11-14)

| Question | Observation |
| --- | --- |
| Does a failing destination hold back the other? | No. With S3 answering 503 for 75 s, CloudWatch received all 102 records; after recovery S3 received all 102 exactly once. |
| Do checkpoints follow acknowledged delivery? | Yes. The S3 checkpoint advanced when its 60 s object closed; both checkpoints matched after a normal stop of a run longer than one S3 window. |
| Restart after a stop a few seconds into a run | At least once. The stop flushed 2 S3 objects but the checkpoint stayed behind them; the next start resent 15 of 20 records (35 lines, 20 unique). Documented as a limit; LP-4's drain addresses it. |
| Are retries counted as failures? | No. During a 2-minute S3 failure `vector_component_errors_total` stayed absent and the counters showed no failure, so the status record reports the age of the oldest unconfirmed record instead (`unshipped_seconds`, `behind`). |
| Journal overrun after rotation | Detected at the next collector start from the checkpoint (or, for a reader with no acknowledged delivery yet, from the recorded baseline) against the oldest remaining entry. |

## Checks

- `python3 -I server2/deploy/logging/test_logging.py`: 41 tests OK (10 for LP-2: cursor parsing, gaps with checkpoint and baseline, one report per gap, counters, warn on loss or a destination behind, unconfirmed age, units). Four seeded defects in `status.py` were all caught.
- `linux_check.py` run 5 (report SHA-256 `a95ca8f382c4b948061ae404c53d030a477cf717ebc7145692b8ce0edd8c93f4`): **PASS, 105 checks**. Earlier runs, retained:

| Run | Result | Cause and change |
| --- | --- | --- |
| 1 | FAIL | The loopback check matched the peer column (test bug). S3 had no checkpoint yet, so an overrun went unreported → baseline position for readers without one. The status read the counters before the endpoint opened → short retry. The status timer was enabled but never started → `install.sh` starts it. |
| 2 | FAIL | The loopback check ran before the endpoint opened → wait for it. |
| 3 | FAIL (crash) | The check read a stand-in file mid-write → atomic S3 writes, append-tolerant reads. |
| 4 | PASS (103) | — |
| 5 | PASS (105) | Adds the status during the outage (S3 `behind`, 128 s unconfirmed, `warn`; CloudWatch current) and after recovery (S3 current). |

Run 5, LP-2 scenarios:

| Scenario | ACs | Observed |
| --- | --- | --- |
| isolation | AC1 | Identical status and body digests for `/health` (200), a weather route (501) and a 404 path in all three conditions; server stop 0.03–0.05 s. |
| outage-and-redelivery | AC2 AC3 AC5 | CloudWatch got the newest record 0.5 s after it was written while S3 failed; S3 refused uploads; a collector restart during the outage; S3 had every record 60.8 s after recovery; both destinations exactly once, CloudWatch in journal order, each S3 object in journal order; status records at both destinations. |
| journal-overrun | AC4 | Counters listen on `127.0.0.1:9598` only and refuse the host address; after rotating the journal past the S3 position, one `collector.journal_overrun` record for S3 with its range, the status record counts it (`warn`), and the record reached S3 and CloudWatch. |

The LP-1 and LP-5 scenarios in the same run still pass.

## Limitations

- The overrun was simulated by rotating and vacuuming the journal; a real 1 GiB overrun was not produced. The reported range covers entries the reader never saw, which can include collector diagnostics that are never shipped.
- Counters restart with the collector; the status record reflects counts since the collector's start.
- Real AWS, Amazon Linux 2023 and native x86_64 were not run.
