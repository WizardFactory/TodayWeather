# Current-weather summary "undefined" fix — 2026-09-25

## Symptom

App main screen for 서울특별시 showed `어제보다 -3˚, undefined` (screenshot from AK, 22:13 KST). The public API `GET /v000903/kma/coord/37.5665,126.9780` returned `current.weather = null`, `current.weatherType = -1`, `summaryWeather = "어제보다 -3˚, undefined"`.

## Root cause

The hourly/city enrichment restore (issue #2573 / PR #2575; this fix: #2576) re-enabled KMA `currentweather.jsp` city text (e.g. `비끝`, `약한비연속적`) flowing into `current.weather` via `kmastnhourly2`. The modern KMA page wording differs from the legacy vocabulary hard-coded in `controller.weather.desc.js::makeWeatherType` (legacy: `비끝남`, `약한비계속`, `약한비단속`). Unknown strings returned `-1`. `controllerKmaStnWeather.updateWeather` only falls back to sky/pty when `weatherType` is `undefined`, so `-1` passed through; `getWeatherStr(-1)` indexed the label array out of range and returned `undefined`; `controllerTown24h.makeSummaryWeather` (and `controllerTown.makeSummary` for `current.summary`) pushed the item unconditionally, so the summary was `"<diff>, undefined"`.

Service host PM2 error logs (`www-error-*.log`) over the day: `Fail weatherStr=비끝` ×115, `약한비연속적` ×52, `약한비단속적` ×1. Strings seen in out logs: `비끝`, `약한비연속적`, `약한비계속`, `약한비단속적`, `보통비계속`, `약한비`, `비`, `흐림`, `구름많음`, `구름적음`, `맑음`.

## Fix (repository, PR #2577)

- `server/controllers/controller.weather.desc.js`
  - `normalizeKmaWeatherStr` (applied in `makeWeatherType`) rewrites modern KMA wording to the legacy vocabulary before lookup. `연속적` becomes `계속` and `단속적` becomes `단속`. `비끝`/`눈끝` become `비끝남`/`눈끝남`. Rain/snow with only an intensity or only a suffix gets the missing part (`보통`, `계속`). Drizzle, sleet and showers intensities map to their legacy forms (`약한진눈깨비` becomes `약진눈깨비`), and `안개` becomes `안개변화무`. Bare `비`/`눈` stay KMA AWS types 65/66. `구름적음` maps to type 1.
  - `getWeatherStr`: returns `""` for a missing, negative or out-of-range `weatherType` (out-of-range is logged), never `undefined`.
- `server/controllers/controllerKmaStnWeather.js` `updateWeather`: treats `weatherType < 0` like `undefined`. Unmapped text falls back to sky 0–4 when there is no precipitation. With precipitation it falls back to the KMA PTY code: 1/2/3 → 비/진눈깨비/눈, 4 소나기 → 소나기, 5 빗방울 → 약한비, 6 빗방울눈날림 → 약진눈깨비, 7 눈날림 → 약한눈. Before this change, PTY 4–7 showed 맑음. A missing or negative pty, or pty 0 with a sky outside 0–4, still leaves `weatherType -1` and `weather ""`, and the summaries omit the item.
- `server/controllers/controllerTown.js` `_hasWeatherText`, used by `makeSummary` and `makeSummaryWeather`: the weather item is added only when `weatherType >= 0` and `weather` is a non-empty string.
- `server/test/offline/weather-desc.test.js` (in `npm run test:offline` and the rss-offline Node 16/22 matrix) covers the wording map, empty labels, the updateWeather sky/PTY 1–7 fallback and both summary builders. `weather-desc-response-smoke.js` runs the actual v000903 route for 12 scenarios: observed wording, `-1` with sky, pty 1 and nowcast pty 5 fallbacks, and an invalid sky giving `weather ""`. It asserts no swallowed exceptions. Neither needs a DB or network.

## Deployment (first PR revision f40002d7; service host 13.124.25.12, `/home/ec2-user/tw-svc/server`)

The host runs the first revision: explicit `case` strings in `makeWeatherType`, the `getWeatherStr` guard and a `makeSummaryWeather` guard. The normalization, `updateWeather` fallback and `makeSummary` guard from the review follow-up are **not deployed**. Redeploy after merge.

- Backup: `/home/ec2-user/tw-svc-backup-weatherdesc-20260925132543/` (both files).
- `controller.weather.desc.js` copied whole (host file was identical to `HEAD` before; md5 after `b862b6dd…` matched f40002d7).
- `controllerTown24h.js` patched by hunk only — the host copy carries two deployed-only lines (`historyStatus`, `lib/history/policy` hourlyResponse) that are not in this checkout; do not overwrite it wholesale.
- `node --check` both files, the first-revision offline test passed on host (Node 16), `pm2 reload www` (10 workers online, restart_time 2).
- Verified through CloudFront 13:25 UTC: `weather: 비끝`, `weatherType: 28`, `summaryWeather: 어제보다 -3˚, 비끝`, `liveTime 2224`.

## Notes / follow-ups

- Host SSH: server host key changed after the AMI migration; the ED25519 fingerprint matched `docs/architecture/ec2-access.md`, so a scratch `UserKnownHostsFile` pinned to it was used. Global known_hosts still has the stale ECDSA entry at line 10.
- KMA may emit other strings not yet mapped; `Fail weatherStr=` in `www-error-*.log` is the signal. With the follow-up revision, `updateWeather` falls back to sky or PTY 1–7 text. On the currently deployed first revision, such a string leaves `weatherType: -1` and `weather: ""`. `summaryWeather` omits the weather item, but `current.summary` (`makeSummary`, unguarded there) can still contain an empty item. The items are sorted by grade and joined with `", "`, so the summary can start or end with `", "`.
- CDN caches up to 5–10 min; clients see the fix after edge expiry.
- Rollback: restore both files from the backup dir and `pm2 reload www`.
