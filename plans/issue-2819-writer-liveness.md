# E3a writer availability execution plan

[Spec](../specs/issue-2819-writer-liveness.md), exact paths in
`server2/config/tasks/WriterLiveness2819.json`. Root uses the existing primary notebook.
Parent E1/E2 code/docs review PASS; parent CI still gates this unmerged stack.

1. Add public state tests only, on unchanged runtime: restore then confirmed normal drain
   must make readiness false; a controlled test-only OidSource panic after restore must
   also leave it false and retain existing storage errors. Reap/drain owned writers before
   assertions. Capture source/test/binary/log/exit; setup failures are not Red.
2. Add the existing mpsc sender-closed condition to ready(). No writer/body/queue ownership,
   accepting/quiesce, retry, deadline, storage or send-policy change. Run focused Green.
3. Preserve failed-restore and healthy/acknowledged-drain controls, plus full state, delivery
   and runtime-services tests. Check fmt/all-target Clippy/optimized main/test artifact,
   source projection and exact declaration/dependency boundaries.
4. Additional actual CLI execution uses a retained state integration executable's ignored
   owned-API child. It constructs the real PushService/router and HttpS3Transport against
   a Python loopback S3 peer, injects an actual writer panic via public OidSource, sends
   HTTP registration, observes unchanged POST-list200/[null] failed-item response, subsequent PUT500/storage-error
   and false availability, no
   acknowledged record/journal, then retires its HTTP listener and owned peer. No Firebase,
   worker loop, actual provider, full main or public readiness endpoint is constructed.
   This is distinct from focused regression and records compile-time checkout requirements.
5. Update existing operator/architecture/native-verification/selected evidence. This is a
   bug fix, no new API endpoint/UI/feature; keep old PDFs labelled historical, no new PDF.
   Verify current docs/links. Commit verified code/manual with reused current diagram
   context, then pin final diagram to that implemented commit; regenerate artifact/browser
   and inspect actual capture, make diagram-only commit before initialpush/review.
6. Independent current review, selected corrections, exact parent/current CI and final
   authority/remote/coupling/source gate before pre-merge. No merge/auto/queue or production.

Normal close may precede completed pending drain. A readiness false result is never an
assertion that a timeout/abort completed. Full E3 endpoint/S3/credential-source health
remains open, alongside all remaining#2819/global/recovery/shadow gates.

Oracle refinement before runtime edit: first normal-exit regression was intended; the
controlled panic was exercised but POST push-list retains legacy200/[null] per-item
failure, not500. routes::list333-335 explicitly maps store errors to null. Capture
readiness after actual panic before cleanup, then check a valid token-update PUT returns
500/STORAGE_FAILURE. Drain/reap before final assertions. Original mixedfailure is not
two intended readiness Reds; rerun unchanged runtime after correcting only test expectations.
