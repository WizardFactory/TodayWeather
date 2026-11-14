# Plan: server2 log pipeline LP-4 (#2981)

One PR on `master` (after LP-3); branch `feat/2977-lp4-log-spot`.

Paths: `server2/deploy/logging/` (`spot_watch.py`, `units/server2-logs-watch.service`, `status.py` interruption drain and read units, `render.py` read units and 50 s S3 window, `install.sh`, `boot.py`, `imds_standin.py` notice route, `standin.py` fsync and store times, `linux_check.py` interruption and idle scenarios, `linux_reboot_check.py` shutdown order and power-off variant, `test_logging.py`), `server2/config/tasks/LogSpot2981.json`; documentation: guide, infrastructure doc, diagram, manual step 9 and capture, evidence, this intent/spec/plan.

| ID | User and goal | Steps | Expected | Failure path | AC | Check |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | Operator: logs survive a Spot interruption | EC2 announces an interruption | Notice record first; server stops, then collector; every server record arrives; within 80 s | Destination failing: drain gives up after 10 s, flush sends the rest | AC1 AC2 | `linux_check` spot-interruption |
| S2 | Operator: normal shutdown keeps the order | `systemctl poweroff` | Server stopped before the collector stops; final records delivered | — | AC3 | `linux_reboot_check` after (order) |
| S3 | Operator: interruption without notice | Power lost | Missing records younger than 60 s (S3) / 10 s (CloudWatch) | — | AC4 | `linux_reboot_check` before-poweroff/after; `linux_check` delivery timing |
| S4 | Operator: On-Demand or no metadata | Watcher starts | Idle line, success, no stop | — | AC5 | `linux_check` watcher idle, `test_logging` |
| S5 | Reader: understand the sequence | Read guide | Sequence, budget, loss without notice | — | AC6 | link and placement gates |
