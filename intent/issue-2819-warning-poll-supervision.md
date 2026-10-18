# E3b warning delivery polling ownership

Continue [#2819](https://github.com/WizardFactory/TodayWeather/issues/2819) before seven-day
shadow. A panicked warning delivery job must not permanently suppress future scheduled
polling. Track the actual task owned by the existing JoinSet; unrelated alarm/alert failures
must not release the warning slot. Keep stop/drain, one-shot claims and no automatic retry
of failed or unknown sends. This is scheduling recovery, not send replay.

C5's source acquisition lane is a separate owner. E3a writer availability remains a separate
unmerged parent. No full E3 readiness endpoint, S3 or credential-source health is claimed.
Exact implementation/test/document exceptions are declared before edits in
`server2/config/tasks/WarningPollSupervision2819.json`. No new dependencies or legacy asset.
Pre-merge only: tests/smoke/commit/push/PR/review/CI, no merge/queue/cloud/deploy/live sends.
