# Push store on tw-svc (SQLite)

Runbook for issue [#2626](https://github.com/WizardFactory/TodayWeather/issues/2626). Design: [push notifications](../architecture/push-notifications.md#sqlite-store-on-tw-svc).

## Settings

| Variable | Where | Value |
| --- | --- | --- |
| `PUSH_STORE` | `server/.env` (service workers and push worker) | `sqlite`; unset = MongoDB |
| `PUSH_DB_PATH` | same | absolute path outside the checkout, on a persistent volume |
| `SERVICE_SERVER` | push worker | service URL for weather, for example the local nginx |
| `API_SERVER` | push worker | geocoding base URL (`/geocode/v000903/coord`) |

Firebase service-account files (`server/config/*firebase-adminsdk*.json`) must exist for FCM sends. They are not in Git.

## Switch

1. Deploy the code and run `npm ci` in `server/` with the host's Node (10.15.3); this installs `sql.js` 1.8.0.
2. Create the directory for `PUSH_DB_PATH` (owner = the PM2 user). The file is created on the first write with mode 0600.
3. Set `PUSH_STORE` and `PUSH_DB_PATH` in `server/.env` and reload the service workers (`pm2 reload www`).
4. Stop any `SERVER_MODE=push` process (for example `tw-push`, `tw-alert-push`) so notifications are not sent twice.
5. Start exactly one worker from `server/`: `pm2 start bin/push-worker --name tw-push-worker` (fork mode, one instance).
6. Check: the worker log shows `push-worker started store=sqlite`; after an app launch, `sqlite3 "$PUSH_DB_PATH" 'SELECT COUNT(*) FROM alarms; SELECT COUNT(*) FROM alerts;'` counts rows.

Existing MongoDB records are not imported. Apps with a token re-post their full list at every launch.

## Backup

The file is replaced atomically on each write, so a plain copy is consistent. Copy it daily off the host, for example `cp "$PUSH_DB_PATH" /tmp/push-$(date -u +%F).sqlite` followed by an upload to S3. `PRAGMA user_version` is 1.

## Rollback

Unset `PUSH_STORE` in `server/.env`, reload the service workers and stop `tw-push-worker`. Delivery from MongoDB again needs a `SERVER_MODE=push` process. Registrations made while SQLite was active return to MongoDB when the apps next launch.

## Limits

- Writes wait up to 5 s for the lock; a lock whose owner process is gone, or older than 30 s, is removed.
- Each write rewrites the whole file; size grows with the number of registrations.
- Legacy GCM (`registrationId`) and iOS records without an FCM token cannot be delivered.
