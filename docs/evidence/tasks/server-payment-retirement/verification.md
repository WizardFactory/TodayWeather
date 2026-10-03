# Server receipt retirement verification (#2642)

Verified on 2026-10-03 against base `1bc5669c` and the scoped #2642 candidate.
The PR's commit and review records bind the final candidate to these checks.

- `node server/test/offline/payment-removal.test.js`: intended Red on the base
  (7 failures for validator/config/mount presence), then Green and post-refactor
  (7 passed). Exact remaining mount order is asserted for all five versions.
- `NODE_PATH=<offline-dependencies>/node_modules npm --prefix server run test:offline`:
  all 41 selected commands passed on Node 24.19.0, including weather, geocoder,
  gateway, air and push regressions. The legacy live `npm test` suite was not run.
- `node server/test/offline/runtime-node16.test.js`: 11 push/startup regressions
  passed on Node 24.19.0; the filename does not imply a local Node 16 execution.
- `payment-removal-smoke.js` in test and production modes: real Express/app and
  five version indexes over loopback. All 10 GET/POST requests per mode returned
  the same 404 HTML as unknown-route controls. v000803 POST was admitted through
  its unchanged authorization middleware. Without authorization it retained the
  existing 500 `Not found id.` response. All five CORS preflights returned 204;
  all five real push routes rejected invalid input with 403. Health, public
  weather/geocode `(0,0)` handling and v000903 geocode redirect also passed.
- Isolated `npm ci --ignore-scripts --no-audit --no-fund`: 808 packages installed
  from the changed lockfile; billing SDK, XML signature/parser and XPath packages
  absent. Shared JWT/HTTP dependencies retained. Native install scripts were
  intentionally disabled; this is lock/install verification, not a native build.
- Archify sequence: showcase validation, delivery and strict artifact check
  passed; Chrome browser-check and captures passed after sandbox escalation.
  Inspected light/dark 1440×900 screenshots: readable flow and auth branch, no
  overlapping diagram labels. Browser containment checks also cover larger views.

The HTTP smoke substitutes controllers, Mongo connection, token encoding,
translation/template rendering, unused leaf routers and provider results. It
loads no `.env`, blocks external/socket-path connections and rejects collection.
Adjacent weather/provider computation is covered separately by existing offline
regressions. No live Mongo, Apple/Google receipt call, mobile build, production
startup, deployment or store-console change is claimed.

The artifact policy is checked against staged content and the outgoing commit
range. Local artifact hooks are available but not installed; this task does not
change repository hook configuration. CI review/readiness is retained in the PR.
The historical Travis file describes a master deployment; its current activation
is unknown. No merge, auto-merge, queue entry or deployment is authorized here.

Historical rewrite links to the deleted validator now target the fixed `bd6640f2` revision and explicitly mark payment cases as retired. The combined historical probe drops all eight receipt checks and retains 19 push checks at that baseline (all matched); the prior 27-check JSON remains unchanged. It requires the retained local Git object and never fetches or loads a payment SDK. Generated Archify HTML retains renderer-emitted trailing whitespace; authored files pass whitespace checks.
