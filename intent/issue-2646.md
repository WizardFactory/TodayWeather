# Prepare app.todayweather.ai deployment
Source: [#2646](https://github.com/WizardFactory/TodayWeather/issues/2646), AK requested issue creation and continuation after AWS hosting review.

The static web app must build and validate releases for https://app.todayweather.ai using existing hosting. Scope: build/uploader destination, tests, maintained deployment instructions and architecture notes. Preserve the existing API and native apps. Production changes, new AWS resources executed by this task, DNS changes, push/merge and PR publication are excluded. Local implementation is authorized by the continuation request; actual production deployment requires separate approval.

Acceptance: AC1 correct release origin and mismatched destination rejection; AC2 regression/typecheck/build and separate local hosting smoke; AC3 actionable reuse/backup/isolated-policy/upload/rollback runbook; AC4 accurate architecture documentation; AC5 independent verification without unresolved must-fix findings and no production mutations.

Main risks: stale fixed-domain examples, shared policy edits affecting other sites, first-release rollback to a placeholder without release.json. Environment identifiers remain operator inputs. No additional human choice is needed to prepare these changes.

## 2026-09-30 continuation authority
AK requested proceeding in order through the listed remaining work: commit/PR/CI/review and merge, complete and browser-test first-release recovery, produce a clean release, then execute AWS only after deployment approval. This supersedes the earlier local-only endpoint for Git/PR integration and recovery implementation. The existing task ID and iteration counters persist; the installed state CLI has no endpoint amendment command, so its original local route tracks implementation gates while explicit PR/merge receipts record this amendment. Use configured GitHub and Claude review capabilities for scoped source/test/evidence, never secrets or local operational inventories. Production mutation remains pending a concrete approval.

AC3 now includes an implemented and browser-tested recovery worker and reproducible rollback commands. AC5 includes a real different-provider PR review (latest available GA model, medium effort, auto mode) and CI before merge.
