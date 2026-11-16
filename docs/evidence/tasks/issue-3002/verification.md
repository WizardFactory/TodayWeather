# SR-4 verification: one cumulative cost ceiling (#3002)

Revision `f785d4ad`, stacked on SR-3 (PR #3015) over master. Run on 2026-11-16: macOS with Python 3.11.15 for the offline checks; a disposable Lima VM (Ubuntu 24.04 aarch64) for the Linux check. Nothing contacted AWS, a provider or production.

## Behaviour

- **Cost policy (schema 2).** Frozen tariffs plus `ceiling_usd` (the cumulative ceiling, USD 300 by the owner's decision of 2026-11-14), `prior_spend_usd` (recorded spend of earlier attempts) and `finish_reserve_usd` (at least the floor computed from the tariffs: 2 GiB evidence export, 9,000 export reads and two more host hours). A policy whose prior spend plus reserve reaches the ceiling is refused.
- **Estimate.** Every guard sample computes the accrued estimate from measured counters: prior spend, elapsed hours × hourly (instance, IPv4, storage), CPU seconds × vCPU-hour price, S3 reads and writes used (allocation − remaining), bytes transmitted since the origin, a log-PUT bound (four sources, one object per 50 s) and paid units admitted × their price. The guard stops with `cost_ceiling` when estimate + reserve ≥ ceiling, and records `cost` (`accrued_usd`, `limit_usd`) in its decision (schema 6) at every valid sample.
- **Removed stops.** `aws_accrued_cost`, `aws_projected_cost`, `network_ceiling` and `s3_allowance`. An exhausted S3 allocation or paid grant is refused by the server and recorded; a remaining count above the allocation is broken accounting (a missed observation). Kept: disk reserve, network counter reset, CPU accounting, storage authorization, binding, listener, deadline, clock rollback, observation loss.
- **Allocations.** Paid grants must fit the ceiling minus prior spend and reserve (was USD 5). The run's S3 grant follows the server's parse caps (900,000 reads and writes, 2 GiB PUT bytes); sizing is SR-6.

## Checks

- Red first (retained locally): cost, paid-policy, guard and bundle tests 4 failures and 25 errors before the change. Green with Python 3.11.15: `test_shadow_supervisor.py` and `test_shadow_simulation.py` OK (after merging SR-3's review fixes as well).
- Worked example (guide, Cost ceiling): 24 h, 3,600 CPU s, 10,000 reads, 5,000 writes, 2 GB sent, USD 1.50 paid, prior USD 10 gives USD 12.734193 against a limit of USD 295; a test recomputes it independently of `estimate_cost`.
- Linux check (`server2/deploy/shadow/linux_check.py`, six scenarios, server2 SHA-256 `80e5bcb7…`, the SR-3 VM build; SR-4 changes no Rust code): provider-rejection 27/27, storage-authorization 15/15, config-change 12/12, frozen-guard 11/11, collector-broken 6/6, tampered 2/2; overall PASS. Report: [linux-check.json](linux-check.json).
- Placement gate with `server2/config/tasks/ShadowCeiling3002.json` and artifact policy: PASS.

## Simulation against SR-3

20 seeds per scenario at `f785d4ad` (Python 3.11.15, one process per scenario); summary [simulation.json](simulation.json) (full per-seed report SHA-256 `98072148ed16ea46954b07bd46d2416d135dc03f3d55b830f54d24ee11f6bc2d`, retained locally). SR-3 values are from `198e3de2`.

| Scenario | Full runs /20 (SR-3) | Median hours (SR-3) | Evidence retrievable /20 (SR-3) | First stop cause |
| --- | --- | --- | --- | --- |
| `ideal` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `observed-quota-at-3min` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `shared-key-daily-429` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `production-429-1e-4` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `production-transient-1e-3` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `poll-failure-1e-4` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `poll-failure-1e-3` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `sample-failure-1e-5` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `mac-sleeps-night-1` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |
| `operator-ip-change-day-3` | 20 (20) | 168.0 (168.0) | 0 (0) | `guard:collection_deadline` 20 |
| `tx-observed-early-rate` | 20 (0) | 168.0 (27.739) | 20 (20) | `guard:collection_deadline` 20 |
| `s3-measured-high` | 20 (0) | 168.0 (45.0) | 20 (20) | `guard:collection_deadline` 20 |
| `candidate-exit-day-3` | 0 (0) | 60.0 (60.0) | 20 (20) | `candidate-exit` 20 |
| `cost-ceiling` | 0 (—) | 114.178 (—) | 20 (—) | `guard:cost_ceiling` 20 |
| `storage-auth-broken-role` | 0 (0) | 3.0 (3.0) | 20 (20) | `guard:s3_authorization` 20 |
| `realistic-combined` | 20 (20) | 168.0 (168.0) | 20 (20) | `guard:collection_deadline` 20 |

The transmit and S3 rate scenarios (`tx-observed-early-rate`, `s3-measured-high`) now reach 168 hours in 20 of 20 seeds; the new `cost-ceiling` scenario (20 GB/h transmitted, about USD 2.5/h) stops with `cost_ceiling` at about 114 hours. Remaining: the address change still loses the evidence (SR-5); a candidate exit ends the run by design; the broken role stops on storage authorization (SR-3).
