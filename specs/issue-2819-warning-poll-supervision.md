# E3b warning delivery polling specification

[Intent](../intent/issue-2819-warning-poll-supervision.md). Exact paths:
`server2/config/tasks/WarningPollSupervision2819.json`. Pre-merge only.

- WPS1: After the actual warning delivery poll task terminates successfully, errors, panics
  or is cancelled, its supervisor slot is released so a subsequent regular5s tick can
  start a new poll. Preserve incomplete failure reporting; do not replay failed/unknown sends.
- WPS2: Release only the matching warning task. Alarm/alert completion or panic must not
  release a still-active warning slot. Keep one existing JoinSet owner, normal interval/
  missed-tick policy, stop-first admission, minute guards and drain/claim/send semantics.
- WPS3: Demonstrate intended unchanged-runtime warning-panic Red, current recovery and
  healthy/error/unrelated-task controls, plus separate retained actual CLI/owned HTTP-S3
  functional evidence. Source/bin/fixture and owned-cleanup binding; no actual provider,
  device or production main qualification. Setup failures are not intended Red.
- WPS4: Exact placement/dependencies, current operator/architecture/selected evidence and
  final implemented-source Archify artifact/browser/visual, independent review and exact
  parent/current CI before pre-merge. No new readiness endpoint or full E3/S3/credential
  health, global/main/recovery/shadow/production completion; no merge/deploy authority.
