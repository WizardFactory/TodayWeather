# SR-2 verification: isolated failures no longer end the shadow run (#3000)

Revision `13e37435` on master `ca3eb0f2`. Run on 2026-11-15: macOS with Python 3.11 for the offline checks; a disposable Lima VM (Ubuntu 24.04 aarch64) for the Linux check, with server2 built in the VM from this branch. Nothing contacted AWS, a provider or production.

## Behaviour

- **Guard.** A missing, stale or malformed observation (including unavailable accounting, metrics or diagnostics) counts as a miss; six consecutive misses (60 s) stop with `observation_lost`; a valid sample resets the count, which is kept in the decision state (schema 4, `misses`) across guard restarts. Other stops are unchanged and immediate.
- **Operator.** A failed, timed-out or unvalidated status poll is reported (`poll: unreachable` with a count, then `poll: recovered`) and retried; it never stops, exports or terminates. Collection ends when the host reports stopped acquisition units (`host_stopped`), at the deadline, or on interrupt. An interrupt while collecting detaches (`operator_detached`) and `run` resumes observing the recorded install; reconnecting reuses the journaled SSH target.
- **Reader.** 401, 403, 429, redirects, 5xx, timeouts and oversize bodies are recorded with the attempt and the schedule continues; the summary reports failed attempts per origin. At least three failures with no success for 30 minutes end the reader (`origin-outage`).

## Checks

- Red first (retained locally): guard/operator tests 7 failures and 3 errors, reader tests 6 failures and 2 errors, simulator subset 3 failures. Green: `test_shadow_supervisor.py` 112 OK, `test_paired_read.py` 18 OK, `test_shadow_simulation.py` 9 OK.
- Guard misses survive restarts: six separate `guard.py check` invocations with an unavailable sample return 0 five times and stop at the sixth.
- Operator: with eight hours of failing polls (errors and timeouts) collection reaches the deadline with no stop, export or terminate before it, one instance and one install; an interrupt leaves the instance running and a second `run` resumes without a new install.
- Linux check (`server2/deploy/shadow/linux_check.py`, all five scenarios, server2 SHA-256 `635b4bd8…` built in the VM, pinned Vector 0.61.0 aarch64): provider-stop 27/27, config-change 12/12, frozen-guard 11/11, collector-broken 6/6, tampered 2/2; overall PASS. Report: [linux-check.json](linux-check.json).
- Placement gate with `server2/config/tasks/ShadowContinue3000.json` and artifact policy: PASS.

## Simulation against the SR-1 baseline

20 seeds per scenario; summary [simulation.json](simulation.json) (full per-seed report SHA-256 `aa2663c6099b342e55b818f1be11fc0b325c682f8c6c3f64f07b977dcc8ee96e`, retained locally).

| Scenario | Full runs /20 (SR-1 baseline) | Median hours (SR-1) | Evidence retrievable /20 (SR-1) | First stop cause |
| --- | --- | --- | --- | --- |
| `ideal` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `observed-quota-at-3min` | 0 (0) | 0.05 (0.05) | 20 (20) | `guard:provider_auth_or_quota` 20 |
| `shared-key-daily-429` | 0 (0) | 14.925 (14.925) | 20 (20) | `guard:provider_auth_or_quota` 20 |
| `production-429-1e-4` | 20 (8) | 168.0 (154.002) | 20 (20) | `guard:collection_deadline` 20 |
| `production-transient-1e-3` | 20 (5) | 168.0 (76.507) | 20 (20) | `guard:collection_deadline` 20 |
| `poll-failure-1e-4` | 20 (12) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `poll-failure-1e-3` | 20 (0) | 168.0 (12.767) | 20 (20) | `guard:collection_deadline` 20 |
| `sample-failure-1e-5` | 20 (13) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `mac-sleeps-night-1` | 20 (0) | 168.0 (14.0) | 20 (0) | `guard:collection_deadline` 20 |
| `operator-ip-change-day-3` | 20 (0) | 168.0 (60.0) | 0 (0) | `guard:collection_deadline` 20 |
| `tx-observed-early-rate` | 0 (0) | 27.739 (27.739) | 20 (20) | `guard:network_ceiling` 20 |
| `s3-measured-high` | 0 (0) | 45.0 (45.0) | 20 (20) | `guard:s3_allowance` 20 |
| `candidate-exit-day-3` | 0 (0) | 60.0 (60.0) | 20 (20) | `candidate-exit` 20 |
| `realistic-combined` | 0 (0) | 14.925 (11.65) | 20 (11) | `guard:provider_auth_or_quota` 20 |

The scenarios that SR-2 targets (operator poll failures, guard sample failures, production 429, production transient errors, operator machine asleep overnight) now reach 168 hours in 20 of 20 seeds. Remaining stops belong to later slices: provider quota signals (`observed-quota-at-3min`, `shared-key-daily-429`, and every `realistic-combined` seed) to SR-3; transmit and S3 rates to SR-4; the address change still loses the evidence because the finish cannot reach the host (SR-5). A candidate exit still ends the run, by design.

## Limits

Simulation fault rates are inputs, not measurements; the Linux check runs on an aarch64 VM with loopback stand-ins, not EC2; a real operator machine sleeping and waking was not exercised.
