# SR-5a paired evidence copy

Runtime and offline verification inputs are pinned to `6d078b1c`. The integrated
candidate carries the SR-5a copy diagram and the original runtime and test
inputs. This slice covers creation and audit of copies. SR-5b owns the operator
finish, original export and cleanup sequence.

## Tests

- Python 3.11 on macOS. Supervisor 154 and logging 97 passed. The paired
  reader suite initially reported one unexpected production-peer error, then
  passed 19 of 19 when repeated alone on the same revision. The error's cause
  remains unconfirmed.
- Archify validated and delivered the workflow figure and checked artifact
  provenance and browser execution. A screenshot was visually reviewed.
- Full simulated 168-hour scenario matrix is pending. A 20-seed run was resumed
  from an empty results directory, with one scenario worker.

## Disposable Linux systemd check

Ubuntu 24.04 arm64, loopback provider and state-bucket stand-ins. The check
reused the existing arm64 server binary because SR-5a changes Python and unit
configuration. The first full VM run after the reader-lock fix passed 114
of 115 assertions. At the storage authorization stop, the reader reported
`failed` after a VM wall-clock rollback. The affected scenario passed 16 of
16 assertions in a fresh VM. The report retains both runs separately.

Final evidence generation was observed after a guard stop, watchdog kill,
candidate exit, reader failure, and the 168-hour stop across the VM runs.
The bucket-only audit matched the paired files with host data unavailable.
Live AWS S3 signing and PUT are unverified. See the [Linux reports](linux-check.json).
