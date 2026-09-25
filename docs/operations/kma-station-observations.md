# KMA station observations: collection and current-weather merge

Operator runbook for issue [#2573](https://github.com/WizardFactory/TodayWeather/issues/2573). The execution records hold host-level evidence: [minute collection restore](gather-minute-collection-restore-2026-09-25.md) and [hourly collection and service merge restore](hourly-and-service-enrichment-restore-2026-09-25.md). Both describe the 2026-09-25 production state. This runbook covers the code in this repository.

## Components

| Part | Process | Code | Control |
| --- | --- | --- | --- |
| Minute collector | gather `www` (`SERVER_MODE=gather`) | `Manager.prototype.startMinuteScrape` → `KmaScraper.getStnMinuteWeather` | `KMA_STN_MINUTE_ENABLED=true`; `KMA_STN_MINUTE_INTERVAL` minutes (default 2; invalid or `<1` → 2) |
| Hourly collector | gather `www` | `Manager.prototype.startHourlyScrape` → `KmaScraper.getStnHourlyWeather` (AWS 60-minute table + city observation page) | `KMA_STN_HOURLY_ENABLED=true`; `KMA_STN_HOURLY_MINUTES` UTC minute list (default `4,9,15,30`) |
| Current-weather merge | service `www` | `controllerKmaStnWeather.getStnHourlyAndMinRns`, `ControllerTown.getKmaStnMinuteWeather` | No flag; active wherever the code is deployed |

Both collector flags are off by default. They are evaluated only when `config.mode === 'gather'`. `scrape`/`local` modes keep using `startScrape`, and these flags do not change them. Each collector runs at most one poll at a time. Errors and synchronous throws are logged and never stop the worker.

## Data and time contract

- Minute rows go to `kmastnminute2` and hourly rows to `kmastnhourly2`. Both use the unchanged legacy convention: the KST wall-clock time is stored as if it were UTC (`19:41Z` means 19:41 KST). Readers compare against a KST-shifted "now" built the same way. Any new reader must follow this convention or convert explicitly.
- Writes upsert by `stnId` + `date`, so repeated polls of the same observation keep one row.
- Existing retention applies. Minute rows older than one day are removed after each minute poll. Because the delete compares real "now" with KST-as-UTC dates, about 33 hours of minute data remain in practice. Hourly retention is ten days. AK accepted keeping this behavior.
- City-page failures no longer abort the hourly run. The AWS rows are saved without city fields (weather text, cloud, visibility).
- A new station gets its `KmaStnInfo` (with `geo`) on the next hourly run. Geocoding tries Kakao first (`KAKAO_SECRET_KEYS`, retries lowered from 30 to 3). If that fails, it falls back to the product geocode API `API_SERVER/geocode/addr/<address>`, which needs no provider key; only `country: KR` results inside national bounds are accepted. If both fail, the station is logged (`skip stnInfo (geocode unavailable)`) and retried at the next hourly run minute (`KMA_STN_HOURLY_MINUTES`). The observation rows are always saved.
- When the city page is unavailable, the saved `isCityWeather` flags are left unchanged. City-station selection (`getStnList(..., true, ...)`) depends on those flags.

## Service merge rule

- Missing hourly rows no longer block the minute read. `stnWeather.hourlyMissing` is set instead.
- An observation that is newer than `currentPubDate` (`stnFirst`) replaces `t1h`, `reh`, `vec` and `wsd` when `_isValidObservation` passes:
  - `t1h` in (-50, 60)
  - `reh` in 0–100
  - `vec` in 0–360
  - `wsd` in [0, 100)
- An older observation only fills missing or sentinel values, as before.
- `rn1` keeps its existing rule: when the API value is missing or the observation is newer, it is set from the station's `rs1h` (one-hour rain, normally from the minute row) if present. The original API values remain in `current.dongnae`, and `liveTime` is the observation time.

## Verification (read-only)

0. Gather environment: `API_SERVER` is set to the public product host (needed for the station geocoding fallback).

1. Gather log: `kma stn minute done stations=<n>` every interval and `kma stn hourly done stations=<n>` hourly. No `failed`, `threw` or repeated `still running` lines.
2. Database (read-only): the newest `kmastnminute2` rows for `stnId` 108/159/184 advance each poll. The hourly rows for the latest hour exist.
3. API: `GET /v000903/kma/coord/37.5665,126.9780` on the origin and the public CDN. `current.liveTime` and `current.t1h` match the stored observation, and `current.dongnae` holds the forecast-derived value.
4. After deploying code changes: `npm --prefix server run test:offline` (see `.github/workflows/gather-offline.yml` for isolated dependencies).

## Rollback

- Collectors: unset `KMA_STN_MINUTE_ENABLED` and/or `KMA_STN_HOURLY_ENABLED`, then `pm2 restart www --update-env` and `pm2 save`. Ordinary gather continues.
- Service merge: redeploy the previous `controllerTown.js` and `controllerKmaStnWeather.js`. Host backup directories are listed in the execution records.
- Do not restore the stale `www.weather.go.kr` `/etc/hosts` pin. Do not delete collected rows as a rollback step.

## Known limitations

- **Stations without `KmaStnInfo` (backfilled 2026-09-25, AK-approved).** A read-only comparison found 38 reporting stations without `KmaStnInfo`, including city station 181 (서청주). 36 rows were inserted directly into `kmastninfos`: 26 with coordinates from the product geocode API, and 10 with 읍면동 centroids from `server/utils/data/base.csv` after the API returned 502. The rows use the collector's field format and are skipped if the `stnId` already exists. The collection went from 738 to 774 rows, and city stations from 96 to 97. Rollback: delete the 36 `_id`s `6ab692ae3e58ed79d5378221`–`6ab692ae3e58ed79d5378244`. Stations 334 (속초 중앙) and 341 (서전주) were left out because their administrative district was uncertain. They are registered by the geocoding fallback after gather is redeployed and `API_SERVER` points to the public product host. The default `http://localhost` does not serve `/geocode`, so it only skips.
- Cache delay is added on top of the observation age (up to two-minute collection plus the 20-minute read window). The direct `/v000903/kma/...` route uses the CloudFront default behavior (MinTTL/DefaultTTL 300 s, MaxTTL 600 s in the [2026-09-20 evidence](../architecture/aws-readonly-evidence-2026-09-20.json)). The app's `/weather/*` route goes through the weather Lambda (`max-age=300`). The 2026-09-25 live check covered only the direct route.
- Host `/etc/hosts` repair and PM2 environment were saved on the running instances only. Replacement instances (AMI/provisioning) and a PM2 boot restart were not rehearsed.
