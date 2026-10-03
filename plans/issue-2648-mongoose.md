# Execution plan

Inputs: [intent](../intent/issue-2648-mongoose.md), [spec](../specs/issue-2648-mongoose.md). Owner: root. Revision: 1.

1. Add pinned real-query tests covering getStnList, findHourlies2 and ASOS metadata. Reproduce TypeError before product edits.
2. Replace the three unsupported chains; retain the native history cursor. Update the response harness to support real station model/controller injection and remove fictional Query.maxTimeMS.
3. Run green and existing history/RSS regressions on Node 16.20.2 and 22.22.2; run a separate loopback route smoke asserting historical rows/provenance and degraded storage behavior.
4. Document commands/limits and add CI execution. Stage intended files, run artifact checker, commit, push fork and open scoped PR. Obtain independent latest-GA Claude review, medium effort, auto mode. Address Required and selected Recommended findings and renew checks. Inspect current CI/head/base and automation, then stop unmerged.

Scenario S1 (AC1): maintainer, exact mongoose installed; call real station methods with real model.find and intercepted exec; assert rows, filters/options/projection/lean/sort/limit. Failure: unsupported method or changed timeout fails before execution.
Scenario S2 (AC2): Korean API consumer, synthetic historical missing grid slot and matching station row; request the actual v000903 address route over loopback; verify station temperature and provenance, no TypeError; failed storage returns explicit missing data safely.
Scenario S3 (AC1, AC3): maintainer, optional ASOS enabled and real station metadata query; read synthetic cache through native cursor and verify metadata options and independent hourly/daily reads; disabled config makes no query; DB errors remain bounded.

Blast radius: three query construction chains and test harness/CI/docs. Riskiest part: conflating Mongoose and native cursor APIs or masking construction in tests. Proof: test-first pinned queries plus route assertions. Rollback: revert scoped commit; no migration. Architecture/Archify excluded: no route, collector, response, storage or scheduling contract change. No new feature/UI; PDF manual not applicable.
