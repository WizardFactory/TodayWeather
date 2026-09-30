# PR review corrections

Source: [PR #2652 review](https://github.com/WizardFactory/TodayWeather/pull/2652#issuecomment-5915242450), reviewed against `84bd6106`; correction date 2026-10-01.

| Finding | Response |
| --- | --- |
| New-branch history cost | Exclude commits reachable from the destination remote’s local tracking refs for new pre-push refs; always check the tip and unpublished intermediate commits. Keep explicit CI ranges unchanged. Share an object-ID blob cache across snapshots. |
| Reports in other checkouts | [Migration guidance](../../README.md#updating-another-clone-or-worktree) warns that pull/merge/rebase removes old tracked paths and provides external archive recovery without staging or overwriting local files. |
| Required branch check | Deferred to administrator configuration. No branch rules or permissions changed; the policy states that hooks/CI alone do not enforce merging. |
| Link scan scope | [Retention policy](../../../development/artifact-retention.md) lists the exact covered directories and root documents, plus the package-document exclusions. No broader coverage is claimed. |
| Shared-skill follow-up | Keep #2645 open for shared-skill alignment and actual Codex/Claude execution; the [upgrade guide](../../../development/skill-retention-upgrade.md) remains the scoped deliverable. No new issue or global skill change is included in this correction. |
| 533 vs 652 | Evidence index now distinguishes 533 SDLC files from 119 other reports, totaling 652. |
| Commit identity | Use the authenticated account’s GitHub noreply identity for the correction commit; preserve the existing published commit without rewriting history. |

Validation: 19 regression tests and seven actual local-hook scenarios passed. New regressions first reproduced remote-history overchecking and duplicate blob reads. The new-branch smoke pushed to an isolated bare remote and checked only its unpublished snapshot; intermediate unpublished violations and selected-tip checks remain covered. External archive recovery restored all 652 baseline hashes without changing the index or existing local reports. No production, branch-setting, global-skill or merge operation is involved. The original reviewer’s comments are preserved; this is an implementation response, not a claim of their re-approval.
