# Intent: Store push registrations in SQLite on tw-svc and deliver from tw-svc — issue 2626

Revision 1, 2026-09-27. Owner: main agent for AK. Source: AK request (2026-09-27) and issue [#2626](https://github.com/WizardFactory/TodayWeather/issues/2626). Design and decisions are posted on #2626 (design comment 5857629072, decisions D1–D11 5857629228, scope 5857638417).

## Problem

Push registrations are stored in MongoDB, and the delivery workers on the gather host are not running, so the Cordova 1.1.0 app's alarms and alerts are never delivered. MongoDB is being retired (#2614). AK wants tw-svc to receive push registrations, keep them in a SQLite file, and deliver from there, following the notice storage in #2623.

## Acceptance criteria

- AC1: With `PUSH_STORE=sqlite` and `PUSH_DB_PATH`, `POST /v000902/push-list`, `PUT /v000902/push` and `DELETE /v000902/push` through the real routers leave exactly the expected alarm/alert rows in the file.
- AC2: A token change updates every record of the old token (alarm and alert). `DELETE` with `cityIndex: 0` removes only city 0. An unknown `category` returns 403 (push-list and DELETE). The same holds for the Mongo store.
- AC3: 10 concurrent writer processes posting distinct records end with every record present and `PRAGMA integrity_check` = `ok`. A writer's event loop is never blocked for more than 100 ms while waiting for the lock.
- AC4: A lock left by a dead process is recovered, and concurrent waiters on a stale lock do not lose updates.
- AC5: With the SQLite store, the push worker sends the alarm for the current UTC slot and day of week, and an alert inside its window at most once in 6 hours. It disables a token reported as unregistered, and it opens no MongoDB connection.
- AC6: Store and worker tests pass on Node 10.15.3 (`node:10.15.3-stretch`) and Node 16.20.2. A written file reports `user_version` 1 through Python `sqlite3`.
- AC7: With `PUSH_STORE` unset, behavior stays on MongoDB and the existing offline suites pass.
- AC8: Docs: `push-notifications.md` and its Archify diagram describe the SQLite store and tw-svc worker; a runbook covers env, PM2 process, backup and rollback. Deployment, credentials and device delivery remain human-owned checks in #2626.

## Scope

In: `server/lib/sqliteFileStore.js`, `server/lib/pushStore/` (mongo + sqlite), controller DB calls, route error fixes, `server/bin/push-worker`, tests, CI, docs.

Out: Mongo import CLI (deferred, #2626 scope comment); legacy GCM delivery; message wording/languages (#2612); notices (#2623); server2 (#2614); deployment, Firebase credentials, device verification.

## Constraints

Node 10.15.3 syntax and APIs for all runtime code; `sql.js` pinned 1.8.0; client contract unchanged; no credentials in tests or docs; public repo redaction rules.

## Authority and endpoint

Endpoint `pr`: implementation, tests, commits, push to `ak-fork`, PR to master, CI, issue comments on #2626. Excluded: merge, deployment, host changes, credentials. Other-provider review skipped per AK.

## Risks

- Whole-file rewrite per write grows with the record count; measured size is unknown until import or re-registration.
- The worker and service workers share one file; a bug in lock recovery could lose an update.
- `sql.js` loads ~1 MB WASM per process (10 workers + 1 worker).
