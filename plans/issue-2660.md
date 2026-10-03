# Policy evidence reconciliation plan

Inputs: [intent](../intent/issue-2660.md), [spec](../specs/issue-2660.md).
Execution notebook: named issue-2660 plan, owner root; local generated records stay ignored.

1. Preserve the four local operating-document edits; reconcile owner/period decisions
   and source claims against base e0b126c8. Add canonical intent/spec/plan only.
2. Check the policy/evidence map, storage-specific controls, raw log/prefill gaps and
   final-candidate scenarios; avoid treating standards as operational enforcement.
3. Validate all changed Markdown local targets, retained nine HTML draft sources,
   git whitespace and prospective seven-file scope. Renew the actual staged artifact
   check, then validate actual outgoing commits after commit and before push.
4. Create the PR to master, record a concise issue update, run/observe applicable CI,
   then obtain independent medium/auto PR review via configured provider discovery.
   Apply author-selected fixes and renew affected checks/review; at most ten attempts
   per stage. Check actual head/base and automation before final readiness.

## User scenarios

- S1 (AC1): release operator reads all four operating docs after the recorded AK answers;
  compare owner and five numeric periods; each distinguishes approval from enforcement.
  Failure: any stale proposed-only status or implied final policy/configuration approval.
- S2 (AC2): deletion operator selects the deployed store before using the procedure;
  compare Mongo/SQLite/S3 descriptions to source, follow setting removal and persistence;
  expect metadata/version/worker caveats and identity verification. Failure: treating a
  setting DELETE, token/UUID lookup or uninstall as full authenticated erasure.
- S3 (AC3): reviewer opens all maintained links and matches map sections to nine drafts,
  reads final-candidate scenarios, then checks the exact PR candidate/CI/review evidence.
  Failure: broken paths, unverified runtime claims or pre-merge with automation armed.

Prerequisites: base source, public issue decisions and no customer data. Document checks
exercise S1–S3. Physical scenarios P01–P07 in the evidence map are future release checks,
not outcomes promised by this PR. No collector/service startup or production smoke.

## Risk, alternative and rollback

The riskiest change is an overstatement of expiry/deletion or legal approval. Rejected:
marking the issue complete merely because sources are committed and user-selected
periods exist. The blast radius is documentation; revert the scoped commit to roll back.
No app manual/PDF or Archify regeneration is required. Final PR comments retain the
actual test/CI/review receipts without recursive evidence-only commits.
