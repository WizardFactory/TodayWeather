# Local verification

Candidate: see `candidate.json` (60 actual changed source/test/config/document snapshots). All executable checks ran in the isolated web workspace; legacy server/collector/mobile builds were not started.

- Strict TypeScript: pass.
- Production Vite client and bundled Node API: pass.
- Vitest: 27 passing tests across four files. Covers source rejection, sentinel/zero/null values, six units, coordinates and wall dates; real local HTTP with controlled providers; settings/favorite identity; notification ownership, CSRF, revisions, timezone/DST, restart, unsubscribe and send dedupe. Web Push network delivery uses an injected sender, not a real device.
- Additional production-browser smoke: eight passing Chromium scenarios using actual Node BFF and synthetic providers, no Playwright API interception. Desktop weather/air/nation/warnings/settings, F/dark persistence, mobile favorite add/delete and denied geolocation, unavailable push, service worker offline snapshot, coordinate deep reload and unsaved navigation guard.
- Actual public provider/browser read: pass for domestic weather and national air routing; HTTP success exposed missing yesterday/air and stale 2021 national air. Provider identity/source observation timestamps remain visible. This earlier live integration has been reused after frontend navigation-only fixes; it is not represented as a new final-candidate network run.
- Documentation: 43 relative links checked, zero broken. Actual implementation and future cloud proposal are separate.
- Architecture: 9/9 artifact checks, zero errors/warnings; real browser containment passed at 1440x900, 1600x1000, 1920x1080 and 2048x1320. Main visually inspected all four light/dark screenshots at the smallest/largest viewport. No overlap or clipping observed.
- Product visual review: desktop light/dark and mobile full-page screenshots inspected; no page-level horizontal overflow on mobile. Hourly charts intentionally scroll inside their container.

Historical failures remain in separate logs: intended domain red (eight behavioral assertions); erroneous API import and sandbox listener setup; two incorrect Playwright label selectors. Only the domain stub failures count as intended Red. Final accessible combobox selectors and all app assertions pass.

Not run: Docker build/Compose deployment, remote CI, real push dispatch/receipt, iOS installed/Safari or Android device matrix, native builds, production deployment, condition-alert evaluation. These remain release gates; issue #2558 is not complete. No cross-provider PR review is claimed.

Iteration 2: see `corrections.md`. Intended red evidence independently captures same-province city collapse and four browser defects (immediate Enter, delayed geolocation, missing snapshot time, malformed hourly array). Final correction typecheck/build, 27 regression tests and eight integrated browser scenarios pass. Reused diagram/document and earlier live-provider evidence is unaffected because no topology, deployment config or upstream path changed. Mandatory review findings require QA-2 confirmation.
