# Gather minute-observation collection restore — 2026-09-25

**Result: KMA AWS minute observations are being collected again on the gather host, every 2 minutes, 745 stations per poll.** Scope was gather-side collection only (authorized by AK in chat). Service-side consumption of these observations (issue #2573 §3) is **not** changed: the current-weather API still does not reflect them until the service merge policy and hourly dependency are addressed.

Related: [diagnosis](minute-observation-diagnosis-2026-09-25.md), [restart review](minute-observation-restart-review-2026-09-25.md), issue [#2573](https://github.com/WizardFactory/TodayWeather/issues/2573).

## Decisions taken by AK

- Restore **minute** collection only; hourly (city-weather dependent) is deferred.
- Remove the stale `139.150.249.162 www.weather.go.kr` pin from `/etc/hosts`; keep the `openapi.airkorea.or.kr` pin untouched.
- Keep the existing collector behavior of deleting `kmastnminute2` rows older than 1 day.
- Deploy by modifying the existing `www` gather process and restarting it (not a separate PM2 app).

## Code change (in this repository and on the host)

- `server/controllers/controllerManager.js`: new `Manager.prototype.startMinuteScrape(options)` — independent timer that calls only `scrape.getStnMinuteWeather()`, one poll in flight, errors logged without throwing. Interval from `KMA_STN_MINUTE_INTERVAL` (minutes, default 2). Does **not** reuse `startScrape`, which also enqueues hourly/warning jobs and the gather `asyncTasks` queue.
- `server/app.js`: gate `if (process.env.KMA_STN_MINUTE_ENABLED === 'true' && config.mode === 'gather') manager.startMinuteScrape();` — off by default.
- `server/test/offline/test.minute.scrape.js`: 6 VM-isolated tests (interval defaults/override, in-flight guard, error handling, sync throw, stop, app.js gate matrix). Run: `node server/test/offline/test.minute.scrape.js [path/to/controllerManager.js]`. Passed locally (Node 22) and on the host against the deployed file (Node 16.20.2).

The same two source edits were applied to the host checkout `/home/ec2-user/tw-gather/server` (revision `c9220de3` + pre-existing local overrides) by appending the function before `module.exports` and inserting the gate before the 404 handler; `node --check` passed on both files.

## Host changes

| Item | Before | After |
|---|---|---|
| `/etc/hosts` | `139.150.249.162 www.weather.go.kr` (2018) | line removed; backup `/etc/hosts.bak-20260925` |
| `www.weather.go.kr` resolution | pinned, connections time out | DNS → `139.150.252.6`, `139.150.249.139` (KINX CDN); legacy URL HTTP 200 in 0.03s |
| `www` PM2 env | no `KMA_STN_MINUTE_ENABLED` | `KMA_STN_MINUTE_ENABLED=true` (via `pm2 restart www --update-env`) |
| `www` process | pid 5614, restarts 0 | pid 21849, restarts 1 (the intentional restart), online |
| PM2 dump | saved without the flag | `pm2 save` at ~10:49 UTC; dump shows the flag and Node 16 interpreter; modules unchanged in `module_conf.json` |

Backups: `/home/ec2-user/tw-gather-backup-minute-20260925104304/` holds `app.js`, `controllers/controllerManager.js`, `hosts`, `dump.pm2.before`.

Note: `openapi.airkorea.or.kr` at its pinned IP timed out during the check. This was pre-existing and out of scope; not changed.

## Verification

- Log (UTC): collector start `intervalMs=120000`; polls at 10:44:07, 10:46:07, 10:48:07 each `stations=745`, ~0.9–1.0 s; zero `failed`/`threw`/`previous poll still running` lines. Gather `start tasks counts` loop continued every 30 s. `/health` 200.
- Native read-only DB readback at 10:48:29 UTC (`kmastnminute2`): total 2235 docs, oldest `2026-09-25T19:41:00.000Z`, stations 108/159/184 each have 3 distinct slots (…19:41, 19:43, 19:46) with values e.g. Seoul 18.9 °C / 86 %. The 2021 rows were deleted by the collector's existing 1-day retention, as AK accepted.
- **Timestamp caveat (pre-existing, unchanged):** the parser stores KST wall-clock strings as if UTC, so `19:41Z` here means 19:41 KST. Consumer code (`_getStnMinute2`) compares against a KST-shifted "now" built the same way, so it is internally consistent. Any new consumer must follow the same convention or convert explicitly (#2573 §2).

## Not done / remaining

- Service does not yet use the new observations (hourly prerequisite + valid-value-preserving merge). See #2573 §3.
- Hourly (`kmastnhourly2`) collection still stopped; requires city-weather parser fix.
- No boot-service stop/start rehearsal was performed; the dump was saved and verified to contain the flag.
- Host source is still the pre-existing override state plus this patch; the repository branch carries the same change for review.

## Rollback

1. `pm2 restart www` after removing `KMA_STN_MINUTE_ENABLED` from the environment (`pm2 restart www --update-env` with the variable unset, or `pm2 delete www` + re-add from the backup dump) — the collector then never starts.
2. Optionally restore `app.js` / `controllerManager.js` from the backup directory.
3. Do **not** restore the stale hosts pin; it broke every weather.go.kr request.
