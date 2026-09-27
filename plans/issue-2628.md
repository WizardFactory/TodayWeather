# Plan: air quality provider chain — PR 1 — issue 2628

Revision 3, 2026-09-27 (r3: review round 1 corrections F1–F4 with regression tests 22–25; r2: spec r2; `air-harness.js`; `httpClient.js`; smoke/check names as built). Consumes [intent](../intent/issue-2628.md) r1, [spec](../specs/issue-2628.md) r2. Owner: main agent (builder). Branch `feat/2628-air-provider-chain` from `fix/2622-waqi-air-fallback` afde7c77 (stacked on PR #2625).

## File operations

| File | Change | Req/AC |
| --- | --- | --- |
| `server/config/air.js` (new) | policy env parsing, constants | R1 |
| `server/lib/air/providers/{google,openweather,visualcrossing,waqi}.js`, `server/lib/air/httpClient.js` (new) | adapters, shared classified HTTP | R2 / AC1 |
| `server/lib/air/observation.js` (new) | normalize, evaluate, toArpltn | R3 / AC6 |
| `server/models/air.provider.usage.model.js`, `server/lib/air/providerBudget.js` (new) | shared counters, down markers, VC usage bridge | R4 / AC4, AC5 |
| `server/lib/air/providerChain.js` (new) | ordering/phases | R5 / AC2, AC3 |
| `server/lib/AQI/airFallback.js` (new, from `waqiAirFallback.js` — deleted), `server/models/air.observation.cache.model.js` (new, `waqi.air.cache.model.js` deleted) | cache + chain | R6 / AC6, AC7 |
| `controllerTown24h.js`, `route.kma.v000903.js` | `getAirFallback`, generic source | R6 |
| `server/test/offline/air-harness.js` (new loader), `air-chain.test.js` (new), `waqi-air.test.js` (rename → `air-fallback.test.js`, adapted), `run.js`, `gather-code-drift.test.js` stub list | unit | AC1–AC5, AC7 |
| `server/test/offline/air-chain-smoke.js` (replaces `waqi-air-smoke.js`), `rss-response-smoke.js` harness (`airModels`, `airConfig`, directory requires) | route smoke | AC2, AC3, AC5, AC6, AC7 |
| `server/test/offline/air-budget-mongo-smoke.js` (replaces `waqi-cache-mongo-smoke.js`) | multi-process Mongo | AC4, AC5 |
| `server/test/offline/air-chain-node10-check.js` (replaces `waqi-air-node10-check.js`) | host runtime | AC8 |
| `.github/workflows/rss-offline.yml` | step names/files | AC8 |
| `docs/architecture/mobile-api.md`, `weather-collection.md`, `docs/rewrite/external-providers.md` (W4 update, W5–W7), `docs/operations/air-provider-policy.md` (new), `server/test/offline/README.md`, diagram `domestic-air-fallback.json/html` (revised) | docs | AC9 |
| `server/test/offline/fixtures/air/*.json` (new) | google/openweather/vc bodies (documented + probe) | AC1 |

## Order

1. Tests first (unit + smoke skeleton) → Red on base.
2. R1 config → R3 observation → R2 adapters → R4 budgets → R5 chain → R6 fallback + controller/route → Green; `test:offline`.
3. Route smoke, Mongo smoke, Node 16 and Node 10 runs; live read-only check for VC and WAQI through the adapters (Google/OWM blocked, D9).
4. Docs, policy doc, diagram (Archify validate/deliver/visual-check).
5. Independent verification + cross-provider review; commit; push; PR (stacked note); CI; corrections; merge-ready.

## Commands

```sh
export NODE_PATH=/tmp/tw-2622/node_modules
node server/test/offline/air-chain.test.js && node server/test/offline/air-fallback.test.js
npm --prefix server run test:offline
TZ=UTC node server/test/offline/air-chain-smoke.js
NODE_PATH=/tmp/tw-2585-mongo/node_modules:/tmp/tw-2622/node_modules TZ=UTC node server/test/offline/air-budget-mongo-smoke.js
docker run --rm --network none -e NODE_PATH=/deps -v $PWD:/repo:ro -v /tmp/tw-2622/node_modules:/deps:ro -w /repo node:10.15.3-stretch node server/test/offline/air-chain-node10-check.js
```

## Risks, blast radius, rollback

- Blast radius: domestic responses without fresh AirKorea air; new Mongo collections `air.provider.usage`, `air.observation.caches`; `vc.usage` also counts air calls in the paid phase.
- Riskiest: phase/budget selection correctness under concurrency (counters are approximate: reads then increments; the 5 % reserve absorbs overshoot) and cost exposure — mitigated by paid-off default and per-provider paid caps. Found and fixed during the build: budget store callbacks could run twice / swallow caller exceptions with a synchronous store (regression test 20).
- Could break: `waqi.air.caches` readers (none besides the removed module); docs/tests referencing the old names.
- Rollback: revert; collections disposable. Setting `AIR_PAID_PROVIDERS_ENABLED=false` stops paid calls at runtime (restart needed).
- Rejected: per-process budgets; provider indexes for grades; VC in the free phase.
- Proof: unit + route smoke (4 loopback providers) + multi-process Mongo smoke + Node 10 check + independent verification and OpenAI review.
