# Independent verification follow-up — repository artifact cleanup

Date: 2026-09-30. Reviewer: separate delegated verification context `/root/verify_reports_cleanup`; not the implementation author. Endpoint: local. Verdict: **PASS** for the corrected candidate identified below. All F1–F4 findings from the initial report are resolved; no mandatory finding remains open.

## Verified candidate

- Baseline: `a5fdde1fb5bf0d84a4af7aac8815b3690a57a8c2`.
- Identity: `a5fdde1f-reports-cleanup-v2`.
- SHA-256 of `git ls-files --stage -z`: `fdfe20282042c86a253670bc6eb35c923a0f4dfa677af760b06b94fb565f2284`.
- Independently measured this digest before and after verification. The author's clean fixture had the same indexed entries. No unstaged changes were reported by `git diff --name-only`; `git diff --cached --check` passed.
- Read candidate-v2, build-v2, self-verification-v2, test-results-v2 and clean-snapshot-v2 records; inspected actual revised checker, regression tests, six probe command headers/metadata, and documentation links.
- The initial report is preserved byte-for-byte in `docs/evidence/tasks/reports-cleanup/independent-verification-initial.md`, verified with `cmp` against `/private/tmp/reports-cleanup-independent-verification-v1.md`. Its original CHANGES_REQUIRED verdict remains historical rather than being overwritten.

## Finding dispositions

| ID | Original severity / disposition | Resolution and independent evidence | Final disposition |
| --- | --- | --- | --- |
| F1 | MEDIUM / Must Fix | `resolve` rejects `file:` URIs. Markdown inline, reference-style Markdown and uppercase HTML URI regressions pass. The original independent local-file-URI reproducer now rejects the staged link. | CLOSED |
| F2 | MEDIUM / Must Fix | All six executable probes now show and emit `mkdir -p reports/verification/rewrite/probes && node scripts/verification/rewrite/probes/<name>.js > reports/verification/rewrite/probes/<name>.json`. Four runnable probes were actually executed from a separate reports-free checkout; output is ignored, output JSON command metadata exactly matches each header, and tracked content stays unchanged. Preserved historical JSON was not rewritten. | CLOSED |
| F3 | LOW / Recommended | Normalized `.` snapshot root is recognized; `/` normalizes to the same root. Both the author's root-link regression and the original independent `..` reproducer pass. Snapshot symlink and outside-tree constraints remain covered. | CLOSED |
| F4 | LOW / Recommended | Rewrite README and capture README now link dated JSON records to `docs/evidence/rewrite/probes/` and executable probes to `scripts/verification/rewrite/probes/`, with separate labels. Clean-checkout link validation passes. | CLOSED |

## Independent checks executed on the corrected candidate

Environment: macOS, Python 3.9.6, Node v24.19.0, Git 2.54.0 (Apple Git-157). No network or production dependencies were needed.

1. `python3 scripts/verification/test_artifact_policy.py`: PASS, 16 tests. Existing staged/working-tree mismatch, committed-tree, history, multiple/new/deleted pushed ref, missing object, forbidden-output and immutability cases remain green; the new URI/root cases are included.
2. `python3 scripts/verification/smoke_artifact_hooks.py`: PASS, six actual local-hook scenarios. Explicit installation and valid commit, generated-output rejection with local-file preservation, indexed link dependency, push to a temporary local bare remote, rejection of transient forbidden history, and existing-hook configuration preservation were observed. Temporary fixtures were removed.
3. `python3 /private/tmp/verify-reports-cleanup-edge-cases.py`: PASS, all five independently authored cases. These cover snapshot symlinks, pre-policy history exemption, forbidden intermediate history on a merged branch, file-URI rejection and repository-root link acceptance. The helper fingerprints the index and working files before/after every checker call.
4. `python3 scripts/check-artifact-policy.py --staged`: PASS, exact corrected repository index.
5. `python3 /private/tmp/verify-reports-cleanup-v2-smoke.py`: PASS. This reviewer created a separate temporary local clone from `/private/tmp/tw-reports-final-ia48bn2b/snapshot`, materialized the committed candidate, confirmed the full indexed-entry digest above, and confirmed `reports/` did not initially exist. The temporary clone was removed on exit; the author's snapshot was not modified.
6. Inside that independent checkout, reran `python3 scripts/check-artifact-policy.py --staged`: PASS. Reran `python3 scripts/verification/rewrite/validate-package.py`: PASS, 82 JSON files, 5,050 local links, 2,773 line anchors, 74 reference screenshots, 45 capture diagnostics and eight Python files; no errors.
7. Inside the same independent checkout, executed the exact documented shell command for each of `client-push-branch-entry`, `client-storage-migration`, `server-kmatimelib-timezones` and `server-unit-conversion`: four PASS. Each generated JSON passed `git check-ignore`, contained the exact invoked command, and left `git status --porcelain` unchanged. Detailed commands/results are in `/private/tmp/reports-cleanup-v2-independent-smoke.json`; executable reproduction is `/private/tmp/verify-reports-cleanup-v2-smoke.py`.
8. Rehashed all 652 original local reports: all still match their preserved originals. Rechecked all 72 retained historical JSON files against migration source hashes: all are unchanged. The initial independent verification already validated all 143 indexed migration destinations and all 89 historical source repairs; these inputs were not changed by the corrections, so that evidence is reused.
9. `git diff --cached --check`: PASS. The corrected index still contains no reports, and the unchanged architecture diagrams/reference image bytes and source-runtime scope established in v1 remain applicable. The corrected skill deliverable remains a guide only.

## Acceptance assessment

- AC1: PASS — zero tracked reports in the verified candidate; original local bytes are retained.
- AC2: PASS — selected documentation/evidence and screenshot dependencies validate without the old reports tree. The URI gap is fixed.
- AC3: PASS — inspected generated output defaults and six probe command recipes use ignored output or external destinations. Intentional reference publishing remains documented separately.
- AC4: PASS within the local endpoint — the read-only checker handles the inspected staged, committed and outgoing-history scenarios; real fixture hooks call it; CI wiring uses the same checker with full history and includes documentation changes. Hook installation and remote required-check activation remain explicit operational choices, not implied completion claims.
- AC5: PASS — retention policy and actionable shared-skill upgrade guide are present; no user-wide installation/execution is claimed.

## Limits and endpoint

This is local independent verification, not a cross-provider PR review, remote CI result, release approval or deployment authorization. No author working-tree/index/configuration writes, author commit/push, issue updates, global skill changes, remote permission changes, production/provider/database calls, native builds or browser rendering were performed by this reviewer. Local fixture commits and pushes were confined to disposable test repositories.

The actual working repository intentionally has no installed `core.hooksPath`; hook behavior was exercised only in isolated fixtures. Adding the workflow does not establish remote merge-required enforcement. Two historical source probes still have documented pre-existing incompatibility with current source (AirKorea station merge and push text/purchase expiry); their result recipes were inspected, not falsely reported as successful executions. Dated relocated evidence was preserved, not re-certified.

This verdict is bound to the candidate digest above. Later evidence-only report publication should preserve this candidate identity and receive its own staged content/link check; later implementation changes require renewed affected verification. The initial report and this follow-up together preserve the findings and their resolutions.
