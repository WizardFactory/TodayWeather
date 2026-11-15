# Plan: server2 log pipeline LP-1 (#2978)

Inputs: [intent](../intent/issue-2978.md), [spec](../specs/issue-2978.md), #2977 decisions. One PR, base `master`, branch `feat/2977-lp1-log-collector`.

## Paths

- `server2/deploy/logging/` — `render.py`, `install.sh`, `collector.json`, `units/`, `standin.py`, `test_logging.py`, `linux_check.py`.
- `server2/tools/ci.py` (run `test_logging.py`), `server2/.env.example`, `server2/config/tasks/LogPipeline2978.json`.
- Outside (documentation): `docs/operations/server2-logging.md`, `docs/architecture/diagrams/server2-logging.{json,html}`, `docs/evidence/tasks/issue-2978/verification.md`, this intent/spec/plan.

## User scenarios

| ID | User and goal | Steps | Expected | Failure path | AC | Check |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | Operator keeps logs local only | Install; leave `SERVER2_LOG_SINKS` unset; start server2 | Journal holds all output; collector skipped; nothing leaves the host | — | AC1 | `linux_check` local-only |
| U2 | Operator ships full stream to S3 | Set `s3`, prefix; restart collector; serve traffic | S3 objects hold exactly the `info`+ server lines and a start record, keys in contract | S3 down: covered by LP-2 | AC1 AC2 AC5 | `linux_check` s3-only |
| U3 | Operator searches warnings in CloudWatch | Set `cloudwatch`, group; serve traffic | Stream holds exactly `warn`+ server lines and a start record | Missing group: no creation | AC1 AC2 AC5 | `linux_check` cloudwatch-only |
| U4 | Operator runs both with different levels | Set `local,s3,cloudwatch`, levels `debug`/`error`; burst | Each destination exact for its level; readiness line local only | — | AC1 AC2 AC4 AC5 | `linux_check` all-destinations |
| U5 | Operator mistypes a setting | Set an unknown destination/level or omit the prefix | Collector failed, message names variable without value; server serves `/health` | No restart loop | AC3 | `linux_check` invalid-*, `test_logging` |
| U6 | Security reviewer checks key exposure | Put provider keys in `.env`; run U4 | Collector environment/config/destinations hold no `.env` secret or synthetic value | — | AC4 | `linux_check`, `test_logging` |
| U7 | Reviewer checks the choice and docs | Read guide | Version, hashes, licence, feasibility answers, phases, queries | — | AC6 AC7 | link check, placement gate |

## Verification

Offline: `python3 server2/deploy/logging/test_logging.py` (CI). Integrated: `linux_check.py` in a disposable Lima Ubuntu 24.04 VM with the retained x86_64 server2 binary (Rosetta) and the pinned aarch64 collector. Placement: `server2/tools/check_placement.py` with the task declaration. Diagram: Archify finalize after the implementation commit.
