# Issue 2589: load Geo and Push without provider credentials

Source: [issue 2589](https://github.com/WizardFactory/TodayWeather/issues/2589).
Owner: AK. Builder: OpenAI /root. Base: `e0b126c8`.

## Problem and outcome
The Geo controller parses Kakao configuration when required. A missing value crashes the require chain, including Push. Gather operators need these current modules to load without adding provider keys.

## Acceptance
- AC1: Geo loads with Kakao keys absent or invalid. Kakao calls return a clear callback/middleware error, make no request, and warn once per loaded module. Configured keys preserve retries and coordinate order.
- AC2: Push loads and constructs without APNs certificates or Firebase JSON; loading does not initialize Firebase or read credentials.
- AC3: The two modules can be replaced on a credential-free host without adding keys. Prove this with a real-dependency offline load smoke; retain the existing gather API fallback. Actual host replacement is a human deployment handoff.

## Authority amendment — 2026-10-03
AK initially authorized local implementation, then instructed “pre-merge까지 진행”. This authorizes scoped commits, branch push, PR creation/updates, CI inspection, issue comments and independent review/corrections through verified readiness. Use the existing authenticated GitHub path and configured OpenAI builder/Anthropic reviewer contexts. Transfer only task code, tests and sanitized SDLC evidence. Merge, auto-merge, merge queue, production deployment, credential disclosure, new accounts and permission-setting changes are excluded. Reviewer effort remains medium under the shared policy.

## Scope and risks
Change Geo parsing/error propagation and the Kakao config default; add offline regression and real-dependency smoke, existing-CI wiring and affected docs. Push implementation is already lazy and remains unchanged. Preserve user work. No full gather startup, other provider initialization, live-provider acceptance or device delivery claim. The old PR 2594 is closed without merge and supplies historical findings only. Main risks are masking provider errors, empty-list retries and accidentally reading push credentials. No UI or new feature; no manual/PDF or topology diagram needed.

Claude reconciliation accepted H1-GEO-001 and H1-CI-002 as Required. Extend the missing-key guard to `utils/convertGeocode`: skip Kakao, retain Google fallback, parse defensively and warn once without key values. Keep configured random key selection and fallback errors. For explicit artifact ranges, exclude only the supplied base; a tip policy change cannot omit task history. Keco/provider redesign and Google credential policy remain outside this correction. Recommendations for example-string filtering and concurrent PR #2674 integration are not selected at this pre-merge endpoint; preserve their rationale in the review record without separate tracking.

## Review correction — 2026-10-03
Independent finding R3-CI-001 requires a narrow CI baseline correction before readiness: a new branch push has an all-zero `before` SHA and currently scans already-published historical artifacts. Select its merge base with the default branch; preserve explicit PR and ordinary-push ranges, check every task commit and fail closed when no baseline exists. Add isolated Git regression/smoke evidence. This repairs a readiness blocker discovered during the authorized CI/review loop; product acceptance and deployment boundaries are unchanged. Both alternate-provider reviewers were unavailable (Anthropic usage cap, xAI exhausted balance), so the installed policy permits an independent OpenAI context with medium effort and effective auto mode.
