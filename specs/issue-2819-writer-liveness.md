# E3a writer availability specification

[Intent](../intent/issue-2819-writer-liveness.md), [#2819](https://github.com/WizardFactory/TodayWeather/issues/2819).
Paths: `server2/config/tasks/WriterLiveness2819.json`. Pre-merge only.

- WL1: Public PushService::ready is true only after successful state restore while the
  existing writer receiver is open. It is false after confirmed normal close/exit or actual
  panic/drop. Failed/uncompleted restore stays false. Receiver close can precede completion
  of pending drain; false availability does not claim that writer shutdown completed.
- WL2: Keep the same method signature and existing writer/channel ownership. No monitor,
  new mode/flag, queue/retry/deadline change, state rewind or send-policy change. Do not
  include process accepting/quiesce in this shared state predicate. Pending writer commands
  retain existing drain semantics; dead writer mutations retain existing storage-error replies.
- WL3: Demonstrate intended unchanged-runtime normal-exit and controlled-panic readiness Red,
  then current regressions plus a distinct actual API/owned-S3 functional invocation with
  source/executable binding and explicit cleanup. Existing state/delivery/runtime neighbors
  verify HTTP/durable/admission compatibility. No actual providers, accounts or device sends.
- WL4: Exact paths, no runtime legacy dependency/new manifest, maintained operator/architecture
  and actual current independent review plus parent/current CI before pre-merge. Full E3
  readiness endpoint, S3/credential-source health and global/main/full-bundle/shadow/production
  remain open. No merge/auto/queue/deploy authority.
