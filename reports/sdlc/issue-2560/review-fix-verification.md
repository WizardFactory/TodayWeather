# PR #2561 review correction verification

The correction addresses review 5302701507 (R1/P1): a missing or expired primary short publication no longer prevents independently fresh short RSS from producing daily forecasts. Both freshness and target-date bounds follow the selected source. Request-local evidence contains only matched fields actually copied from RSS; later mutations of mixed hourly data cannot revive stale primary values. Primary/RSS publication response fields remain unchanged. R2's per-source policy is documented in daily-forecast-contract.md. Sanitized diagnostics identify unusable RSS publications; no new public diagnostic fields are required.

Base: 95fe711eee09f021c266303195badb1d4c612ad5. Final source identity: review-fix-candidate.json. Changed implementation: controllerTown.js; regression runner and XML/route fixtures plus new short-rss-daily.test.js. The single main-owned notebook and stable issue-2560 stage counters continue the original work. User authorized correction and push, not merge/deployment; original local endpoint records are historical, supplemented by this explicit PR amendment.

## Actual checks

Environment: Node v22.22.2; async 2.6.4, xml2js 0.4.23, Mocha 2.5.3, Express 4.13.4, sprintf 0.1.5, Mongoose 5.1.2 from /tmp/issue-2560-offline/node_modules. No dependency installation or repository package change was required. All new weather fixtures are synthetic, with a fixed 2026-09-24 16:27 KST clock. HTTP, DB, config and timers are intercepted before module load. Reading app.js field declarations does not execute app startup.

| Command (repository root) | Actual result |
| --- | --- |
| `NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/short-rss-daily.test.js` before implementation | 34 initial cases: 14 expected failures for missing/stale-primary fallback and RSS target bounds; 20 controls pass (review-fix-red.log). |
| Same command after final correction | 44/44 pass, including additional future-primary rejection and unknown daily precipitation assertions (review-fix-green.log). |
| `NODE_PATH=/tmp/issue-2560-offline/node_modules npm --prefix server run test:offline` | 103 gather + 22 daily + 44 short-RSS daily + 43 existing RSS = 212 checks, plus gather smoke, passed (review-fix-offline.log). |
| `TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/daily-response-smoke.js` | 36 scenarios pass: previous 16 plus stale/missing primary, partial/unmatched RSS and nonzero six-hour precipitation × DB1/2 × C/F (review-fix-daily-smoke.json). |
| `TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules TW_SMOKE_OUTPUT_DIR=/tmp/issue-2560-review-rss node server/test/offline/rss-response-smoke.js` | All 36 existing RSS response scenarios pass (review-fix-rss-smoke.json). |
| `git diff --check -- server docs/architecture/mobile-api.md docs/architecture/diagrams/daily-forecast-validity.json` | Passed. Raw historical logs/diffs retain their original bytes. |

## Independent finding and closure

The independent verifier reproduced overlapping six-hour precipitation sums in the first correction: stale-primary daily output incorrectly summed unadjusted RSS slots. The final fallback omits unknown daily r06/s06 aggregates while retaining hourly precipitation and available daily weather/temperatures. Nonzero rainfall/snow route scenarios assert this contract. The independent report retains before/after values and final implementation hashes. Its additional incomplete-field and midnight probes passed, as did its own complete regression and route runs. This is an actual separate same-provider verifier, not cross-provider PR approval.

## Architecture and limits

Updated mobile-api.md, the data contract and Archify workflow source/HTML. Installed Archify 2.17 `validate`/`deliver` passed all nine artifact checks with zero composition warnings/errors. Browser visual-check passed light/dark at 1440×900, 1600×1000, 1920×1080 and 2048×1320. Main agent opened the final 2048×1320 dark image: readable nodes/cards, intact connectors and no clipping. Browser, artifact and perceptual results are separate claims; receipts are review-fix-design-delivery.json and review-fix-design-browser.json.

No fresh KMA request, production DB access, native build, production runtime/deployment or live recovery verification was performed. Push this correction for external reviewer re-examination; do not mark the human review resolved or claim merge readiness. The original operator deployment/rollback checklist remains applicable.
