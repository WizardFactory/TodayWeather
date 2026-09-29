# Gather runtime policy (#2588)

The production gather host runs hand-edited copies of `controllerManager.js`, `lib/PastConditionGather.js` and `kaq.hourly.forecast.controller.js`. A redeploy from master would silently revert those values. Issue [#2588](https://github.com/WizardFactory/TodayWeather/issues/2588) moves them into environment variables read by [`server/config/gather.js`](../../server/config/gather.js). The host can then set them in its process environment instead of patching source.

With no variable set, behaviour equals master before #2588.

## Variables

| Variable | Controls | Default (master) | Production (host) | Accepted |
| --- | --- | --- | --- | --- |
| `GATHER_TOWN_RETRY` | `_recursiveRequestData` passes for `TOWN_SHORT`, `TOWN_SHORTEST`, `TOWN_CURRENT`; since #2604 the first pass requests the whole list and each later pass retries at most `GATHER_REQUEST_CONCURRENCY` failed grids | `70` | `180` (`10` on 2026-09-26, restored 2026-09-27; see [#2604](#quota-and-key-rotation-2604)) | integer ≥ 1 |
| `GATHER_INVALID_CURRENT_RETRY` | passes for the invalid-T1H current update (`updateInvalidT1hData`) | `50` | `40` | integer ≥ 1 |
| `GATHER_MID_RETRY` | passes for `MID_FORECAST`, `MID_LAND`, `MID_TEMP` (both call sites), `MID_SEA` | `70` | `2` | integer ≥ 1 |
| `GATHER_REQUEST_CONCURRENCY` | requests in flight while one `_recursiveRequestData` pass walks its list (town and mid products, #2604) | `101` (the former per-pass cutoff) | not set; recheck the host collector first | integer 1–1000 |
| `GATHER_RETRY_DELAY_MS` | `setTimeout` delay before each failed-list and invalid-list retry pass | `0` | `50` | integer 0–2147483647 (`setTimeout` limit) |
| `GATHER_PAST_ENABLED` | queue the `Past` task at UTC minute 2 / startup | `true` | `false` | `true` / `false` |
| `GATHER_AIR_FORECAST_ENABLED` | queue the KAQ hourly forecast block (UTC minute 7, existing hour gate) / startup | `true` | `false` | `true` / `false` |
| `GATHER_PAST_CONDITION_RETRY` | per-coordinate retry count `PastConditionGather.start` passes to `requestDataByUpdateList` | `10` | (unused; divisor set) | integer ≥ 1 |
| `GATHER_PAST_CONDITION_RETRY_DIVISOR` | when > 0, the retry count is `ceil(updateList.length / divisor)` instead | `0` (off) | `20` | integer ≥ 0 |
| `GATHER_KAQ_MIN_MODEL_IMAGES` | minimum `PM2_5.09KM` model images before KAQ forecasts are parsed | `4` | `2` | integer 1–4 |

Empty values count as unset. Integer values are limited to 9007199254740991 (`Number.MAX_SAFE_INTEGER`): a retry count above that cannot be decremented exactly, so the retry loop would never end. An invalid value throws when the module loads, so the process fails at startup with `Invalid <NAME>: ...` rather than silently running master defaults. Check the PM2 error log after changing these variables.

This applies to every `SERVER_MODE`, not only gather: `app.js` loads `controllerManager` in all modes, and service routes load the KAQ controller. An invalid `GATHER_*` value in a service process environment or its `server/.env` also stops the API server. Service processes ignore valid values, because only gather work reads them.

The per-task retry values are grouped (one town, one mid variable) because the host uses the same value within each group. The `AsosHistory` task stays gated by `ASOS_HISTORY_ENABLED` (`config.history.enabled`), unchanged.

The consumers require `config/gather.js` directly rather than a `config.gather` section, because the host runs its own private `config/config.js` (see [gather source reconciliation](../architecture/gather-source-reconciliation.md#complete-appendix-disposition)). Adding a section there would require patching that file as well.

## Semantics notes

- **`PastConditionGather` "batch size".** The host edit replaces the retry-count argument (`10`), not a batch size. Concurrency stays at `async.mapLimit(updateList, 20)` in `requestDataByUpdateList`.
- **Divisor rounding.** The host computes `updateList.length/20` without rounding. A fractional count (for example 2.25) decrements through 0.25 to −0.75 and never reaches zero, so a coordinate that keeps failing is retried without end. The divisor mode rounds up: integer quotients are identical to the host, and fractional quotients get one extra pass and then stop. A result of 0 becomes 1. This is the only intended difference from the host patch. It has no effect while `GATHER_PAST_ENABLED=false`, unless someone calls `/gather/past` by hand.
- **KAQ upper check.** More than four model images is still rejected ("Maybe found new modelimg"). Only the minimum changes, as on the host.
- **Delay count.** Every failed pass schedules one timer, including the last one that then stops on the zero count. This matches master.

## Quota and key rotation (#2604)

Before #2604, `collectTownForecast.requestData` failed every index above 100 without a request (TW-461), so the uncollected grids rode the retry path: the retry count also set the coverage (2,032 grids need at least 21 passes; retry 10 collected about 1,010 grids on 2026-09-26). Now the first pass walks the whole list with at most `GATHER_REQUEST_CONCURRENCY` requests in flight, and each retry pass requests at most `GATHER_REQUEST_CONCURRENCY` of the failed grids (the rest wait for the next pass). One cycle therefore sends at most `grids + (retry − 1) × concurrency` requests per key, plus at most one walk of the still pending grids for each key change: with every grid failing (for example `resultCode 03` before publication) that is 9,001 requests at retry 70 and 20,111 at retry 180, against 7,070 and 18,180 before. Master's load per moment is unchanged (101 in flight). The host collector was recorded with a smaller cutoff (`i > 20`, see [Remaining drift](#remaining-drift-not-covered-by-2588)); if that is still the case, set `GATHER_REQUEST_CONCURRENCY=21` to keep its request rate.

A data.go.kr quota rejection (HTTP 429 or code `22`, with any HTTP status) or key rejection (HTTP 401/403 or codes `20`/`30`/`31`/`32`) stops the pass: no new request is sent, the requests in flight settle, and the Manager moves to the next `DONGNAE_SECRET_KEYS` entry for the grids not yet collected. When every key has been rejected in the cycle, the cycle ends with an error and no retry pass. The key in use is kept per service (`VilageFcstInfoService` for town products, `MidFcstInfoService` for mid products) until it is rejected; it replaces the random draw per pass (TW-396). Whether data.go.kr counts quota per key or per operation has not been measured. Other 4xx responses are not retried; 5xx, transport errors, `resultCode 03` and invalid bodies are retried as before. Each stop logs one warning (`stopped: reason=... pending=... keyIndex=... keysTried=...`); quota/key failures of single requests are logged at `debug`. The key index lives in process memory: after a restart each service starts again with the first key, so a key that is still exhausted costs one in-flight window (`GATHER_REQUEST_CONCURRENCY` requests) for each cycle already running on it, before the rotation (the startup pass starts several town cycles at once).

Before deploying #2604, read the `requestData` cutoff in the host's `lib/collectTownForecast.js` (for example `grep -n 'parseInt(i) >' lib/collectTownForecast.js`), record it in the deployment notes, and set `GATHER_REQUEST_CONCURRENCY` to the cutoff + 1 (21 for `i > 20`; leave it unset for `i > 100`).

## Production settings

These values come from the issue's host-versus-master inventory. The town retry is the host literal 180: the 2026-09-26 quota hotfix in [#2604](https://github.com/WizardFactory/TodayWeather/issues/2604) lowered it to 10, which dropped grids under the old per-pass cutoff, and it was restored on 2026-09-27 (issue comment). With the #2604 walk a smaller value no longer drops grids that succeed on the first pass; it still limits how many failed grids are retried (at most 101 per pass). This change did not re-inspect the gather host. Recheck the values against the host source before relying on them.

```sh
GATHER_TOWN_RETRY=180
GATHER_INVALID_CURRENT_RETRY=40
GATHER_MID_RETRY=2
GATHER_RETRY_DELAY_MS=50
GATHER_PAST_ENABLED=false
GATHER_AIR_FORECAST_ENABLED=false
GATHER_PAST_CONDITION_RETRY_DIVISOR=20
GATHER_KAQ_MIN_MODEL_IMAGES=2
```

The host source comment says the air-forecast block runs "from another instance tw-gather-airforecast". That topology is unverified. Set `GATHER_KAQ_MIN_MODEL_IMAGES=2` on whichever process actually runs the KAQ block, and do not set `GATHER_AIR_FORECAST_ENABLED=false` there.

### Operator procedure (not executed by this change)

1. Record the host `requestData` cutoff for `GATHER_REQUEST_CONCURRENCY` ([#2604](#quota-and-key-rotation-2604)). Back up the three host files and the PM2 dump. Read the actual literals from the backed-up files and compare them with the Production column above. The column comes from the issue inventory and the #2604 note, not from a host inspection, so correct any mismatch before continuing.
2. Add the variables to the gather process environment (the PM2 `www` app on the gather host), for example via the ecosystem file or by exporting them before `pm2 restart www --update-env`. Then run `pm2 save` and confirm the dump contains them. `server/.env` is an alternative only when the host runs master `app.js` and `config/env.js` (#2566) with `dotenv` installed. The inspected host revision `c9220de3` has neither, so use the PM2 environment there. When both are set, the process environment takes precedence over the file.
3. Replace `server/config/gather.js`, `controllers/controllerManager.js`, `lib/PastConditionGather.js` and `controllers/kaq.hourly.forecast.controller.js` with the master copies. First read "Remaining drift" below: the master `controllerManager.js` also changes the schedule.

   Copying single master files onto the host checkout (`c9220de3` plus local overrides) is not proven compatible. For example, master `controllerManager.js` requires `lib/history/service.js`, which that revision lacks. It is loaded lazily, only with `ASOS_HISTORY_ENABLED=true`, and the file also expects current versions of its collaborators. Prefer deploying a full master revision. If you copy single files, first confirm that every `require` resolves and run `node --check` on the host.
4. Verify in the log: no `Past` task at minute 2, no `getKaqHourlyForecast` at minute 7, the `start tasks counts` loop continues, `/health` returns 200.
5. Roll back by restoring the backed-up files and the previous PM2 environment or `server/.env`.

## Remaining drift not covered by #2588

The [gather source reconciliation](../architecture/gather-source-reconciliation.md#legacy-gather-policy-snapshot--documented-inactive) records further host-only edits. This change does not make them configurable, so replacing the host `controllerManager.js` with master still changes the following:

- The schedule minutes for `midtemp` (40), `midland` (48), `midforecast` (30), `midsea` (58), `shortrss` (1), `short` (24) and `shortest` (44/54/4/14).
- `current` at minute 34 only, with no `putAll` branch.
- `kecoSido` disabled.
- The startup `checkTimeAndRequestTask(true)` disabled.

The host `lib/collectTownForecast.js` also has smaller request-index cutoffs (`i > 20`, `i >= 50`), and other files carry log-level edits. These need a separate decision before the host can run master source unchanged.

The 2026-09-26 quota hotfix ([#2604](https://github.com/WizardFactory/TodayWeather/issues/2604)) is host-only. Master now contains the repair described in [Quota and key rotation](#quota-and-key-rotation-2604). Deploy `collectTownForecast.js`, `dataGoKrRejection.js`, `kmaWarningRequester.js`, `controllerManager.js` and `config/gather.js` together; replacing only one of the host files with master either loses the quota stop or fails on the missing module.
