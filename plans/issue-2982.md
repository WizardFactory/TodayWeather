# Plan: server2 log pipeline LP-5 (#2982)

One PR stacked on `feat/2977-lp1-log-collector` (PR #2984); branch `feat/2977-lp5-log-iam`.

Paths: `server2/deploy/logging/aws/` (three templates), `server2/deploy/logging/aws_templates.py`, `server2/deploy/logging/test_logging.py`, `server2/deploy/logging/linux_check.py` (allowed actions from the template), `server2/deploy/staging/prerequisites.json`, `server2/config/tasks/LogIam2982.json`; documentation: `docs/operations/server2-logging.md`, `docs/operations/server2-logging-pipeline.pdf` and its source/captures, `docs/evidence/tasks/issue-2982/verification.md`, this intent/spec/plan.

| ID | User and goal | Steps | Expected | Failure path | AC | Check |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | Owner prepares AWS for the destinations | Render templates for bucket/prefix/group/region/account; read the current lifecycle; apply; read back | Three files without placeholders; commands in the guide | Prefix inside a weather prefix or bad account → renderer exits 2 and writes nothing | AC1 AC2 AC4 | `test_logging` AwsTemplatesTest, manual step 6 |
| P2 | Reviewer confirms least privilege | Run the offline tests | Any broader grant or unsafe lifecycle fails | — | AC1 AC2 | `test_logging` |
| P3 | Operator confirms the collector needs nothing more | Run the integration check | Only template actions used | Extra action → check fails | AC3 | `linux_check` |
| P4 | Reader finds the retention values | Read the guide and prerequisites | 30/90 days recorded, not provisioned | — | AC4 AC5 | test, link check, placement |

Verification: offline tests (CI), integration check in the disposable VM, placement and artifact policy. Real IAM evaluation needs AWS and stays a limitation.
