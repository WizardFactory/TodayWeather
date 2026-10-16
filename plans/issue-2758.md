# Implementation plan for #2758

Owner: OpenAI builder /root. Endpoint: pre-merge. Notebook: .planning/2026-10-16-issue-2758-analysis. State/artifact index: ignored reports/sdlc/issue-2758/artifacts.json. Inputs: intent/issue-2758.md, specs/issue-2758.md and actual provider/log investigation.

## Declared paths
- server/lib/airkoreaObservation.js: narrow explicit-unavailable and zero-total observation paging contracts; bounded rejection metadata.
- server/lib/kecoRequester.js: safely include rejection details in outcome logs.
- server/test/offline/airkorea-rejections.test.js, airkorea-rejections-smoke.js, fixtures/airkorea/rejections-20261016.json and run.js: recorded regressions, real HTTP/Mongo direct-reader/route integration, test registration.
- server/test/offline/README.md: commands and fixture provenance.
- docs/architecture/weather-collection.md, README.md and diagrams/airkorea-observation-recovery.{json,html}: maintained collector contract and generated diagram.
- docs/operations/airkorea-recovery.md and docs/evidence/tasks/issue-2758/verification.md: actual diagnosis, checks and operator readback boundary.
- intent/issue-2758.md, specs/issue-2758.md, plans/issue-2758.md: canonical scope/spec/plan.
- reports/sdlc/issue-2758/ and existing .planning directory: ignored working evidence, no credentials/raw bodies.
No runtime assets elsewhere, new dependencies, configuration changes, server2 implementation or production writes.

## Order and proof
1. Record actual payload-derived fixtures and diagnosis (complete). Distinguish current repro from historical unrecorded bodies.
2. Add failing tests for all six null-time batches, four zero-total pairs, valid control and strict negative cases. Record intended Red.
3. Implement minimal contracts. Verify Green and post-refactor regressions, key/quota behavior, metadata safety and write boundaries.
4. Run a distinct real loopback HTTP and temporary Mongo smoke through station fetch/parse/store/average/direct nation reader and repository nation route with external fallback disabled. Use captured times under a fixed test clock; assert original timestamps, expected numeric pollutant means/grades, absent skipped rows and city-only negative control. No live provider/production DB.
5. Update maintained architecture/operations/evidence and diagram. Validate artifact, actual browser and screenshots separately. Run staged/outgoing retention checks. Commit/push PR; run required independent review and optional configured Grok/Gemini review contexts. Correct selected findings; renew checks and CI; stop before merge.

## Scenarios
- S1 / AC1: a collector receives a complete batch with explicitly unobserved stations. Preserve valid rows, report unavailable names, never save invalid time. Malformed identity/time and all-unavailable batches fail.
- S2 / AC1: provider returns zero total with nonempty observation pages. Fetch through an empty terminal page. Missing terminal, repeated/oversized/noncontiguous pages, changed total or exhausted limits fail without writes. Positive totals and auxiliary operations remain strict.
- S3 / AC2: a map caller requests airkorea units after isolated accepted collection. Province averages return original times and valid PM values/grades. City-only records and external fallback cannot satisfy the test.
- S4 / AC3: operator reads evidence/rollout instructions. Live scheduled/public 17-province verification remains pending separate rollout; no production recovery claim.

Riskiest part: detecting completion when totalCount is zero. Require an observed empty terminal page, preserve bounds/duplicate/count checks and never accept a failed final probe. Rejected alternative: skip any invalid row or trust a short first page; both hide data corruption/truncation. Blast radius includes station/sido parsing and the shared client used by station metadata/forecast/nearby; auxiliary strictness and quota/retries must stay covered. Rollback restores collector revision; no schema/data migration or deletion. Production rollout/restart and collection activation are operator-owned.

CI path amendment before edit: .github/workflows/gather-offline.yml invokes the new regression and existing-job Mongo smoke, without adding deployment logic or dependencies. This shared wiring is required so PR checks exercise the repair rather than only the prior fallback smoke.
