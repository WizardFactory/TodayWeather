# SR-5a paired evidence copy

The full simulation and Ubuntu check used `41c09c49239d564d40d2794ed70f978145368fea`.
This slice covers creation and audit of copies. SR-5b owns the operator finish,
original export and cleanup sequence.

## Verification

- Python 3.11 focused checks passed 48 tests for evidence copy, audit, bounded
  remote control and costs. Regression cases include mismatched file pairs,
  multiple pending batches, stalled reads and deadline handling. Hosted CI
  passed all 14 checks on the tested runtime revision. An earlier reader-suite
  run reported one unexpected production-peer error and then passed all 19
  cases when repeated alone. The cause remains unconfirmed.
- The seven-day simulator ran 19 scenarios with 20 seeds each. All 380 runs
  retained paired evidence. The operator IP change and unreachable-at-deadline
  scenarios each retained evidence in all 20 seeds without SSH. The combined
  fault scenario reached 168 hours in all 20 seeds. Fourteen scenarios reached
  168 hours on every seed. The other five injected candidate exit, blocked final
  copy with candidate exit, cost ceiling, storage authorization or reader
  outage. In the blocked final-copy scenario all 20 seeds recovered paired
  evidence on subsequent copying. [Simulation summary](simulation.json)
- Ubuntu 24.04 arm64 passed 115 of 115 checks using loopback provider and
  state-bucket stand-ins. Final copies were verified after guard stop, watchdog
  kill, candidate exit, reader failure and the 168-hour stop. The bucket-only
  audit matched paired files with host data unavailable. The test reused the
  prior arm64 binary because the Rust inputs were identical. [Linux report](linux-check.json)
- Archify validated, delivered and browser-checked the updated workflow. A
  rendered screenshot was inspected.

The VM and simulation ran offline against stand-ins. They leave real AWS S3
signing and upload unverified.
