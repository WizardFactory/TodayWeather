# Plan: overseas air chain (#2628 PR2)
Revision 4. Consumes intent issue-2628-world r4 and spec r3. Owner: main Codex; bounded Claude builder owns executable code/tests, separate Codex review. Branch feat/2628-world-air-chain from dd2a5d8e (includes defe27ed and three dependency merges).

1. Record D21 decision on #2628; inspect active DSF/widget routing and response conversion.
2. Add failing unit/route tests for shared request-time air, normalized grades/time/source and nonfatal failures.
3. Extend shared callback if needed; connect active world query and response/unit paths with minimal compatibility changes. No changes to chain ordering/budgets.
4. Add real loopback route smoke, cache/budget checks, Node10 coverage; wire to existing offline CI. Fix only integration harness assumptions made stale by the new dependency.
5. Parent updates architecture mobile/collection/policy/catalog and Archify sequence, records actual artifact/browser/visual checks.
6. Builder verifies isolated Node16/22 offline and affected route/Mongo/runtime smokes; parent verifies candidate digests. Independent cross-provider verification/review; commit/push PR, CI, corrections, pre-merge completion.

Likely files: controllerWorldWeather.js, controller.ww.units.js, lib/AQI/airFallback.js; small lib/air helper if needed; server/test/offline world-air tests/smokes and relevant harnesses; .github/workflows/rss-offline.yml. Main alone owns docs, intent/spec/plan and SDLC state.

Risk: avoid concentration/index roundtrip, incorrect timezone, current/yesterday contamination, modeled station labels, old test harness accidentally making live calls. Existing no-air weather response must remain usable. Rollback by reverting PR2; PR1 domestic behavior remains. No migration of legacy aqi collection or credentials.

## Review correction pass
Retain the stable task counters. Add failing deadline/late-result and attribution tests, implement only bounded branch completion and additive metadata, then route smoke with slow provider/store and late cache reuse. Re-run affected unit/routes/offline on Node16/22 and Node10. Update diagrams and API/operator contract. Independently reverify both human Must Fix findings, push correction to PR2631, check CI/base including README overlap with PR2629. No merge/deployment.

D23: add test-first top-level pending/retryAfterSeconds hint only for deadline expiry, prove all response routes and cache reuse; no automatic retry. Preserve earlier D22 evidence and rerun affected checks for amended candidate.
