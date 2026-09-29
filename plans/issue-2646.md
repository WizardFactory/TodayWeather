# Implementation plan
Owner: /root. Inputs: intent/issue-2646.md and specs/issue-2646.md.

1. Update hosting regression fixtures to expect the requested domain, add explicit legacy-origin rejection, run focused tests and retain intended failures.
2. Change fixed build/uploader/template domain. Update current infra README, architecture web-client notes, uploader smoke examples and workflow input description. Update the current web README, intent, implementation plan and hosting diagram labels; preserve historical evidence. Regenerate the existing diagram with Archify and verify artifact, browser and captures.
3. Rewrite reuse instructions with operator-provided identifiers, app-only policies and placeholder backup/rollback; document clean-release requirement and staged rollout verification.
4. Run focused tests, full tests/typecheck/build and separate local static-server HTTP smoke for release.json, deep links, missing asset/API rejection, CSP and cache headers. No server/app.js or AWS writes.
5. Have a fresh independent context inspect the diff and run relevant checks. Correct confirmed findings and repeat affected checks. Report local result and issue URL.

Risks: shared policies and service worker rollback. Reject new-stack provisioning for the existing production alias. Keep all AWS identifiers external to maintained task text. No structural diagram change; regenerate hostname and release-decision labels in the existing hosting diagram. No route/storage contract change. Production rollback is a documented operator procedure, never executed here.

## Continuation
Add the operator-only worker, focused behavior regression and real-browser recovery test with an isolated static server and intercepted API reads. Add runbook exact upload/recovery ordering, retain recovery sw.js through configuration rollback, and replace the old unimplemented-recovery limitation. Run full unit/typecheck/build/browser suites and separate actual browser recovery smoke. Commit scoped files, create PR, have Claude latest catalog GA model medium/auto independently verify/review, satisfy CI and inspect production coupling before authorized merge. Prepare a clean release and local AWS change proposal; stop for explicit production approval.
