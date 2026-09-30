# Plan: issue 2653
Consumes [intent](../intent/issue-2653.md) and [spec](../specs/issue-2653.md). Owner: Codex; endpoint pre-merge.

1. Author approval/identity/backup/smoke workflow diagram with Archify; validate/deliver/browser/visual inspect.
2. Add regression tests for release identity/approval restrictions and failed backup ordering before implementation.
3. Add GitHub release guard and private snapshot tool; extend uploader with machine-readable exact invalidation receipt without changing default dry-run. Add manual-only guarded workflow with scoped permissions and revalidation.
4. Document naming/template/operator activation/least privilege/rollback/status and backend decision. Link runbook and architecture.
5. Run targeted and full web tests, typecheck/build, actionlint/content checks and separate local CLI smoke. No application server/collectors.
6. Independent Claude verifier reads exact artifacts/diff, runs checks and produces a distinct report. Commit tested content, enforce artifact policy, push branch/create PR, observe CI, eligible alternate-provider PR review and fix/review loop.
7. Reobserve exact head/base/CI/remote protections/auto-merge/queue and retain merge-ready receipt; stop without merge.

Blast radius: new opt-in manual deployment only; existing web CI must include new workflow path. Riskiest parts: environment absent/bypass and artifact mismatch after approval, backup durability and cancellation. Alternative rejected: release-published/tag automatic multi-target deploy (ambiguous and unnecessary writes). Rollback of code is revert; production rollback remains operator-approved existing runbook using durable private snapshot. Missing AMI guide blocks future backend automation, not this web workflow.
