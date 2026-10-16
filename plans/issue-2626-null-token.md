# Implementation plan — ignore invalid push tokens

2026-10-16. Owner: Codex /root. PROCEED within [intent](../intent/issue-2626-null-token.md) and [spec](../specs/issue-2626-null-token.md). Notebook: `.planning/2026-10-16-issue-2626-token-device-check/` (local); artifacts: `reports/sdlc/issue-2626-null-token/` (local).

1. Add `client/test/push-token-refresh.test.cjs`, executing actual Firebase and Push factories with isolated native/storage/HTTP adapters. Reproduce invalid-callback side effects before editing production code.
2. Add the callback guard in `client/www/js/service.push.js`; leave direct helper callers and accepted-token behavior intact. Run Red→Green→post-refactor tests and the existing client suite. Wire the new test into `.github/workflows/client-offline.yml`.
3. Run additional real native simulator renewal (or, if unavailable, actual HTTP/coordinator integration) after the fix. Preserve private tokens only during execution, bound production test settings and remove them. No synthetic notification may stand in for real receipt.
4. Keep selected dated evidence in `docs/evidence/tasks/issue-2626-null-token/verification.md`. Update `docs/architecture/push-notifications.md` and `docs/architecture/diagrams/push-notifications.json`; regenerate its HTML through installed Archify and check artifact/browser/visual results separately. The existing diagram remains explicitly the optional SQLite path; no S3 redesign.
5. Stage only these files plus canonical intent/spec/plan. Validate artifact policy and tested content, commit code before pinning its revision in diagram metadata, then regenerate/document and make the final documentation commit. Renew applicable self-verification for the final candidate. Check every outgoing task commit before push.
6. Create PR linked to #2626 without closing the umbrella issue. Run CI and independent Claude review (latest verified GA model, medium, existing auto mode) in an isolated input checkout; attempt optional Grok4.7high and Gemini3.8high per skill. Resolve Required/selected findings, refresh final checks/head/base/auto-merge state, and stop pre-merge.

## User scenarios and tests

- **S1 / AC1:** A user already has token A and saved alarms. SDK emits null, undefined, empty/whitespace-only or non-string values. No immediate request/storage write occurs and A/settings remain. A reset or POST is failure.
- **S2 / AC2:** Same user receives A→invalid→B then repeated B. Exactly one PUT carries A/B, B becomes current, settings remain and duplicate B is inert. Any incomplete pair/extra request is failure.
- **S3 / AC3:** A user saves alarms before any token. Invalid/error callbacks are inert; the first real token preserves today's settings POST/save flow. Missing POST or settings loss is failure; this task intentionally leaves the initial old=null PUT semantics unchanged.

Risks: rejecting a usable SDK value or suppressing the delayed first-token POST; real-factory callback tests and native smoke prove these boundaries. Rejected alternative: relax backend validation or clear generation fences; neither addresses invalid client mutation safely. No storage migration or backend deployment is needed. Revert the guard/test change for rollback. No new feature/UI/manual PDF; maintained architecture/evidence provide the developer/operations explanation. CI's existing disposable logs are supplemental; selected essential results stay in Git/PR records.
