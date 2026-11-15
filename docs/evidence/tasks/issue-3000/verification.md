# SR-2 verification: isolated failures no longer end the shadow run (#3000)

Revision `ae2c96cc` (after independent review 5) on master `ca3eb0f2`. Run on 2026-11-15 and 2026-11-16: macOS with Python 3.11.15 for the offline checks at this revision (earlier rounds of this PR partly ran under the system Python 3.9.6); a disposable Lima VM (Ubuntu 24.04 aarch64) for the Linux check, with server2 built in the VM from this branch. Nothing contacted AWS, a provider or production.

## Behaviour

- **Guard.** A missing, stale or malformed observation (including unavailable accounting, metrics, or missing or wrongly typed diagnostics) counts as a miss; six consecutive misses (60 s) stop with `observation_lost`; a valid sample resets the count, which is kept in the decision state (schema 4, `misses`) across guard restarts. Other stops are unchanged and immediate: identity, listener, network and disk are decided from the sample's own fields before the miss decision, so a partial observation never delays or renames them; a missing identity field is a changed identity, as on master.
- **Operator.** A failed, timed-out or unvalidated status poll is reported (`poll: unreachable` with a count, then `poll: recovered`) and retried; it never stops, exports or terminates. The journal records `collection-started` the first time the install is confirmed started. Collection ends on a validated host stop (`host_stopped`: receipt `failed`, or the three acquisition units in known states with at least one `inactive` or `failed`; missing or unknown states are unreachable), at the deadline, or on interrupt. An interrupt while collecting detaches (`operator_detached`, CLI exit 0). A resumed `run` in the collecting phase makes no provisioning or install call: it reconnects through the journaled SSH target inside the collecting loop, so a failed reconnect (including the first) is an unreachable poll; at or after the deadline it makes one more reconnect attempt for evidence retention and then finishes with cleanup, also when that attempt fails. After reviews 3 and 4 the lifecycle reads its phase (startup, collecting, finishing) from the journal and the clock when an event happens: while collecting (marker stored, before the deadline) any connector or poll error is an unreachable poll, an interrupt detaches (exit 0) and a local failure such as the journal or the progress output detaches as `operator_failed` (exit 1), all without touching the host, also right after the marker is stored; startup is unchanged. Every finish without a connection, including a resume after the deadline whose install never stored the marker, first makes one reconnect attempt through the journaled SSH target for evidence retention. An interrupt inside retention or cleanup stops the process as on master and `finish` resumes it; a resumable, evidence-first finish is SR-5 (#3003).
- **Reader.** 401, 403, 429, redirects, 5xx, timeouts and oversize bodies are recorded with the attempt and the schedule continues; the summary reports failed attempts per origin. At least three failures with no success for 30 minutes end the reader (`origin-outage`).

## Checks

- Red first (retained locally): guard/operator tests 7 failures and 3 errors, reader tests 6 failures and 2 errors, simulator subset 3 failures; after review 1, 7 failures and 2 errors for the new resume, validated-stop, deadline-on-resume, typed-diagnostics and CLI-detach tests; after review 2, 19 failures for the failing-reconnect resume and the confirmed-stop-not-masked tests; after review 3, 5 failures and 15 errors in a fault-injection test that drives the lifecycle with an interrupt and four error types at every call site in each phase; after review 4, 1 failure and 5 errors for its marker-boundary and marker-less expired-resume cases; after review 5, an interrupt escaping the lifecycle from the steps before the finish (target check, finishing record), now guarded and covered by the same table test. Green at this revision with Python 3.11.15: `test_shadow_supervisor.py` 122 OK, `test_paired_read.py` 18 OK, `test_shadow_simulation.py` 9 OK. The reader's continue test now allows 5 s for its one request pair, which a loaded machine needed.
- Guard misses survive restarts: six separate `guard.py check` invocations with an unavailable sample return 0 five times and stop at the sixth.
- Operator: with eight hours of failing polls (errors and timeouts) collection reaches the deadline with no stop, export or terminate before it, one instance and one install; an interrupt leaves the instance running and a second `run` resumes without a new install or provisioning call, also when every resumed poll fails; a resume whose reconnects fail (`OSError`, state error, timeout) keeps collecting to the deadline; a resume after the deadline finishes with evidence export and termination, also when its reconnect fails; unit states that are missing, partial or transitional do not end collection.
- Linux check (`server2/deploy/shadow/linux_check.py`, all five scenarios, server2 SHA-256 `28e34597…` built in a fresh VM from `62b88e41`; the host-side files it exercises (guard, remote, coordinator) are unchanged since, and later commits change the operator lifecycle and tests, pinned Vector 0.61.0 aarch64): provider-stop 27/27, config-change 12/12, frozen-guard 11/11, collector-broken 6/6, tampered 2/2; overall PASS. Report: [linux-check.json](linux-check.json). The runs at `13e37435` and `5e5c0090` also passed 58/58.
- Placement gate with `server2/config/tasks/ShadowContinue3000.json` and artifact policy: PASS.

## Simulation against the SR-1 baseline

20 seeds per scenario at `3f634c5f` (`ae2c96cc` only guards the two steps before the finish, which the simulator does not interrupt) (Python 3.11.15, one process per scenario); summary [simulation.json](simulation.json) (full per-seed report SHA-256 `20c1f9b822d5df439b6f6077ce2a8ca77276bbc7d170538eadf89d6fafbf25b9`, retained locally).

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
