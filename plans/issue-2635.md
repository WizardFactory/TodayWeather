# Implementation plan

Consume intent and spec for issue-2635. Owner: root. One branch/worktree/PR; endpoint pre-merge.

1. Update the existing mobile request diagram's repository-contract note, preserve timestamped historical routing and regenerate with Archify. Record artifact/browser/perceptual checks separately.
2. Write failing controller deadline and gateway real-loopback tests; cover marker, quota, cap, UTC reset, stale fallback, malformed metadata, unclassified errors, 400/404, CORS and no immediate retry.
3. Add a small shared temporary-weather-error helper; use it in DSF `_checkProvider`, shared world controller error response and gateway boundary. Keep unrelated error handling untouched.
4. Run targeted existing VC, gateway and shared controller suites; separate functional HTTP smoke with production middleware and isolated providers/models. No production or collector startup.
5. Update mobile-api docs; obtain independent alternate-provider verification and PR review, commit/push, CI; refresh head/base and leave unmerged.

Risk: losing the typed error at HTTP boundary, overclassifying generic backend 503, UTC lookup spanning midnight, or changing stale-cache success. Rejected alternative: mapping every provider/backend error to 503, which breaks parity beyond scope. Prove behavior with deterministic controller checks and real HTTP requests. Rollback: revert commit; no schema migration. Production deployment remains human-owned.
