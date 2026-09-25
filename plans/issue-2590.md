# Plan: Paginate KMA grid responses before the completeness check — issue 2590

Revision 1, 2026-09-26. Consumes [intent](../intent/issue-2590.md) r1 and [spec](../specs/issue-2590.md) r1. Design skipped (requester-internal; no component or flow change in `weather-collection.json`). Owner: main agent (builder). Branch `fix/2590-kma-town-pagination` from `master` `caaa21fe`, pushed to `ak-fork`, PR to `WizardFactory/TodayWeather` `master`.

## File operations

| File | Change | Req |
| --- | --- | --- |
| `server/lib/collectTownForecast.js` | Extract page request/envelope validation; add bounded sequential continuation; merge before the existing check | R1–R5 |
| `server/test/offline/harness.js` | Helper for a paged response (`totalCount`, optional echoed `pageNo`/`numOfRows`) and a 1,016-item short fixture | AC1–AC4 |
| `server/test/offline/gather-code-drift.test.js` | Multi-page success, single-page request count, continuation failures | AC1–AC3 |
| `server/test/offline/gather-smoke.js` | Two-page XML → storage smoke; keep truncated-page case | AC4 |
| `docs/architecture/gather-source-reconciliation.md`, `weather-collection.md`, `docs/rewrite/external-providers.md`, `server-data-lifecycle.md`, `domain-glossary.md` | Replace single-page limitation with pagination contract | AC6 |
| `intent/`, `specs/`, `plans/issue-2590.md` | Tracked SDLC artifacts | — |

## Order

1. Tests first; Red against a `git archive` copy of base with the new tests (expected: two-page case fails with the incomplete-response error; smoke assertion fails).
2. Implement; Green on UTC; post-refactor re-run; Node 16.20.2 and 22.22.2 `test:offline`.
3. Docs; link/claim check.
4. Commit, push, PR; CI; independent verification in a fresh subagent; issue comment summarizing the fix and the deployment handoff.

## Commands

```sh
NODE_PATH=/tmp/tw-air-smoke/node_modules node server/node_modules/.bin/_mocha server/test/offline/gather-code-drift.test.js  # or resolved mocha
NODE_PATH=/tmp/tw-air-smoke/node_modules node server/test/offline/gather-smoke.js
NODE_PATH=/tmp/tw-air-smoke/node_modules npm --prefix server run test:offline
```

## Migration, rollback, blast radius

No migration. Revert to roll back. Blast radius: every KMA grid/mid request passes through the new page-1 path; only responses with more items than one page issue further requests.

## Risk review

- What could break: a first page that previously failed now triggers a second request (only when full and `totalCount` larger).
- Riskiest part: callback/event exactly-once across nested page callbacks.
- Proof: exact request sequence and one-callback assertions per failure case; storage smoke; both Node versions.
