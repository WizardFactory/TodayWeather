# SR-1 verification: shadow supervisor run simulation (#2999)

Revision: master `434ec250` (includes #2947, #2971 and #2977) plus this change; no supervisor, server or reader code is modified. Run on macOS, Python 3.11, 2026-11-15. Nothing here contacted AWS, a provider or production.

## What runs

`server2/tests/integration/shadow_simulation.py` steps the real `provision.lifecycle` (with its SQLite journal and the offline `ProvisionCloud` fixture), `guard.evaluate` with `estimate_cost`, and `paired_read.Ledger` through a 168-hour run: one operator status poll per minute, one guard sample every 10 seconds and the live 56-case reader schedule (5,852 attempts per origin). SSH, the host's samples and HTTP outcomes are modelled; fault rates are scenario inputs.

## Host model

Taken from the generated units (`coordinator.py` `host_units`; every unit is `Restart=no`):

| Event | Effect in the model | Source |
| --- | --- | --- |
| Candidate exits (any reason) | Reader and guard stop; the guard makes no further decision and its last decision keeps `stop: null` | candidate `ExecStopPost` stops reader and guard |
| Guard decides to stop | Candidate and reader stop at that guard step | `guard.py` `report_stop`, guard `ExecStopPost` |
| Reader exits on its own terminal state | Only the reader stops; candidate and guard keep running until the operator's next poll sees the reader inactive and stops the run | reader has `BindsTo` and no stop hook |
| Operator stop | All three stop, then the log collector | `remote.py` stop command |
| Log collector (#2977) | No relation to the three; reported as a fourth unit, active until the operator's stop | collector unit |

Events are applied in time order. A reader request has a start event (the attempt is reserved in the ledger) and a completion event (its result is applied); a request in flight when its unit stops stays pending. The reader's request durations advance its own clock, not the operator's. The reported stop cause is the first event in time; the guard's own last decision is reported separately as `guard_stop`.

## Checks

- `tests/integration/test_shadow_simulation.py` (added to `tools/ci.py`): 8 tests, OK in about 24 s locally.
  - No faults: 10,082 status polls (10,080 minute polls, the first poll at the start of collection and the finish's post-stop inspection), 5,852 completed pairs, one instance, cleanup complete.
  - Observed quota signal: stops with `provider_auth_or_quota` within minutes; a guard stop ends the group at its step (20 s) and no request starts later.
  - Candidate exit at 60 h: stop cause `candidate-exit`, no guard step after the exit, `guard_stop` null, operator finishes within a minute.
  - A production 429 on the 56th request (about 169 s) does not pre-empt a quota signal at 20 s; no request starts after the bound.
  - A result takes effect only at completion: a request starting at 2.5 s and completing at 4 s is pending at 3 s, and a candidate exit at 3 s is then the cause.
  - A reader exit leaves the guard deciding until the operator stops within about a minute.
  - A seeded run is deterministic.
- `tests/integration/test_shadow_supervisor.py`: unchanged, OK.
- Placement gate with `server2/config/tasks/ShadowSim2999.json`: PASS.
- Full matrix, 20 seeds per scenario: [baseline-master.json](baseline-master.json) (summary; the full per-seed report has SHA-256 `62a4768ac443be8ce29d3892a76bc9c2e0a92d9ed72b549738b375ec5f21330b` and is retained locally).

## Baseline on master

| Scenario | Full runs /20 (8516c7d7) | Median hours (8516c7d7) | Evidence retrievable /20 | First stop cause on master |
| --- | --- | --- | --- | --- |
| `ideal` | 20 (20) | 168.0 (168.0) | 20 | `guard:collection_deadline` 20 |
| `observed-quota-at-3min` | 0 (0) | 0.05 (0.08) | 20 | `guard:provider_auth_or_quota` 20 |
| `shared-key-daily-429` | 0 (0) | 14.925 (14.93) | 20 | `guard:provider_auth_or_quota` 20 |
| `production-429-1e-4` | 8 (10) | 154.002 (168.0) | 20 | `guard:collection_deadline` 8, `reader:http-429` 12 |
| `production-transient-1e-3` | 5 (13) | 76.507 (168.0) | 20 | `guard:collection_deadline` 5, `reader:deadline` 15 |
| `poll-failure-1e-4` | 12 (5) | 168.0 (98.612) | 20 | `guard:collection_deadline` 12, `operator-stop` 8 |
| `poll-failure-1e-3` | 0 (0) | 12.767 (12.875) | 20 | `operator-stop` 20 |
| `sample-failure-1e-5` | 13 (14) | 168.0 (168.0) | 20 | `guard:collection_deadline` 13, `guard:observation_unavailable` 7 |
| `mac-sleeps-night-1` | 0 (0) | 14.0 (14.02) | 0 | `acquisition_failed` 20 |
| `operator-ip-change-day-3` | 0 (0) | 60.0 (60.025) | 0 | `acquisition_failed` 20 |
| `tx-observed-early-rate` | 0 (0) | 27.739 (27.749) | 20 | `guard:network_ceiling` 20 |
| `s3-measured-high` | 0 (0) | 45.0 (45.011) | 20 | `guard:s3_allowance` 20 |
| `candidate-exit-day-3` | 0 (—) | 60.0 (—) | 20 | `candidate-exit` 20 |
| `realistic-combined` | 0 (0) | 11.65 (10.784) | 11 | `acquisition_failed` 9, `guard:provider_auth_or_quota` 8, `operator-stop` 2, `reader:deadline` 1 |

## Differences from the 8516c7d7 run

The 8516c7d7 figures came from a draft simulator with modelling defects that are corrected here (the last three found in independent review of this PR, CX-SR1-001 to -003):

- **Shared clock.** Reader request durations advanced the clock shared with the operator and the guard, so a week lost about 4.9 hours of operator polls and guard samples (9,790 instead of 10,082 polls with no faults).
- **Time bound and completion.** A reader step could start requests after the bound and applied results before the request completed, so a later reader result could pre-empt an earlier event.
- **Reader exit.** A reader exit stopped the whole host model at once and skipped the guard decisions the real host still makes until the operator stops the run.
- **Candidate exit.** The guard kept evaluating after a candidate exit, although the candidate's stop hook stops it.

Effects: every scheduled reader request is now made, so the production-error scenarios stop more often (`production-429-1e-4` 8/20 instead of 10/20). `production-transient-1e-3` gave 5/20 here; 60 further seeds (20-79) gave 32/60 full runs against an expected share of 0.557 for one timeout at 1e-4 over 5,852 production requests, so the 20-seed figure is a low draw, not a model effect. Stop times are taken where the event happens (`observed-quota-at-3min` 0.05 h instead of 0.08 h). `poll-failure-1e-4` 12/20 instead of 5/20 and `sample-failure-1e-5` 13/20 instead of 14/20 are within the spread of 20 seeds (expected survival 36 % and 55 %). `candidate-exit-day-3` is new. Unchanged: `ideal` 20/20; quota and shared-key scenarios 0/20; operator unreachable (asleep or address change) 0/20 with no retrievable evidence; transmit and S3 rate scenarios stop at the same hours; `realistic-combined` 0/20 with a median near 11 hours.

## Limits

Fault rates are not measurements; the export is judged by SSH reachability at the finish, not by building an archive; the log collector is a reported unit state only; the guard's watchdog, operator process death and host reboot are not modelled; the reader's scheduling loop is re-implemented around the real `Ledger`; events at the same instant are applied reader first, then candidate exit, then the guard step.
