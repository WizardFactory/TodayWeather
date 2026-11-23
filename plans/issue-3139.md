# Server2 PR CI in minutes

[Issue #3139](https://github.com/WizardFactory/TodayWeather/issues/3139) owns the outcome. #3099 and #3129 cut the median PR wait from 68.8 to 22.9 minutes. The goal is now a PR wait measured in single-digit minutes.

## Measured starting point

Run 45077032237 (PR #3138, 2026-11-22), with the 4-vCPU public-repository runner:

| Job | Minutes | Dominant step |
|---|---:|---|
| `rust` | 27.3 | `cargo test --workspace`: compile about 4, `tests/domestic.rs` about 12–15 |
| `python` | 25.5 | `test_shadow_simulation.py` 18.6, `test_shadow_supervisor.py` 5.0 |
| `gnu` | 10.2 | release builds about 5, smoke and replays |
| `musl` | about 11 | cold musl release build and artifact verification |

Locally, `test_shadow_simulation.py` took 510 s, and seven of its 18 tests took 37–124 s each.

## Decisions (AK, 2026-11-23)

- Pull requests no longer build `server2-linux-musl-verified`. Pushes to `master` and manual runs build, re-check and publish it.
- `rust` and `gnu` restore a Cargo cache that only `master` saves.

## Change

| Job | Event | Work |
|---|---|---|
| `placement` | all | Unchanged. |
| `python` | all | Every offline Python suite except the shadow simulation. |
| `shadow` × 4 | all | `test_shadow_simulation.py`, split by test name. `tools/ci.py` assigns the seven heavy tests to balance the shards near 130 s locally, and the last shard also takes every unlisted test. |
| `rust` × 3 | all | `cargo nextest run --partition count:k/3`, plus `cargo test --doc`, `test_placement.py` and `test_ci.py` in shard 1. |
| `gnu` | all | Unchanged commands, with the release Cargo cache. |
| `musl` | push, manual | Unchanged musl commands and the candidate upload from #3129. |
| `foundation` | all | Fails unless every required job succeeded. On pull requests it also requires `musl` to be skipped. On a push or manual run it requires `musl` to succeed, then promotes and publishes the verified artifact. |

The local default `tools/ci.sh` keeps the serial inventory, including `cargo test --workspace` and the whole simulation file. `tools/test_ci.py` proves that the hosted stages run every serial command exactly once, except those two. The nextest partitions replace the workspace test run, and the simulation shards cover every simulation test exactly once. nextest runs every test in its own process. It lists the same 1,428 tests that `cargo test` runs, and doc tests run separately.

## Verification and adoption

1. `test_ci.py`, `test_placement.py` (workflow pin and mutations) and placement pass. nextest partitions pass locally.
2. On the PR, every hosted job passes, and `foundation` succeeds without building `musl`.
3. Interleave at least three pairs against a control branch with the same source and the #3129 workflow. Report the PR wait, each job's duration and the summed runner minutes. Adopt only with a lower median.
4. After merge, the first `master` push must publish a verified artifact that `promote_artifact.py` accepts.

Revert the PR to restore the #3129 workflow.
