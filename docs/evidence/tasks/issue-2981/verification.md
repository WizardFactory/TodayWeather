# Verification: server2 log pipeline LP-4 (#2981)

Selected evidence for [#2981](https://github.com/WizardFactory/TodayWeather/issues/2981), after LP-3. Same disposable Lima VMs and stand-ins as [LP-3](../issue-2980/verification.md): Ubuntu 24.04.5, systemd 255, Vector 0.61.0. The instance-metadata stand-in now also serves `spot/instance-action`. The destination stand-in fsyncs and timestamps what it stores, so its data survives a power-off of the VM. No deployment and no AWS change.

## Bounded experiments (2026-11-15)

| Question | Observation |
| --- | --- |
| Time budget parts | Poll every 4 s with 0.5 s requests (seen within 6 s); `server2.service` `TimeoutStopSec=45` (worker drain 35 s); LP-2's stop drain is 75 s, too long for a two-minute notice, so 10 s on an interruption; then Vector's SIGTERM flush, `--graceful-shutdown-limit-secs 20`. Total 81 s, with each wait bounded by the time left of 75 s after the notice. |
| S3 delivery with the 60 s window | LP-3 runs measured 58.3–58.6 s from the request to the stand-in, close to the required 60 s. With the window at 50 s, the same scenarios measure 48.4–48.5 s. |
| Power-off without shutdown | `sysrq o` stops the VM at once. Unsynced page cache is lost, so the check syncs the journal at that moment (the comparison base), and the stand-in fsyncs every object and line. One torn line in the stand-in's operation log showed that its readers must skip torn lines. |

## Checks on the candidate

Product code `30649d4f` (after review round 1); `c7ec8af7` changes only the destination stand-in and `linux_check.py`.

- `python3 -I server2/deploy/logging/test_logging.py`: 91 tests OK on macOS (2 need GNU `sha256sum` and are skipped there) and all OK on Linux. The round-1 regression tests fail on the reviewed head `c6396581`; the drain-deadline test fails on behaviour, the others mostly because interfaces were missing (`correction-red`).
- `linux_check.py` run 4 on `c7ec8af7` (report SHA-256 `cd6dac606609be6a7ad06318e3b32923f265e653427b572e7cbda4a9380fb670`): **PASS, 185 checks**. LP-4 scenarios:

| Scenario | ACs | Observed |
| --- | --- | --- |
| spot-interruption | LP4-AC1, LP4-AC2 | On a Spot instance, with the stand-in announcing `terminate`: the notice was seen 3.9 s after it was published (bound 6 s), and notice to collector stop took **14.4 s** (budget 81 s). `server2.service` was inactive before `server2-logs.service` left the active state. The `collector.interruption_notice` record carried the announced action and time. Its `collector.interruption_progress` record said `server_stop: ok`. The server's 3 shutdown records (`process` / `shutdown`, `runtime_teardown`), identified by their fields, all came after the notice at both destinations. S3 and CloudWatch each held every server record up to the server's stop, plus both watcher records. |
| interruption-watcher-idle | LP4-AC5 | On-Demand: the watcher ended successfully after 0.5 s, saying why it was idle, and the server kept running. Without instance metadata: the same after 55.5 s of retries. |
| s3-slow-upload | LP4-AC4 | With every S3 answer delayed by 5 s, a new record reached S3 in 53.6 s, without a retry. |
| delivery (S3, CloudWatch, all) | LP4-AC4 | Delivery while running took 48.4 s to S3 and 1.5 s to CloudWatch (bounds 60 s and 10 s). |

  The LP-1, LP-2 and LP-3 scenarios still pass, including abrupt-stop (50 repeats, all inside the 93-record window) and instance-replacement.

- `linux_reboot_check.py` run 3 on `30649d4f`:

| Variant | Observed |
| --- | --- |
| `before-partial`, clean poweroff (96 s), `after` | The previous boot's backlog arrived exactly once. The server stopped (monotonic 2366.051 s) before the collector began to stop (2366.066 s). The previous boot ended with the server's 3 shutdown records, and CloudWatch had stored them before the reboot. |
| `before` (unconfirmed), clean poweroff (96 s), `after` | Same: exactly once; server stopped at 171.931 s, collector stopping at 171.937 s; 3 shutdown records, stored by CloudWatch before the reboot. |
| `before-poweroff`, `sysrq o`, `after` | 190 requests, then a power-off 46.3 s after an S3 server object had closed, just before the next close: the worst case. 952 server records were in the synced journal. S3 lacked 460, the oldest 46.6 s old (bound 60 s); CloudWatch lacked 10, the oldest 1.0 s old (bound 10 s). After the restart, every record of both boots arrived at least once (CloudWatch repeated 25). |

- `linux_fresh_check.py` on a new VM, user data for `30649d4f` (1,473 bytes): **PASS, 19 checks**, including the interruption watcher started by the boot configuration and idle on On-Demand.
- Manual step 9 is an actual interruption session: the sequence took 13 s; the server stopped first and the collector about 10 s later.
- Placement gate (`LogSpot2981.json`), artifact policy, Archify `finalize` and `visual-check` (captures inspected), and the manual PDF (9 pages rendered and inspected): PASS.

## Runs that failed and what they found

| Run | Result | Cause and change |
| --- | --- | --- |
| run 2 (`7f4a9914`) | linux_check FAIL (2), reboot `before` FAIL | (1) **Product defect.** At a shutdown, systemd stopped `systemd-journald@server2.service` at the same moment as `server2.service`, and the server's final records never reached the journal. `LogNamespace=` orders a unit only after the journal's sockets, so every namespace unit is now `After=systemd-journald@server2.service` (`30649d4f`). The new check that the previous boot ended with shutdown records found it; it had been possible since LP-1. (2) The order check read a timestamp systemd does not set; it now uses `ActiveExitTimestampMonotonic`. (3) The slow-upload check failed: see run 3. |
| run 3 (`30649d4f`) | linux_check FAIL (1) | The slow-upload switch of the destination stand-in raised `UnboundLocalError`: a local `import time` elsewhere in the same handler made `time` a local name. Each slow request was dropped, which the collector logged as `dispatch failure` and retried. In run 2 this had looked like a timeout, wrongly explained on the PR as the 10 s request timeout. The stand-in is fixed (`c7ec8af7`); with a 5 s delay there is no retry. All other run-3 checks passed and are used above. |

## Limitations

- The interruption notice came from the metadata stand-in; a real EC2 notice, IMDS hop limits and the instance's actual stop or termination were not exercised.
- `sysrq o` stands in for power loss; a real host failure was not produced. The loss bound was checked once, with steady traffic below the server's rate limits.
- On an interruption, records sent by Vector's own flush are not confirmed in the checkpoint; if the disk survives, they can repeat after the next start (documented). In the interruption check, S3's open object went out with that flush.
- The watcher stops units only; it does not mark the instance unready or remove routing (#2705).
- Amazon Linux 2023 and native x86_64 were not run.
