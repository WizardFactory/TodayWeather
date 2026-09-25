# Current-weather summary "undefined" fix — 2026-09-25

## Symptom

App main screen for 서울특별시 showed `어제보다 -3˚, undefined` (screenshot from AK, 22:13 KST). The public API `GET /v000903/kma/coord/37.5665,126.9780` returned `current.weather = null`, `current.weatherType = -1`, `summaryWeather = "어제보다 -3˚, undefined"`.

## Root cause

The hourly/city enrichment restore (issue #2573 / PR #2575; this fix: #2576; `docs/operations/hourly-and-service-enrichment-restore-2026-09-25.md` on that branch) re-enabled KMA `currentweather.jsp` city text (e.g. `비끝`, `약한비연속적`) flowing into `current.weather` via `kmastnhourly2`. The modern KMA page wording differs from the legacy vocabulary hard-coded in `controller.weather.desc.js::makeWeatherType` (legacy: `비끝남`, `약한비계속`, `약한비단속`). Unknown strings returned `-1`; `getWeatherStr(-1)` indexed the label array out of range and returned `undefined`; `controllerTown24h.makeSummaryWeather` pushed the item unconditionally, so the summary was `"<diff>, undefined"`.

Service host PM2 error logs (`www-error-*.log`) over the day: `Fail weatherStr=비끝` ×115, `약한비연속적` ×52, `약한비단속적` ×1. Strings seen in out logs: `비끝`, `약한비연속적`, `약한비계속`, `약한비단속적`, `보통비계속`, `약한비`, `비`, `흐림`, `구름많음`, `구름적음`, `맑음`.

## Fix (repo + deployed)

- `server/controllers/controller.weather.desc.js`
  - `makeWeatherType`: accept modern KMA wording — `비끝`/`눈끝`, `약한비`/`보통비`/`강한비`, `약한눈`/`보통눈`/`강한눈`, `*연속적` → continuous (계속), `*단속적` → intermittent (단속), `약한/강한진눈깨비`, `이슬비`.
  - `getWeatherStr`: return `""` for negative or out-of-range `weatherType` and log the value, never `undefined`.
- `server/controllers/controllerTown24h.js` `makeSummaryWeather`: only push the weather-text item when `weatherType >= 0` and `weather` is a non-empty string; otherwise `log.warn`.
- `server/test/offline/test.weather.desc.js`: 15 assertions (mapping + label lookup), no DB/network. Run `node test/offline/test.weather.desc.js` from `server/`.

## Deployment (service host 13.124.25.12, `/home/ec2-user/tw-svc/server`)

- Backup: `/home/ec2-user/tw-svc-backup-weatherdesc-20260925132543/` (both files).
- `controller.weather.desc.js` copied whole (host file was identical to `HEAD` before; md5 after `b862b6dd…` matches repo).
- `controllerTown24h.js` patched by hunk only — the host copy carries two deployed-only lines (`historyStatus`, `lib/history/policy` hourlyResponse) that are not in this checkout; do not overwrite it wholesale.
- `node --check` both files, offline test passed on host (Node 16), `pm2 reload www` (10 workers online, restart_time 2).
- Verified through CloudFront 13:25 UTC: `weather: 비끝`, `weatherType: 28`, `summaryWeather: 어제보다 -3˚, 비끝`, `liveTime 2224`.

## Notes / follow-ups

- Host SSH: server host key changed after the AMI migration; the ED25519 fingerprint matched `docs/architecture/ec2-access.md`, so a scratch `UserKnownHostsFile` pinned to it was used. Global known_hosts still has the stale ECDSA entry at line 10.
- KMA may emit other strings not yet mapped; `Fail weatherStr=` in `www-error-*.log` is the signal. The summary no longer breaks when that happens, but the sky icon/text would fall back to plain sky.
- CDN caches up to 5–10 min; clients see the fix after edge expiry.
- Rollback: restore both files from the backup dir and `pm2 reload www`.
