# Plan: server2 log pipeline LP-3 (#2980)

One PR on `master`; branch `feat/2977-lp3-log-boot`.

Paths: `server2/deploy/logging/` (`render.py` identity and backlog plan, `status.py` backlog drain and age, `boot.py` user-data generator (pinned commit and file hashes), `imds_standin.py`, `standin.py` key ID and stream persistence, `linux_check.py` IMDS credentials and two scenarios, `linux_reboot_check.py`, `linux_fresh_check.py`, `test_logging.py`), `server2/config/tasks/LogBoot2980.json`; documentation: guide, diagram, evidence, this intent/spec/plan.

| ID | User and goal | Steps | Expected | Failure path | AC | Check |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | Operator: a new instance ships logs unattended | Generate user data with `boot.py`; start an instance with it; release procedure installs server2 | Collector installed, started, ships from the first record; no key on the host | Invalid setting or files differing from the commit: `boot.py` refuses, nothing written; a changed download: the boot configuration stops | AC1 AC6 | `linux_fresh_check`, `test_logging` BootConfigTest |
| B2 | Operator: scale out or replace | Two instances, same user data, same hour | Disjoint streams/keys, both complete | — | AC2 | `linux_check` instance-replacement |
| B3 | Reader: which instance and boot | Read `collector.started` | Instance, boot, life cycle, version, destinations | No metadata: machine ID, life cycle `unknown` | AC3 | `linux_check` delivery, `test_logging` |
| B4 | Operator: Spot with local only | Start the collector with `local` on Spot | Warning record at start | On-Demand: no warning | AC4 | `linux_check` spot warning |
| B5 | Operator: reboot during an S3 outage | S3 fails; reboot; S3 recovers | Previous boot's records under its own names, new boot's under the new; exactly once; backlog cleared | Abrupt stop: bounded repeats (documented) | AC5 | `linux_reboot_check` |
| B6 | Operator: unattended instance with a rejected setting | Read the guide | Knows the message is only in the local journal and nothing ships | — | AC7 | link and placement gates |
