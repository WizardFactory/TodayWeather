# Issue #2782 implementation plan

Upstream: [intent](../intent/issue-2782.md), [spec](../specs/issue-2782.md). Owner: root. Named notebook: .planning/2026-10-16-issue-2782; generated evidence: reports/sdlc/issue-2782.

Paths: server/controllers/controllerTown.js; server/test/offline/town-geocode-{harness.js,coordinates.test.js,smoke.js}; server/test/offline/run.js; .github/workflows/gather-offline.yml (wire regression on Node16 and local-Mongo smoke); docs/architecture/mobile-api.md; docs/architecture/diagrams/mobile-weather-request.{json,html}; docs/evidence/tasks/issue-2782/verification.md; this intent/spec/plan. Legacy maintenance, no server2 placement exception required.

1. Add isolated actual-Mongoose regression before changing controller; retain intended .toFixed error/HTTP500 Red.
2. Normalize accepted town coordinates; verify first/repeated/reloaded locations and retained failure paths.
3. Run post-refactor offline tests and distinct real loopback HTTP plus temporary Mongo smoke on Node16; update docs and regenerate/check diagram, inspect screenshot.
4. Check staged and actual outgoing artifacts; commit/push/create PR against master; observe CI; independent reviewer runs checks and reviews exact candidate, main publishes findings. Correct selected findings and repeat affected verification/review. Stop at merge-ready with merge_authorized false.

Scenarios: S1 weather user requests unknown domestic address with string Kakao coordinates, repeats before/after save and after Town lean reload: all return 200 numeric rounded coordinates (AC1). S2 user requests existing numeric town: same object and no geocode/save (AC2). S3 empty list/provider error/invalid coordinates/outside Korea: preserve errors or uncached unsaved result (AC2). S4 save fails: first and repeated response still work with single geocode call (AC1/AC2).

Riskiest part: accidental coercion of invalid input into accepted coordinates, or changing cache/save/callback order. Normalize after existing guard; assert side effects. Blast radius: only newly geocoded accepted domestic towns used by legacy mounted APIs. No collector/startup/runtime configuration change. Revert change and reload process for rollback.
