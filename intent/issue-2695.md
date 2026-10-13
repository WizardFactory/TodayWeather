Task: issue-2695-s10; owner: /root; revision/base: 07fdaf991d617f16944d75c201d64f35a4f2c83a; date: 2026-10-13.
Authority: AK requested S10 implementation and parallel subtasks; endpoint pre-merge.
Criteria: WIRE, GEOCODE, OWNERSHIP, PRIVACY, ACTIVATION, PLACEMENT.
Issue update assessment: publish consolidated implementation plan/path declaration after design, avoid duplicate intake comments.

# Intent
Move public weather/geocode coordination into server2 while weather families remain explicit legacy HTTP by default. Preserve legacy aliases, wire bodies/headers/errors, locale, query and label behavior.

- WIRE: selected S02 gateway/geocode records match bytes/status/functional headers; HEAD, conditional 304 and preflight retain contract.
- GEOCODE: local provider fixtures preserve Kakao/Google classifications, ordered fallback, key rotation and locale/boundary labels.
- OWNERSHIP: one bounded owner per cold lookup/retry chain survives waiter cancellation; 9s gateway, 5s lookup, <=3s attempts and maximum3 backend attempts.
- PRIVACY: exact coordinate lookup state is bounded volatile RAM only; optional address projections have fixed30day validity and never accept reverse keys/bodies.
- ACTIVATION: per-family/version native/legacy switches and rollback are explicit; unknown real quotas and unproved labels/cutover remain fail-closed activation gates.
- PLACEMENT: task paths/dependencies match declared server2 contract, no legacy runtime source/data imports.

In scope: implementation, isolated tests, release-process local smoke, documentation/manual and diagram, commit/push, PR creation/CI, independent review and fixes. Scoped code/tests/SDLC evidence may pass between current authenticated GitHub account and configured OpenAI builders/Anthropic reviewer. No secrets, new accounts or permission changes. Endpoint pre-merge; no merge, auto-merge, queue, AWS, live providers, production deployment/cutover or notifications.

Reuse existing .env through operator environment injection rather than reading legacy files. Google key allowlist remains. Actual daily/peak quotas and seven-day shadow/cold production performance remain unmeasured; no local benchmark can satisfy those activation gates. No separate geocoder key set is required by AK's task clarification; data.go.kr coexistence policy is unaffected.
