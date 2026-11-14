# Verification: server2 log pipeline LP-4 (#2981)

Selected evidence for [#2981](https://github.com/WizardFactory/TodayWeather/issues/2981), after LP-3. Same disposable Lima VMs and stand-ins as [LP-3](../issue-2980/verification.md): Ubuntu 24.04.5, systemd 255, Vector 0.61.0. The instance-metadata stand-in now also serves `spot/instance-action`. The destination stand-in fsyncs and timestamps what it stores, so its data survives a power-off of the VM. No deployment and no AWS change.

## Bounded experiments (2026-11-15)

| Question | Observation |
| --- | --- |
| Time budget parts | Poll interval 5 s; `server2.service` `TimeoutStopSec=45` (worker drain 35 s); LP-2's stop drain 75 s, too long for a two-minute notice, so 10 s on an interruption; then Vector's SIGTERM flush, `--graceful-shutdown-limit-secs 20`. Total 80 s. |
| S3 delivery with the 60 s window | LP-3 runs measured 58.3–58.6 s from the request to the stand-in, close to the required 60 s. With the window at 50 s, the same scenarios measure 48.4–48.5 s. |
| Power-off without shutdown | `sysrq o` stops the VM at once. Unsynced page cache is lost, so the check syncs the journal at that moment (the comparison base), and the stand-in fsyncs every object and line. One torn line in the stand-in's operation log showed that its readers must skip torn lines. |

## Checks on the candidate

Code `75487d4c` (the merge of master afterwards changed no LP-4 file); the fresh-host check ran on `b94b218e`, which adds the watcher check to it.

- `python3 -I server2/deploy/logging/test_logging.py`: 86 tests OK on macOS (2 need GNU `sha256sum` and are skipped there) and all 86 OK on Linux.
- `linux_check.py` (report SHA-256 `f5cf09622676780e53ab1f04f89422c7453f47c1588cc40b8538b53937304736`): **PASS, 177 checks**. LP-4 scenarios:

| Scenario | ACs | Observed |
| --- | --- | --- |
| spot-interruption | LP4-AC1, LP4-AC2 | On a Spot instance, with the stand-in announcing `terminate`, notice to collector stop took **15.2 s** (budget 80 s). The server unit was inactive 10.2 s before the collector. One `collector.interruption_notice` record carried the announced action and time; the server wrote 3 shutdown records after it, and all three are timestamped later. S3 and CloudWatch each held every server record up to the server's stop, and the notice record. |
| interruption-watcher-idle | LP4-AC5 | On-Demand: the watcher ended successfully after 0.5 s, saying why it was idle, and the server kept running. Without instance metadata: the same after 55.6 s of retries. |
| delivery (S3, CloudWatch, all) | LP4-AC4 | Delivery while running: S3 within 48.4–48.5 s and CloudWatch within 1.5 s, inside the checked bounds of 60 s and 10 s. |

  The LP-1, LP-2 and LP-3 scenarios still pass, including abrupt-stop (50 repeats, all inside the 93-record window after the saved position) and instance-replacement.

- `linux_reboot_check.py`:

| Variant | Observed |
| --- | --- |
| `before-partial`, clean poweroff (101 s), `after` | Previous-boot backlog exactly once, as in LP-3. The shutdown stopped the server (monotonic 2354.995 s) before stopping the collector (2355.006 s). |
| `before` (unconfirmed), clean poweroff (96 s), `after` | Same, exactly once. Server stopped at 171.392 s, collector stopping at 171.398 s. |
| `before-poweroff`, `sysrq o`, `after` | 149 requests over 75 s with both destinations working, then an instant power-off; 747 server records were in the synced journal. At the power-off, S3 lacked 250 records, the oldest 25.3 s old (bound 60 s), and CloudWatch lacked none (bound 10 s). After the restart the collector shipped the previous boot as backlog, and every record of both boots arrived at least once (CloudWatch repeated 45). |

- `linux_fresh_check.py` on a new VM, user data for `b94b218e` (1,468 bytes): **PASS, 19 checks**, including the interruption watcher started by the boot configuration and idle on On-Demand.
- Manual step 9 is an actual interruption session: the sequence took 13 s, with the server stopped first and the collector about 10 s later.
- Placement gate (`LogSpot2981.json`), artifact policy, Archify `finalize` and `visual-check` (captures inspected), and the manual PDF (9 pages rendered and inspected): PASS.

## Limitations

- The interruption notice came from the metadata stand-in; a real EC2 notice, IMDS hop limits and the instance's actual stop or termination were not exercised.
- `sysrq o` stands in for power loss; a real host failure was not produced. The loss bound was checked once, with steady traffic below the server's rate limits.
- On an interruption, records sent by Vector's own flush are not confirmed in the checkpoint; if the disk survives, they can repeat after the next start (documented). In the interruption check, S3's open object went out with that flush.
- The watcher stops units only; it does not mark the instance unready or remove routing (#2705).
- Amazon Linux 2023 and native x86_64 were not run.
