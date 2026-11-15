# Plan: server2 log pipeline LP-6 (#2983)

One PR on `master`, after #2947 and #2971; branch `feat/2977-lp6-log-shadow`.

Paths: `server2/deploy/shadow/` (`coordinator.py` artifacts, units, install, `remote.py` receiver and retention stop, `state.py` cost model), `server2/deploy/logging/` (`render.py` and `status.py` unit-to-source map), `server2/tests/integration/test_shadow_supervisor.py`, `server2/deploy/logging/test_logging.py`, a Linux check for the shadow host under `server2/deploy/shadow/`, `server2/config/tasks/LogShadow2983.json`; documentation: shadow guide, logging guide, diagram, evidence, this intent/spec/plan.

| ID | User and goal | Steps | Expected | Failure path | AC | Check |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 | Operator: read the run's logs after the host is gone | Run, retain, clean up | Exported `logs/server2/<source>/…` objects for server, guard, reader, collector | Destination unreachable: records stay in the journal until it recovers or the host ends (loss bound as LP-4) | AC1 AC6 | Linux shadow check; guide |
| Q2 | Operator: find why the guard stopped | Provider answers 401 | Candidate's failing record and guard's `provider_auth_or_quota` record in the exported logs | — | AC2 | Linux shadow check |
| Q3 | Operator: supervision must not change | Install with collector; stop it; break the destination | Same stop decisions, deadlines, timeouts, watchdog | — | AC3 | offline tests; Linux shadow check |
| Q4 | Reviewer: nothing sensitive leaves | Synthetic values in env, URLs, bodies | None at the destination | — | AC4 | Linux shadow check |
| Q5 | Owner: cost and identity | Price the plan; change a collector file | Log items priced, total inside $35; install refuses | — | AC5 | offline tests |
