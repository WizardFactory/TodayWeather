# Plan: server2 log pipeline LP-2 (#2979)

One PR stacked on `feat/2977-lp5-log-iam` (PR #2985); branch `feat/2977-lp2-log-loss`.

Paths: `server2/deploy/logging/` (`status.py`, `units/server2-logs-status.{service,timer}`, `render.py` metrics endpoint and status unit, `units/server2-logs.service` start check, `install.sh`, `standin.py` fault switch, `linux_check.py` scenarios, `test_logging.py`), `server2/config/tasks/LogLoss2979.json`; documentation: guide, diagram, manual and capture, evidence, this intent/spec/plan.

| ID | User and goal | Steps | Expected | Failure path | AC | Check |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | Operator: logging trouble must not hurt the service | Stop the collector; break both destinations | Same responses, same stop time | — | AC1 | `linux_check` isolation |
| L2 | Operator: S3 outage | S3 fails >2 min; CloudWatch keeps working; collector restarts; S3 recovers | CloudWatch current; S3 later exact once, in order | Overrun if the journal rotates first | AC2 AC3 AC5 | `linux_check` outage |
| L3 | Operator: outage longer than the journal | Records rotate out before delivery | Overrun record with range; counted in status | — | AC4 | `linux_check` overrun |
| L4 | Operator: read loss | curl loopback counters; read status records | Counts per destination; behind while failing | Endpoint not reachable remotely | AC4 AC5 | manual step 7, `test_logging` |
| L5 | Reader: interpret gaps | Read the guide | Server vs collector vs overrun vs in-flight | — | AC6 | link and placement gates |
