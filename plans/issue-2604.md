# Plan: stop quota retry storms and rotate forecast keys — issue 2604

Revision 2, 2026-09-27. Consumes [intent](../intent/issue-2604.md) r1a and [spec](../specs/issue-2604.md) r2. r2: `requestLimit` in the collector walk and `cycle.retrying` in the Manager (R5a), F1 regression tests, docs F2 (`gather-source-reconciliation.md`, K4 row). Owner: main agent (builder). Branch `fix/2604-kma-quota-rotation` from `master` 3cfc75dc in worktree `weak-seal`. Design stage skipped: the weather-collection diagram has no retry/key nodes and the component flow is unchanged.

## File operations

| File | Change | Req |
| --- | --- | --- |
| `server/lib/dataGoKrRejection.js` (new) | code/isQuota/isAuth | R1 |
| `server/lib/kmaWarningRequester.js` | use shared predicates | R1 |
| `server/lib/collectTownForecast.js` | classification, stopReason/rejected, bounded walk | R2–R4 |
| `server/controllers/controllerManager.js` | per-service sticky key, stop/rotate, summaries, concurrency | R5 |
| `server/config/gather.js` | `GATHER_REQUEST_CONCURRENCY` | R6 |
| `server/test/offline/gather-quota.test.js` (new), `run.js` | AC1–AC5 tests | AC1–AC5 |
| `server/test/offline/gather-quota-smoke.js` (new) | real HTTP smoke | AC1–AC3 |
| `server/test/offline/gather-code-drift.test.js`, `harness.js`, `gather-policy.test.js`, `kma-warning.test.js`, `kma-warning-node10-check.js` | cutoff characterization → walk; new dependency stubs | AC6 |
| `docs/operations/gather-runtime-policy.md`, `docs/architecture/weather-collection.md`, `docs/architecture/gather-source-reconciliation.md`, `docs/rewrite/external-providers.md`, `server/test/offline/README.md` | behaviour and variable | R7 |

## Order

1. Tests first (`gather-quota.test.js`, drift update); Red on base.
2. R1 → R2/R3 → R4 → R6 → R5; Green; full `test:offline`.
3. Smoke with a local fake data.go.kr server (real `request`, HTTP proxy env).
4. Docs; link check.
5. Independent verification in a fresh context; local commit.

## Commands

```sh
NODE_PATH=/tmp/tw-2609-gather/node_modules node server/test/offline/gather-quota.test.js
NODE_PATH=/tmp/tw-2609-gather/node_modules npm --prefix server run test:offline
NODE_PATH=/tmp/tw-2609-gather/node_modules node server/test/offline/gather-quota-smoke.js
NODE_PATH=/tmp/tw-2609-gather/node_modules node server/test/offline/kma-warning-node10-check.js
```

## Risks, blast radius, rollback

- Blast radius: every forecast collection on the gather worker (town and mid) and warning classification.
- Riskiest part: walk completion accounting (`dataCompleted` exactly once, including stop and synchronous completions). Covered by counting callbacks in tests.
- Could break: callers relying on the synchronous `recvFail` for indices above 100 (only the drift characterization test).
- Rollback: revert the commit; host can set `GATHER_REQUEST_CONCURRENCY` lower without code change.
- Proof: AC tests plus real-HTTP smoke with 2,032 grids, then independent verification.
