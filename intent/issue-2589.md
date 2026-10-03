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
