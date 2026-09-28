# Plan: overseas air chain (#2628 PR2)
Revision 2. Consumes intent issue-2628-world r2 and spec r1. Owner: main Codex; bounded Claude builder owns executable code/tests, separate Codex review. Branch feat/2628-world-air-chain from dd2a5d8e (includes defe27ed and three dependency merges).

1. Record D21 decision on #2628; inspect active DSF/widget routing and response conversion.
2. Add failing unit/route tests for shared request-time air, normalized grades/time/source and nonfatal failures.
3. Extend shared callback if needed; connect active world query and response/unit paths with minimal compatibility changes. No changes to chain ordering/budgets.
4. Add real loopback route smoke, cache/budget checks, Node10 coverage; wire to existing offline CI. Fix only integration harness assumptions made stale by the new dependency.
5. Parent updates architecture mobile/collection/policy/catalog and Archify sequence, records actual artifact/browser/visual checks.
6. Builder verifies isolated Node16/22 offline and affected route/Mongo/runtime smokes; parent verifies candidate digests. Independent cross-provider verification/review; commit/push PR, CI, corrections, pre-merge completion.

Likely files: controllerWorldWeather.js, controller.ww.units.js, lib/AQI/airFallback.js; small lib/air helper if needed; server/test/offline world-air tests/smokes and relevant harnesses; .github/workflows/rss-offline.yml. Main alone owns docs, intent/spec/plan and SDLC state.

Risk: avoid concentration/index roundtrip, incorrect timezone, current/yesterday contamination, modeled station labels, old test harness accidentally making live calls. Existing no-air weather response must remain usable. Rollback by reverting PR2; PR1 domestic behavior remains. No migration of legacy aqi collection or credentials.
