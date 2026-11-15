# SR-1 verification: shadow supervisor run simulation (#2999)

Revision: master `434ec250` (includes #2947, #2971 and #2977) plus this change; no supervisor, server or reader code is modified. Run on macOS, Python 3.11, 2026-11-15. Nothing here contacted AWS, a provider or production.

## What runs

`server2/tests/integration/shadow_simulation.py` steps the real `provision.lifecycle` (with its SQLite journal and the offline `ProvisionCloud` fixture), `guard.evaluate` with `estimate_cost`, and `paired_read.Ledger` through a 168-hour run: one operator status poll per minute, one guard sample every 10 seconds and the live 56-case reader schedule (5,852 attempts per origin). SSH, the host's samples and HTTP outcomes are modelled; fault rates are scenario inputs.

The host model follows the generated units (`coordinator.py` `host_units`): a guard stop stops the candidate and the reader; a reader exit stops only the reader, and the candidate and guard keep running until the operator's next poll sees the reader inactive and stops the run; a candidate exit also ends the reader, which is bound to it. The log collector (#2977) is reported as a fourth unit, active until the operator's stop. The reader makes a request only when its start time is inside the bound it is advanced to, and applies the result when the request completes; its request durations advance its own clock, not the operator's. The reported stop cause is the first event in time (for a candidate exit, `candidate-exit`, with the guard's resulting stop reported separately as `guard_stop`).

## Checks

- `tests/integration/test_shadow_simulation.py` (added to `tools/ci.py`): 6 tests, OK in about 24 s locally. The no-fault run makes 10,082 status polls (10,080 minute polls, the first poll at the start of collection and the finish's post-stop inspection), completes 5,852 pairs, launches one instance and cleans up; the observed-quota scenario stops with `provider_auth_or_quota`; a candidate exit at 60 h is the stop cause and the guard then stops with `observation_unavailable`; a production 429 on the 56th request (about 169 s) does not pre-empt a quota signal at 20 s and no request starts after the bound; a reader exit leaves the guard deciding until the operator stops within about a minute; a seeded run is deterministic.
- `tests/integration/test_shadow_supervisor.py`: unchanged, OK.
- Placement gate with `server2/config/tasks/ShadowSim2999.json`: PASS.
- Full matrix, 20 seeds per scenario: [baseline-master.json](baseline-master.json) (summary; the full per-seed report has SHA-256 `b473831cc8ebcde1902a86af1eee9dc3dae53293ced84ca204e607b8c90c04e1` and is retained locally).

## Baseline on master

| Scenario | Full runs /20 (8516c7d7) | Median hours (8516c7d7) | Evidence retrievable /20 | First stop cause on master |
| --- | --- | --- | --- | --- |
| `ideal` | 20 (20) | 168.0 (168.0) | 20 | `guard:collection_deadline` 20 |
| `observed-quota-at-3min` | 0 (0) | 0.05 (0.08) | 20 | `guard:provider_auth_or_quota` 20 |
| `shared-key-daily-429` | 0 (0) | 14.925 (14.93) | 20 | `guard:provider_auth_or_quota` 20 |
| `production-429-1e-4` | 8 (10) | 154.002 (168.0) | 20 | `guard:collection_deadline` 8, `reader:http-429` 12 |
| `production-transient-1e-3` | 5 (13) | 76.507 (168.0) | 20 | `guard:collection_deadline` 5, `reader:deadline` 15 |
| `poll-failure-1e-4` | 10 (5) | 168.0 (98.612) | 20 | `guard:collection_deadline` 10, `operator-stop` 10 |
| `poll-failure-1e-3` | 0 (0) | 11.734 (12.875) | 20 | `operator-stop` 20 |
| `sample-failure-1e-5` | 13 (14) | 168.0 (168.0) | 20 | `guard:collection_deadline` 13, `guard:observation_unavailable` 7 |
| `mac-sleeps-night-1` | 0 (0) | 14.0 (14.02) | 0 | `acquisition_failed` 20 |
| `operator-ip-change-day-3` | 0 (0) | 60.0 (60.025) | 0 | `acquisition_failed` 20 |
| `tx-observed-early-rate` | 0 (0) | 27.739 (27.749) | 20 | `guard:network_ceiling` 20 |
| `s3-measured-high` | 0 (0) | 45.0 (45.011) | 20 | `guard:s3_allowance` 20 |
| `candidate-exit-day-3` | 0 (—) | 60.0 (—) | 20 | `candidate-exit` 20 |
| `realistic-combined` | 0 (0) | 11.65 (10.784) | 11 | `acquisition_failed` 9, `guard:provider_auth_or_quota` 8, `operator-stop` 2, `reader:deadline` 1 |

## Differences from the 8516c7d7 run

The 8516c7d7 figures came from the draft simulator, which had three modelling defects, corrected here (the last two found in independent review of this PR, CX-SR1-001/002):

- **Shared clock.** Reader request durations advanced the clock shared with the operator and the guard, so a week lost about 4.9 hours of operator polls and guard samples (9,790 instead of 10,082 polls with no faults).
- **Time bound.** One reader step could complete requests that start after the bound, so a later reader result could pre-empt an earlier guard decision.
- **Reader exit.** A reader exit stopped the whole host model at once and skipped the guard decisions that the real host still makes until the operator stops the run.

Effects: every scheduled reader request is now made, so the production-error scenarios stop more often (`production-429-1e-4` 8/20 instead of 10/20). `production-transient-1e-3` gave 5/20 here; 60 further seeds (20-79) gave 32/60 full runs against an expected share of 0.557 for one timeout at 1e-4 over 5,852 production requests, so the 20-seed figure is a low draw, not a model effect. Stop times are taken where the event happens (`observed-quota-at-3min` 0.05 h instead of 0.08 h). `poll-failure-1e-4` 10/20 instead of 5/20 and `sample-failure-1e-5` 13/20 instead of 14/20 are within the spread of 20 seeds (expected survival 36 % and 55 %). `candidate-exit-day-3` is new. Unchanged: `ideal` 20/20; quota and shared-key scenarios 0/20; operator unreachable (asleep or address change) 0/20 with no retrievable evidence; transmit and S3 rate scenarios stop at the same hours; `realistic-combined` 0/20 with a median near 11 hours.

## Limits

Fault rates are not measurements; the export is judged by SSH reachability at the finish, not by building an archive; the log collector is a reported unit state only; operator process death and host reboot are not modelled; the reader's scheduling loop is re-implemented around the real `Ledger`.
