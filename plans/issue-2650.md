# Plan: issue 2650

Consumes [intent](../intent/issue-2650.md) and [spec](../specs/issue-2650.md). Owner: main Codex context. Endpoint: pre-merge; no merge or production execution.

1. Record provider decisions and the area/cycle matrix. Model weather collection and mobile response flow in Archify source and regenerated HTML.
2. Cover normal, missing, zero and malformed provider grades using current-shape fixtures, plus collection date/season boundaries.
3. Implement UV/pollen collection, optional response enrichment, core normalization and available-only web display. Remove dead food poisoning/health collection and schedules.
4. Execute offline regression, integrated local smoke with isolated dependencies, root tests, typecheck/build and a browser UI scenario. Capture an actual screenshot and render a checked user guide PDF from editable source.
5. Assess API, architecture, README/manual and provider documents; check links and artifact policy. Commit, push, open PR, observe CI and run independent eligible PR review. Apply selected findings and renew affected checks/review.
6. Record exact head/base, CI, review, protection and auto-merge status in a merge-ready receipt. Stop before merge.

User scenarios are mapped in `reports/sdlc/issue-2650/user-scenarios.json`. Rollback is a code revert; no storage migration is planned. Blast radius is seasonal KMA collection, optional domestic response properties, shared core mapping and web detail UI. A derived activity score was rejected because no accepted thresholds or user-safety interpretation exist. The related food poisoning source decision remains #2600.
