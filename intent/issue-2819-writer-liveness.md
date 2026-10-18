# E3a push writer availability

Continue [#2819](https://github.com/WizardFactory/TodayWeather/issues/2819) before seven-day
shadow. A restored push state must not report writable availability after its actual writer
receiver closes or exits. Reuse the existing writer channel; do not add a monitor, owner,
mode, retry or new public endpoint. Keep pending-command drain, legacy HTTP storage-error
contracts, durable state and one-shot delivery semantics unchanged.

This is the writer portion of E3, not complete readiness. A readiness endpoint covering
restore/writer/S3/credential source remains separate and open. Warning owner behavior must
be checked against C5, not the old issue prose. No full E3/global/main/recovery/shadow claim.

Exact paths and document exceptions are declared in `server2/config/tasks/WriterLiveness2819.json`
before edits. Parent is unmerged E1/E2 PR2832 at938e5ba9, whose current source/docs review
passes while CI remains pending. Root uses the existing primary execution notebook.
Authorized endpoint is pre-merge only: scoped tests/smoke/commit/push/PR/review/CI and issue
records, no merge/queue, cloud mutation/deploy, live provider/device or permission change.
