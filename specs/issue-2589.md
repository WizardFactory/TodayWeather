# Credential-free Geo/Push loading specification

Implements [intent](../intent/issue-2589.md), AC1–AC3.

Geo caches a validated Kakao key list on the first Kakao call, rather than require. Missing, invalid JSON, non-array and arrays without nonblank strings become an empty list. Warn once per loaded module without values/parser error text. Empty lists return an Error naming KAKAO_SECRET_KEYS through the callback and send no request. Both location2address Kakao stages propagate provider errors before parsing responses. Valid lists retain their order and one request per key; x=longitude/y=latitude remains unchanged.

Use [] as the repository config default instead of example keys. Loading Push must neither require APNs nor initialize Firebase/read its JSON; no push implementation change is needed. Existing station geocode fallback remains unchanged. The key cache persists until process restart; dynamic credential reload is not part of this fix.

Verification: complete-module injected regressions for invalid/list/retry/error cases; real CommonJS dependency graph on Node16 with credential reads and external connections forbidden; loopback Axios 503 retry and successful KR address middleware; existing gather fallback and push runtime tests; Node22 full offline regression. Minimal runner executes the injected regression; the existing locked-dependency CI job executes the real smoke. No app startup, database or provider/device integration.

No route, collector, schedule, storage or topology contract changes; update explanatory architecture prose, exclude diagram regeneration. No UI/new feature or manual/PDF. Deployment requires separately authorized host work; rollback reverts the task commit.

R3-CI-001 correction: route artifact checks through an event-aware, read-only helper. PR and ordinary push retain the exact supplied base/head range. A new branch push with a forty-zero `before` uses the merge base of the selected head and `refs/remotes/origin/<default-branch>`, then checks every commit in that range and the tip. Missing refs or a missing explicit push/PR baseline fail. Manual workflow dispatch retains the existing tip-only check. Do not exclude fetched topic refs, disable the checker, rewrite history or change permissions. Isolated Git tests cover each event, published-master history, unpublished add-then-delete violations and missing-baseline failure; a separate local functional smoke uses the actual current repository and checker.
