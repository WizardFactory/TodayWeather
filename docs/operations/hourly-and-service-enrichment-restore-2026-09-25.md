# Hourly collection + service enrichment restore — 2026-09-25

Follow-up to [gather minute-collection restore](gather-minute-collection-restore-2026-09-25.md); closes §1.3 and §3 of issue [#2573](https://github.com/WizardFactory/TodayWeather/issues/2573) operationally. Authorized by AK in chat ("2건도 수정 진행").

**Result: the public current-weather API now reflects KMA AWS minute observations.** Seoul at 13:14 UTC: `t1h` 18.6 from the 22:12 KST observation replaced the 20:00 KST API value 18.8 (`dongnae.t1h`); `liveTime=2212`, `overwrite=true`, `cityMinAws` and `cityHourAws` populated. Verified at the origin and through CloudFront (`x-cache: Hit`, `age: 4`).

## 1. Hourly (`kmastnhourly2`) collection — gather host

### Root cause

`KmaScraper.getCityWeather` fetched `currentweather.jsp` as `encoding:'binary'` and always ran `Iconv('euc-kr','UTF8')`. The 2021+ KMA page is UTF-8, so Iconv threw `Illegal character sequence.`; the callback received an Error, and `getStnHourlyWeather`'s merge step dereferenced `cityWeatherList.pubDate` on that Error → `TypeError`. Additionally, the modern page uses `#weather_table`/`cmp-table-topinfo` instead of `.table_develop3`/`.table_topinfo`, and renders wind speed through `writeWindSpeed('2.1')` inside a `<script>` in the cell.

### Fix (`server/lib/kmaScraper.js`)

- `_decodeKmaHtml(body, response)`: request with `encoding:null`; decode as UTF-8 when the `Content-Type` header or `<meta charset>` says so, otherwise EUC-KR via Iconv with UTF-8 fallback on decode error.
- `_parseCityWeatherHtml(html, pubDate)`: pure parser extracted from `getCityWeather`; supports both `#weather_table` (modern) and `.table_develop3` (legacy) layouts; reads `pubDate` from `.cmp-table-topinfo`/`.table_topinfo` or `input[name=tm]`; strips `<script>` from header/cells and extracts `wsd` from `writeWindSpeed(...)`; omits blank/`-` cells instead of storing `NaN`; returns an `Error` (never throws) on missing header or bad `pubDate`.
- `getStnHourlyWeather` merge step: if city weather is unavailable (Error or malformed), log and **save the AWS hourly rows alone** instead of failing the run.
- `_saveStnInfo`: geocode failure (the host has no Kakao key → `SyntaxError: Unexpected token u`) is logged and skipped; it no longer aborts the batch. New stations without coordinates simply do not get a `KmaStnInfo` row.

### Scheduler (`server/controllers/controllerManager.js`, `server/app.js`)

`Manager.prototype.startHourlyScrape(options)`: 30-second tick; runs `getStnHourlyWeather(undefined)` once per configured minute past each hour (`KMA_STN_HOURLY_MINUTES`, default `4,9,15,30` — retries within the hour because the HH:00 table is usually complete a few minutes after the hour). One run in flight; `'skip'` result (already up to date) is informational. Gated by `KMA_STN_HOURLY_ENABLED=true && config.mode === 'gather'`.

### Deployment

- Host checkout patched by anchored insertion (same procedure as the minute collector); backup `/home/ec2-user/tw-gather-backup-hourly-20260925111730/`.
- `KMA_STN_HOURLY_ENABLED=true` added to the `www` PM2 env via `pm2 restart www --update-env`; `pm2 save`. Final `www` restart at 11:36:35 UTC (restart count 4, all intentional).
- Pre-deploy dry run on the host (real HTTP + real parser + real `_saveStnInfo`, `_saveStnHourly2` stubbed): 745 rows, 97 with city fields, 0 `NaN`, 0 city rows without an AWS match, Seoul row carried `weather: '비끝'`, `visibility`, `cloud`, `dpt`, `hPa`. 25 new stations skipped stnInfo (no geocode). 1.46 s.

### Verification

- Log: `kma stn hourly done stations=745 elapsedMs=1621` at 13:09:10 UTC; no `failed`/`threw` lines. Minute collector unaffected (`done stations=745` every 2 min).
- DB readback 13:14 UTC: `kmastnhourly2` 1512 docs, Seoul slots 21:00 and 22:00 (KST-as-UTC convention) with `weather`, `cloud`, `visibility`; `kmastnminute2` 57 365 docs, Seoul 77 slots, newest 22:10.

## 2. Service enrichment — service host

### Root cause

`controllerKmaStnWeather.getStnHourlyAndMinRns` aborted the whole waterfall when `findHourlies2` had no rows (`Fail to find hourlies`), so minute data was never read. In `controllerTown.getKmaStnMinuteWeather`, `t1h` was only replaced when `<= -50` and `reh/vec/wsd` only when `< 0` — a valid-but-stale API value always won, even when `stnFirst` (observation newer than `currentPubDate`) was true.

### Fix

- `server/controllers/controllerKmaStnWeather.js`: hourly lookup failure → `log.warn`, set `stnWeather.hourlyMissing = true`, continue to the minute step.
- `server/controllers/controllerTown.js`: new `_isValidObservation(key, value)` (finite number; `t1h` in (-50, 60), `reh` 0–100, `vec` 0–360, `wsd` 0–100). In the merge loop, when `stnFirst` is true, `t1h/reh/vec/wsd` are replaced by a valid observation; when the observation is older (`stnFirst` false) the old fill-only-missing/sentinel behavior is unchanged. `rn1` and every other field keep the old rules. Original API values remain in `current.dongnae`.

### Deployment

- Same two edits applied to `/home/ec2-user/tw-svc/server` (host tree carries other pre-existing overrides; blocks verified byte-identical to the repo working tree). Backup `/home/ec2-user/tw-svc-backup-minute-20260925112057/`.
- `pm2 restart www` (cluster, 10 workers) at 11:21:39 UTC; all workers online, restart count 1.

### Verification (13:14–13:15 UTC)

| City | currentPubDate | stnDateTime | liveTime | t1h (obs) | dongnae.t1h (API) | reh (obs/API) |
|---|---|---|---|---|---|---|
| Seoul 108 | 202609252000 | 2026.09.25.22:12 | 2212 | 18.6 | 18.8 | 88 / 87 |
| Busan 159 | 202609252000 | 2026.09.25.22:12 | 2212 | 23.2 | 22.4 | 70 / 75 |
| Jeju 184 | 202609252000 | 2026.09.25.22:12 | 2212 | 25.3 | 25.3 | 66 / 70 |

All three: `overwrite=true`, `cityMinAws` and `cityHourAws` present, `hourlyMissing` absent (hourly rows now exist). Public CDN `https://todayweather.wizardfactory.net/v000903/kma/coord/37.5665,126.9780`: first request `Miss from cloudfront`, second `Hit`, body carried the same `liveTime=2212`.

CDN caveat: the default behavior on `E3QLRH0LJD07QR` has MinTTL/DefaultTTL 300 s, MaxTTL 600 s (from [AWS read-only evidence](../architecture/aws-readonly-evidence-2026-09-20.json)). Effective freshness for clients is therefore observation age (≤ 2 min collection + up to 20 min eligibility window) plus up to 5–10 min of edge cache. This is acceptable for the stated goal but is the ceiling until the cache policy is revisited.

## Tests (all VM-isolated, no app/DB/network; run on Node 22 locally and Node 16.20.2 on the gather host against the deployed files)

- `server/test/offline/test.minute.scrape.js` — 6 (from the previous step)
- `server/test/offline/test.hourly.scrape.js` — 7: minute list default/override/invalid, once-per-minute-key, in-flight skip, `'skip'`/Error/sync-throw handling, `undefined` day argument, `app.js` gate matrix.
- `server/test/offline/test.city.parser.js` — 11: `_decodeKmaHtml` UTF-8 by header / by meta / EUC-KR / binary-string body; modern fixture parses 97 stations with numeric `wsd` from script, `백령도→백령`, no `unknown` property, no `NaN`; page older than requested `pubDate` → Error; legacy `table_develop3` layout; missing header/bad pubDate → Error never throw; hourly waterfall city-unavailable → AWS-only and city-available → merged; `_saveStnInfo` geocode sync-throw / async-error / ok / already-known.
  Fixture: `server/test/offline/fixtures/city-obs-2026-09-25.html` (captured page, 113 KB). Requires `cheerio` plus native `iconv` or `iconv-lite` (normal resolution; runs in `npm run test:offline`).
- `server/test/offline/test.minute.merge.js` — 8: `_isValidObservation` bounds; newer obs replaces valid `t1h/reh/vec/wsd`; older obs keeps API values and fills only sentinel; invalid obs never overwrites; sentinel API value replaced regardless; `rn1` fill-only; hourly-missing → continue with flag; hourly-present → merged, `rs15m` promotes `rns`.

## Known limitations / follow-ups

- 25 AWS stations added since 2021 have no `KmaStnInfo` row because the gather host has no geocoding credential; they are stored in `kmastnhourly2`/`kmastnminute2` but not selectable by proximity. Backfill once a geocode key is available.
- `openapi.airkorea.or.kr` pinned in `/etc/hosts` still times out (pre-existing, unrelated to this issue).
- Timestamp convention (KST wall-clock stored as UTC) unchanged across collectors and consumers.
- No PM2 boot-service stop/start rehearsal; dumps saved on both hosts.

## Rollback

- Gather: unset `KMA_STN_HOURLY_ENABLED` (and/or `KMA_STN_MINUTE_ENABLED`) then `pm2 restart www --update-env`; or restore `lib/kmaScraper.js`, `controllers/controllerManager.js`, `app.js` from the hourly/minute backup dirs.
- Service: restore `controllers/controllerTown.js` and `controllers/controllerKmaStnWeather.js` from `/home/ec2-user/tw-svc-backup-minute-20260925112057/`, `pm2 restart www`. The API then returns the plain current weather again (previous behavior).

## Post-deployment correction (PR #2574)

Review found that the city-unavailable fallback saved AWS rows without `isCityWeather`, and `_saveStnInfo` then cleared that flag on stored city stations. City-station lookup for the current-weather merge then found no station until a later run parsed the city page. PR #2574 keeps the stored flags when city data is unavailable. The deployed gather `kmaScraper.js` predates this fix and needs a redeploy. Read-only check: search gather logs for `city weather unavailable, saving AWS hourly only`, and count `kmastninfos` with `isCityWeather: true` (about 97 expected).
