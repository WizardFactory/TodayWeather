# Brasília weather budget repair (#2633)

## Cause and scope

Read-only production inspection on 2026-09-29 at 05:19:07 UTC correlated new logs from both Brasília requests with `gateway weather 501: backend status 500` and the internal `daily Visual Crossing record budget reached (976/1000)` error. The history-inclusive cold request estimates 49 records, leaving 24 unused but refusing the weather response. Reverse geocoding succeeds. Historical issue timestamps cannot be individually correlated because those error lines lack timestamps/coordinates.

The repair selects the existing 1-record forecast range when history exceeds the local cap, current data is not fresh, and forecast still fits. It applies to all locations. It preserves fresh-cache reuse, provider-down refusal, fully exhausted budget refusal, stale fallback, and existing missing-history semantics. It writes no provider-history marker, allowing history retrieval once budget recovers. A missing daily usage counter now counts as zero for the initial cap check.

No cap increase, production configuration change or deployment. Budget enforcement retains the existing approximate concurrency behavior. A completely exhausted budget still cannot fetch a cold location.

## Verification

- Offline regression reproduced the exact 976/1000 rejection before implementation. Final targeted suite: 55/55 pass.
- `NODE_PATH=/tmp/tw-2626-g/node_modules npm --prefix server run test:offline`: passed (Node 22.22.2).
- `TZ=UTC NODE_PATH=/tmp/tw-2626-g/node_modules node server/test/offline/vc-budget-smoke.js`: passed on Node 22.22.2 and 16.20.2. Real localhost HTTP gateway, loopback transport and full overseas middleware; synthetic geocoder/provider/storage. Both reported paths returned 200, `source: "VC"`, `thisTime[1].t1h: 12.2`; exactly two forecast calls and usage 976 → 978. This is candidate acceptance, not production recovery.
- The smoke is included in Gather CI. Existing full VC regressions protect other weather behavior.
- Archify 2.17 generated the updated world-cache diagram: nine showcase checks passed with zero composition issues; browser checks passed in light/dark at two desktop sizes; 1440 light capture visually reviewed.
- `git diff --check`: passed.

## Deployment handoff

After separately authorized deployment, GET `/weather/v000903/coord/-15.794,-47.882` and `/weather/v000903/coord/-15.78,-47.93`; require 200 VC JSON and finite `thisTime[1].t1h`. If no daily record capacity remains, wait for the UTC reset or obtain an explicit operating-budget decision. No merge, auto-merge, queue entry or deployment is authorized by this report.

Independent verification, current PR/CI and review results are recorded in the PR readiness comment. Local detailed receipts: `reports/sdlc/issue-2633/`; selected execution ledger: `.planning/issue-2633/` (both intentionally ignored by repository policy).
