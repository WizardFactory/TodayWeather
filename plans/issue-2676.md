# Forecast deduplication execution plan
Input: [specification](../specs/issue-2676.md). Owner: /root. Endpoint: pre-merge.

1. Add test-first full-grid forecast coordinator/Manager regressions and lifecycle/writer checks; retain intended baseline failure. Add fixture builders independent of provider credentials.
2. Add forecastGridCollection with exact product/publication queries, expected-slot rules, numeric validity, before/after coverage, bounded waits and attempt totals. Add one forecast deadline policy default540000ms, without changing schedule.
3. Wire Manager short/shortest through per-product coordinators and existing recursion; validate batches before save. Pass control to DB1/DB2 writers, replace DB1 overlapping slots under controlled admission, propagate DB2 errors and fence late writes. Keep current collection unchanged.
4. Run targeted green/regression checks; run full offline suite and additional real Node16.20.2/Mongoose5.1.2 HTTP/Mongo smoke for both products/storage versions, pages, retry and single-grid repair. Temporary services bind loopback, use dummy keys, clean up.
5. Update operations budget/rollout and collection architecture plus Archify JSON/HTML. Validate diagram artifact/browser/visual separately, retained links and actual staged/outgoing commits.
6. Commit/push one scoped branch, create PR, wait CI, launch independent eligible review, apply selected findings and renew checks; verify head/base/readiness without merge.

7. Review 5402654383 and the 2026-10-04 audit: drop out-of-horizon rows (keeping one valid trailing slot), fence late DB2/DB1 writes on publication, configurable coverage read wait with readMs, one ultra-short refresh per current publication (AK decision), and regressions for after-read failure, Manager horizon filtering, fcsDate consistency and refresh timing; renew real smoke, docs, diagram, CI and review.

8. Review 5403438544: success-only refresh marker and same-publication settle gate for admitted writes from expired runs, with red/green regressions and mutation checks.

Scenarios: S1 completed repeats/new publication (AC1); S2 gaps/pagination/errors/deadlines/late callbacks (AC1/AC2); S3 real persistence/recreation/repair and measured requests (AC3); S4 human deployment readback (AC4, not run here). Machine scenario definitions are retained in task evidence.

Riskiest part: DB1 merges and writer delays can carry prior values or write after deadline. Prove with incomplete-batch rejection, delayed-find/update tests and real persisted readback. Forecast consumers, retained older slots and current observation admission could regress; full offline/current/response checks cover them. Rejected alternative: existing checkPubDate/document-exists guards, which hide partial forecasts. No dependencies added to server or server2. Rollback: revert scoped commit; no schema/data migration.
