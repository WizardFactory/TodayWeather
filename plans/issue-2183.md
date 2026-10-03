# Plan: administrative-area life-index fallback (#2183)

Inputs: [intent](../intent/issue-2183.md), [spec](../specs/issue-2183.md). Execution notebook: `.planning/2026-10-03-issue-2183-administrative-areas/` (local-only). Verification: [pre-merge evidence](../docs/evidence/tasks/issue-2183/pre-merge.md).

1. Trace the issue; reproduce missing exact/nearest codes with a failing behavior test. This occurred before production edits and is reconciled in the retained evidence.
2. Add typed no-data in `server/controllers/lifeIndexKmaController.js`; walk bounded candidates in `server/controllers/controllerTown.js`. Preserve current/daily enrichment and optional continuation.
3. Register `server/test/offline/life-index-area.test.js` in `run.js` and the Node16/22 RSS workflow; keep pollen fixture copies Node16-compatible. Add `life-index-area-mongo-smoke.js` for actual local Mongo and HTTP boundaries.
4. Update offline README, mobile API contract and mobile-weather-request JSON; regenerate HTML through Archify and check artifact/browser/screenshots separately.
5. Reconcile current master, run affected and broad checks, staged/outgoing artifact checks, commit/push and create/update PR. Complete eligible independent PR review/correction and current CI; stop merge-ready without merging.

## User scenarios

| ID / criteria | User and goal | Prerequisites / ordered actions | Expected result / failure path | Coverage |
| --- | --- | --- | --- | --- |
| S1 / AC1 | Domestic weather user wants indices for a reorganized area | Old exact and first-nearest codes have no index; a later candidate does. Request domestic weather, resolve address, try exact, try nearby in order. | Later candidate enriches; valid exact data instead takes precedence. Exhausted list omits indices. | Area regression; real Mongo/HTTP smoke |
| S2 / AC2 | Weather user needs weather when optional data is unavailable | Missing metadata/indices or a failing store. Request weather and complete enrichment. | Weather/MFDS/next continue once; errors logged; DB failure stops additional reads. No providers or metadata writes. | Area regression; weather response smoke; Mongo no-data smoke |
| S3 / AC3 | Existing clients need zero values and pollen summary | Valid stored zero UV/pollen plus another species. Read daily/current fields on Node16/22. | Zero remains present; summary is the maximum available grade; absent types stay absent. | Area/pollen/UV/summary tests and route smokes; RSS CI |
| S4 / AC4 | Maintainer wants a reviewable safe pre-merge result | Tested branch, configured authenticated GitHub/Paseo and independent reviewer. Check artifacts, publish PR, review/correct, observe exact head/base and CI. | Verified readiness; no merge/queue/auto-merge or production action. Missing eligible review remains incomplete. | Artifact gates, reviewer receipt and remote readiness observation |

The riskiest change is optional callback/error flow; regression and route smoke cover it. The nearest metadata query still admits only three rows, which can miss available data. No data migration is required. Rollback is a revert of the scoped commit, restoring first-nearby behavior. Never use collection GET routes for verification or start the default local server.
