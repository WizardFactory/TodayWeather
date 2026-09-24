# PR publication amendment — 2026-09-24

Authority: AK requested “make pr” after local completion and explicitly asked whether live data had been fetched. Commit/push and PR creation are now authorized; merge and deployment remain excluded. The original local intent/completion/receipts remain historical, not claims of current remote state.

The prior candidate's application code is unchanged. Publication preparation adds the new suite's missing isolated CI dependencies (Mongoose 5.1.2, sprintf 0.1.5, Express 4.13.4) and executes daily-response-smoke in the existing Gather workflow. No service dependency or action revision changes. The independent check artifact uses a repository-relative root so reviewers can execute it elsewhere.

The existing CI dependency environment reproduced the missing-dependency failure before the workflow repair. The corrected workflow uses the same six dependency versions as the verified offline environment. Workflow commands and independent checks are rerun before publication. Retained command results are ci-red.log, ci-regression.log, ci-daily-smoke.log and ci-independent.log.

No live KMA fetch, production DB read, app initialization, native build, deployment or recovery verification has been executed. Captured data is the item embedded in issue #2560; wrappers and remaining cases are synthetic. See daily-forecast-contract.md for operator verification and rollback.

Travis contains legacy provider/database tests and a master-only deployment recipe. Use [skip travis] on this change's commit to avoid legacy integrations; the explicit offline GitHub Actions still run. No merge/auto-merge/queue enrollment is authorized. Final PR/commit/check state belongs in the PR record rather than recursive evidence-only commits.

Publication checks: corrected workflow command passes 168 regressions plus gather functional smoke; daily response smoke passes 16 scenarios; portable independent checks pass 5/5. Existing 26 source/test/doc candidate files still match every recorded digest. No application behavior changed during PR preparation.
