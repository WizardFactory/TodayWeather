# Plan: Push registrations in SQLite on tw-svc — issue 2626

Revision 1, 2026-09-27. Consumes intent r1, spec r1, design (updated `docs/architecture/diagrams/push-notifications.json`). Owner: main agent. Branch `feat/2626-push-sqlite` from master `1ff466b0`.

## File operations

| File | Change | Req |
| --- | --- | --- |
| `server/lib/sqliteFileStore.js` (new) | sql.js init, async lock with dead-owner takeover, mutate/read, atomic write | R1, R2 |
| `server/lib/pushStore/index.js`, `mongo.js`, `sqlite.js` (new) | store selection; Mongo queries moved from controllers (+ D7); SQLite implementation | R3–R5 |
| `server/controllers/controllerPush.js`, `alert.push.controller.js` | DB calls → store; drop direct model requires | R3, R4 |
| `server/routes/v000705/routePushNotification.js`, `v000902/route.push.update.list.js` | unknown category → 403 | R6 |
| `server/bin/push-worker` (new) | worker entry point | R7 |
| `server/package.json`, `package-lock.json` | `sql.js` 1.8.0 exact | R8 |
| `server/test/offline/push-store.test.js`, `push-store-concurrency.js`, `push-worker-smoke.js` (new), `run.js` | tests | AC1–AC7 |
| `.github/workflows/rss-offline.yml` | run new tests on Node 16/22 and in the Node 10.15.3 job | AC6 |
| `docs/architecture/push-notifications.md`, `diagrams/push-notifications.{json,html}`, `docs/operations/push-sqlite.md` (new), `server/.env.example`, `server/CONFIGURATION.md` | docs and env | AC8 |

## Order

1. Tests first against master: route/semantics tests fail (no store module; D7 defects; 403).
2. `sqliteFileStore` → `pushStore` (sqlite, mongo) → controllers → routes → worker.
3. Green on Node 22; post-refactor on Node 16.20.2 and Node 10.15.3 (Docker).
4. Smokes: concurrency and worker on Node 10.15.3 and 16.20.2.
5. Regression: `test:offline` with CI deps; runtime tests.
6. Docs, Archify validate/deliver/visual check.
7. Commit, push, PR, CI; independent verification; decisions/progress comments on #2626.

## Commands

```sh
NODE_PATH=<deps> node server/test/offline/push-store.test.js
NODE_PATH=<deps> node server/test/offline/push-store-concurrency.js
NODE_PATH=<deps> node server/test/offline/push-worker-smoke.js
docker run --rm -v $PWD:/w -v <deps10>:/deps -w /w -e NODE_PATH=/deps/node_modules node:10.15.3-stretch node server/test/offline/push-store.test.js
```

## Rollback and blast radius

Default unchanged (Mongo). With `PUSH_STORE=sqlite`: push registration writes on tw-svc and delivery. Rollback: unset `PUSH_STORE`, restart workers, stop `push-worker`. Mongo-path changes: D7 fixes and 403 for unknown category.

## Risks

- Lost update through lock recovery: covered by stale-lock tests.
- Controller refactor regressions in Mongo mode: existing runtime tests plus Mongo adapter query-shape tests.
- Riskiest part: token-update collisions on the unique key.
- Rejected: single writer process with IPC; native SQLite.

## Gate

PROCEED within the `pr` endpoint.
