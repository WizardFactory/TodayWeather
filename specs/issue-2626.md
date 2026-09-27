# Spec: Push registrations in SQLite on tw-svc — issue 2626

Revision 1, 2026-09-27. Consumes [intent](../intent/issue-2626.md) r1 and `reports/sdlc/issue-2626/investigation.md`.

## Requirements

| ID | Requirement | AC |
| --- | --- | --- |
| R1 | `server/lib/sqliteFileStore.js`: `create({file, schemaSql, version, log})` returns `{mutate(fn), read(fn)}`. `mutate` runs `fn(db)` under a cross-process lock on the freshest file and replaces the file (temp, fsync, rename, directory fsync); if `fn` throws nothing is written. `read` reuses an in-memory copy while `ino:size:mtime` is unchanged. Missing file → created with the schema on first write; readers see an empty schema. A file with another `user_version` is refused. | AC1, AC6 |
| R2 | Lock: `<file>.lock` created with `O_EXCL`, containing `pid` and time. Waiting uses timers (poll ≤ 50 ms) and gives up after 5 s with an error. Within a process, writes are serialized. A lock is stale when its PID is not alive on this host or it is older than 30 s; a waiter takes it over by renaming it to a unique name (only one rename succeeds), then retries `O_EXCL`. | AC3, AC4 |
| R3 | `server/lib/pushStore/index.js` returns one store per process: `PUSH_STORE=sqlite` → SQLite store at `PUSH_DB_PATH` (required; startup error when missing); unset or `mongo` → Mongo store. Both implement: `upsertAlarm, removeAlarms, updateAlarmToken, disableAlarmsByFcm, getAlarmsByTime, removeDuplicateAlarms, upsertAlert, removeAlerts, updateAlertToken, disableAlertsByFcm, getAlertsByTime, updateAlertState, removeDuplicateAlerts, removeOldAlerts`, callback style. | AC1, AC7 |
| R4 | Semantics, both stores: upsert merges fields into the record matched by `{type, cityIndex, id, registrationId or fcmToken}`. Token updates and FCM disabling apply to every matching record. Removal narrows by `cityIndex` and `id` when they are defined (0 included). Alarm selection: `pushTime = time` and `enable !== false`. Alert selection: `enable = true`, inside `[startTime, endTime]` or the reversed window, and neither `precipAlerts.pushTime` nor `airAlerts.pushTime` within the last 6 h. `removeOldAlerts` keeps today's effective behavior (no deletion). Dates round-trip as `Date`. | AC1, AC2, AC5 |
| R5 | SQLite schema (`user_version = 1`): tables `alarms` and `alerts` with `id INTEGER PRIMARY KEY`, `registration_id`, `fcm_token`, `key_token` (registrationId or fcmToken), `type`, `city_index`, `item_id`, selection columns (`push_time`, `enable`; alerts: `start_time`, `end_time`, `reverse_time`), `updated_at`, and `doc` (JSON of the record). Unique `(key_token, type, city_index, item_id)`. A token update that would collide keeps the more recently updated record. | AC1, AC6 |
| R6 | Routes: unknown `category` in `push-list` → 403 `invalid category`; in `DELETE` → 403. Other responses unchanged. | AC2 |
| R7 | `server/bin/push-worker`: loads env/config and logger, requires `PUSH_STORE=sqlite`, starts the alarm and alert schedulers, opens no HTTP listener and no MongoDB connection. PM2: one fork process. | AC5 |
| R8 | `sql.js` 1.8.0 exact in `server/package.json` and lock. Runtime code uses Node 10 syntax. | AC6 |

## Failure behavior

Lock timeout or file error → the route returns 500 as today for store errors; the worker logs and continues at the next tick. A corrupt or wrong-version file is logged; reads keep the last good copy; writes fail rather than overwrite it.

## Compatibility

Client contract unchanged. Mongo path stays default; D7 fixes also apply there (`multi: true`, defined checks). Rollback: unset `PUSH_STORE` and restart; stop the push worker.

## Security

The file holds device tokens: mode 0600 on create; path outside the web root; never logged in full. No credentials in tests or docs.

## Verification

- Unit/route (Node 10.15.3, 16.20.2, 22): `push-store.test.js` — SQLite semantics, Mongo adapter query shapes with a stubbed model, real routers over local HTTP with stubbed heavy modules.
- Concurrency smoke: `push-store-concurrency.js` — 10 processes × 20 records, event-loop lag probe, dead-PID lock, two waiters on a stale lock, Python `sqlite3` integrity/user_version.
- Worker smoke: `push-worker-smoke.js` — real controllers + SQLite store, loopback weather stub from the RSS smoke response, FCM stub; alarm slot/day-of-week, alert window + 6 h guard, unregistered token disabling; `bin/push-worker` start with Mongo connect/listen refused.

## Alternatives

- One writer process with IPC from the workers: rejected; more moving parts for ~100 writes/day.
- Native `sqlite3`/`better-sqlite3` with WAL: rejected on Node 10.15.3/glibc 2.17 (#2623).
- Reuse the notice lock: rejected (blocks event loop, racy takeover).
