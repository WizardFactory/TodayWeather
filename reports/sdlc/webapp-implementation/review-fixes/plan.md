# Correction implementation plan

Owner: main; selected execution notebook `.planning/2026-09-24-webapp-implementation/`, phase 6. Existing SDLC task `webapp-implementation`; do not reset stage counters.

1. Add regressions for native module scope, cache/version/routes, warning links, precipitation/snow/legacy snapshots, place IDs, notification queue/recovery/stale subscriptions and development configuration. Retain observed Red output; existing CI trace is C2 failure evidence.
2. Correct root package scope and development launcher, domain adapters/validation/UI, deletion cleanup, worker cache/version selection, scheduler persistence/delivery phases and dialog test synchronization.
3. Update actual architecture/runbook and generated Archify diagram. Keep old evidence readable; write new execution artifacts below this directory.
4. Typecheck, unit/API tests, production build, real browser/server smoke including two-version service-worker behavior and failure recovery. Repeat only the previously flaky dialog case for timing coverage.
5. Freeze candidate; independent read-only QA of changed behavior and evidence. Address any findings, then commit/push, update PR and verify CI on the published head.

Main risks: dedupe/subscription races when shortening locks; incorrect source periods or conversion twice; legacy offline snapshot compatibility; old-tab hashed asset access. Avoid broad native changes or replacing the notification store with new infrastructure. Rollback is feature-branch revert; no deployment is involved.
