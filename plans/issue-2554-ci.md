# Plan
Owner /root; reuse .planning/2026-09-24-issue-2554 notebook (CI follow-up phase).
1. Add configuration evaluator first; expected failure when workflow absent. Cover PR/push wiring, Node/UTC, fail-fast behavior, minimal installation and unprivileged boundaries.
2. Add workflow and README. Validate YAML/configuration and exercise shell-step order with controlled successful/failing commands.
3. Execute exact configured shell commands locally with real Node/npm and temporary install; observe 43 +36 passes. Independent agent verifies configuration/commands without editing repo.
4. Commit/push only CI change and its evidence; update PR #2556 and observe check results. No merge/deploy or permission-setting change. If hosted run needs external approval, report exact blocker after completing publication.
Risk: missing fork-run permission or hosted action availability. Preserve existing Node6 Travis; reject adding node:test to incompatible legacy job. Rollback is removing the isolated workflow. Scope changes no weather response semantics.
