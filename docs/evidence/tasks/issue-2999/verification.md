# SR-1 verification: shadow supervisor run simulation (#2999)

Revision: master `434ec250` (includes #2947, #2971 and #2977) plus this change; no supervisor, server or reader code is modified. Run on macOS, Python 3.11, 2026-11-15. Nothing here contacted AWS, a provider or production.

## What runs

`server2/tests/integration/shadow_simulation.py` steps the real `provision.lifecycle` (with its SQLite journal and the offline `ProvisionCloud` fixture), `guard.evaluate` with `estimate_cost`, and `paired_read.Ledger` through a 168-hour run: one operator status poll per minute, one guard sample every 10 seconds and the live 56-case reader schedule (5,852 attempts per origin). SSH, the host's samples and HTTP outcomes are modelled; fault rates are scenario inputs. Since #2977 the host reports a fourth unit (`logs`); the model reports it as active until the operator's stop.

## Checks

- `tests/integration/test_shadow_simulation.py` (added to `tools/ci.py`): 4 tests, OK in 36 s locally. The no-fault run makes 10,082 status polls (10,080 minute polls, the first poll at the start of collection and the finish's post-stop inspection), completes 5,852 pairs, launches one instance and cleans up; the observed-quota scenario stops with `provider_auth_or_quota`; a candidate exit at 60 h stops the guard (`observation_unavailable`, no `/proc` entry) and cleanup completes; a seeded run is deterministic.
- `tests/integration/test_shadow_supervisor.py`: unchanged, OK.
- Placement gate with `server2/config/tasks/ShadowSim2999.json`: PASS.
- Full matrix, 20 seeds per scenario: [baseline-master.json](baseline-master.json) (summary; the full per-seed report has SHA-256 `d1d52e531a269a2046fae0f0dc4ebf43ef8498c4f2105eb473e2b56779a3ebf8` and is retained locally).

## Baseline on master

| Scenario | Full runs /20 (8516c7d7) | Median hours (8516c7d7) | Evidence retrievable /20 | Stop reasons on master |
| --- | --- | --- | --- | --- |
| `ideal` | 20 (20) | 168.0 (168.0) | 20 | `guard:collection_deadline` 20 |
| `observed-quota-at-3min` | 0 (0) | 0.05 (0.08) | 20 | `guard:provider_auth_or_quota` 20 |
| `shared-key-daily-429` | 0 (0) | 14.925 (14.93) | 20 | `guard:provider_auth_or_quota` 20 |
| `production-429-1e-4` | 7 (10) | 134.003 (168.0) | 20 | `guard:collection_deadline` 7, `reader:http-429` 13 |
| `production-transient-1e-3` | 10 (13) | 168.0 (168.0) | 20 | `guard:collection_deadline` 10, `reader:deadline` 10 |
| `poll-failure-1e-4` | 10 (5) | 168.0 (98.612) | 20 | `guard:collection_deadline` 10, `operator-stop` 10 |
| `poll-failure-1e-3` | 0 (0) | 11.85 (12.875) | 20 | `operator-stop` 20 |
| `sample-failure-1e-5` | 13 (14) | 168.0 (168.0) | 20 | `guard:collection_deadline` 13, `guard:observation_unavailable` 7 |
| `mac-sleeps-night-1` | 0 (0) | 14.0 (14.02) | 0 | `acquisition_failed` 20 |
| `operator-ip-change-day-3` | 0 (0) | 60.0 (60.025) | 0 | `acquisition_failed` 20 |
| `tx-observed-early-rate` | 0 (0) | 27.739 (27.749) | 20 | `guard:network_ceiling` 20 |
| `s3-measured-high` | 0 (0) | 45.0 (45.011) | 20 | `guard:s3_allowance` 20 |
| `candidate-exit-day-3` | 0 (—) | 60.0 (—) | 20 | `guard:observation_unavailable` 20 |
| `realistic-combined` | 0 (0) | 10.769 (10.784) | 12 | `acquisition_failed` 8, `guard:provider_auth_or_quota` 8, `operator-stop` 2, `reader:deadline` 2 |

## Differences from the 8516c7d7 run

- **Reader clock.** The earlier draft let the reader's request durations advance the clock it shared with the operator and the guard, so a week lost about 4.9 hours of operator polls and guard samples (9,790 instead of 10,082 polls with no faults). The reader now has its own clock. Consequences: every reader attempt in the schedule is made, so the scenarios driven by production errors stop more often (`production-429-1e-4` 7/20 instead of 10/20, `production-transient-1e-3` 10/20 instead of 13/20), and stop times are taken at the guard step (`observed-quota-at-3min` 0.05 h instead of 0.08 h).
- **Seed variation.** `poll-failure-1e-4` 10/20 instead of 5/20 and `sample-failure-1e-5` 13/20 instead of 14/20; the expected survival for 10,080 polls at 1e-4 is 36 %, so both are within the spread of 20 seeds.
- **New scenario.** `candidate-exit-day-3` (no earlier figure).
- Unchanged: `ideal` 20/20, quota and shared-key scenarios 0/20, operator unreachable (asleep or address change) 0/20 with no retrievable evidence, transmit and S3 rate scenarios stop at the same hours, `realistic-combined` 0/20 with a median of 10.8 hours.

## Limits

Fault rates are not measurements; the export is judged by SSH reachability at the finish, not by building an archive; the log collector is a reported unit state only; operator process death and host reboot are not modelled; the reader's scheduling loop is re-implemented around the real `Ledger`.
