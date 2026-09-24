# Local implementation handoff

User request: publish an issue and proceed with implementing a browser client, preserving as much mobile weather/air functionality as possible. [Issue #2558](https://github.com/WizardFactory/TodayWeather/issues/2558) was created and updated with actual progress; it remains **open** for the complete parity release.

Endpoint reached: **verified local integration candidate**, not production or full mobile parity. Candidate `sha256:184769c5a403bff6971dcd94047847c6dde0f1ded0af7b004174349b47af4e13` includes 60 actual changed source/test/config/document files in `candidate.json`, based on `87b8855f308611a07897cd3a39c45fefb3088d77`. Work remains uncommitted/unpushed in `design-webapp-deployment`. No PR, deployment, remote CI, native build or provider/collector modification was performed.

## Acceptance accounting

| ID | Local outcome | Material limits |
| --- | --- | --- |
| AC1 | Issue published and progress updated | Parent release issue remains open |
| AC2 | Responsive current/hourly/daily/air/overview, search/favorites, national views, warnings, settings/sharing/help implemented and browser exercised | Complete production S01–S16 parity still requires ancillary-field/provider/device checks and product exceptions in implementation.md |
| AC3 | Typed source/unit/date/sentinel handling and state/query identity; national city names preserved; delayed location updates preserve favorites/preferences | Provider freshness and international contract coverage need release verification |
| AC4 | Explicit demo/live modes; fixed-path same-origin BFF; provider errors/HTML/redirects never become synthetic success | Current live feed has missing yesterday/air and stale national air |
| AC5 | PWA shell, bounded validated offline snapshots, update UI; optional owned scheduled generic reminders with CSRF/revisions/dedupe; save/cancel/unsaved guard | Conditional alerts and forecast notification content not implemented; no real push-device or worker upgrade/rollback matrix |
| AC6 | TypeScript/production build pass; isolated CI and single-instance HTTPS Docker/Caddy recipe and runbook prepared | Docker/Compose and remote CI not executed; no hosted deployment or distributed notification store |
| AC7 | 27 regression tests, eight real local browser scenarios, earlier live-provider/browser evidence, verified architecture artifact/browser/visual review, independent QA PASS | Chromium-only local browser evidence; no cross-provider PR review or supported-device release claim |

## Review and correction evidence

QA-1 independently reproduced stale search Enter selection, late geolocation overwriting favorites/settings, and invalid snapshot expiry/shape causing a router error. Build iteration 2 added intended failing regressions and fixed these plus a main-discovered province/city naming issue. Strict typecheck, production build, 27 tests and eight integrated browser scenarios then passed. QA-2 independently verified all three mandatory fixes, a five-city fixture, valid snapshot compatibility, and exact source hashes. See `qa-1.md`, `corrections.md`, `qa-2.md`, and `test-results.json`. No unresolved mandatory local finding remains. Earlier failure/setup logs are retained and are not counted as passes or fabricated Red evidence.

The separate [implemented architecture](../../../docs/webapp/diagrams/webapp-implementation.html) passed 9/9 artifact checks with zero warnings/errors; real-browser containment passed four desktop sizes. Main inspected all four smallest/largest light/dark captures. The proposed cloud architecture remains unchanged and labelled as a proposal. Source/authored language is English; application UI is Korean.

## Review/run and release handoff

- [Run instructions and coverage](../../../docs/webapp/implementation.md)
- [Actual source architecture](../../../docs/architecture/web-client.md)
- [Deployment preparation and operations limits](../../../infra/web/README.md)
- [Main browser screenshots](screenshots/)

From the repository root, `npm ci --ignore-scripts` then `WEB_API_MODE=demo npm run dev`; open http://localhost:5173. Omit demo mode for live reads. To exercise offline/service-worker behavior, build then run the production server as documented. Demo data is conspicuous and never replaces a failed live server request.

Before a public parity release: repair/verify current providers and air freshness, implement and validate condition/forecast notifications, configure secrets/persistent infrastructure, test actual installed iOS/Android delivery and the browser/device/update matrix, and resolve native purchases/commercial policy and operational capacity. These are recorded open work, not silently waived acceptance. Deployment authorization is separate. Local smoke servers were stopped by their owners; generated evidence remains available.
