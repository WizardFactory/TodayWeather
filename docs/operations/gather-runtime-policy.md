# Gather runtime policy (#2588)

The production gather host runs hand-edited copies of `controllerManager.js`, `lib/PastConditionGather.js` and `kaq.hourly.forecast.controller.js`. A redeploy from master would silently revert those values. Issue [#2588](https://github.com/WizardFactory/TodayWeather/issues/2588) moves them into environment variables read by [`server/config/gather.js`](../../server/config/gather.js). The host can then set them in its PM2 environment instead of patching source.

With no variable set, behaviour equals master before #2588.

## Variables

| Variable | Controls | Default (master) | Production (host) | Accepted |
| --- | --- | --- | --- | --- |
| `GATHER_TOWN_RETRY` | `_recursiveRequestData` passes for `TOWN_SHORT`, `TOWN_SHORTEST`, `TOWN_CURRENT` | `70` | `10` (temporary; `180` before 2026-09-26) | integer ≥ 1 |
| `GATHER_INVALID_CURRENT_RETRY` | passes for the invalid-T1H current update (`updateInvalidT1hData`) | `50` | `40` | integer ≥ 1 |
| `GATHER_MID_RETRY` | passes for `MID_FORECAST`, `MID_LAND`, `MID_TEMP` (both call sites), `MID_SEA` | `70` | `2` | integer ≥ 1 |
| `GATHER_RETRY_DELAY_MS` | `setTimeout` delay before each failed-list and invalid-list retry pass | `0` | `50` | integer ≥ 0 |
| `GATHER_PAST_ENABLED` | queue the `Past` task at UTC minute 2 / startup | `true` | `false` | `true` / `false` |
| `GATHER_AIR_FORECAST_ENABLED` | queue the KAQ hourly forecast block (UTC minute 7, existing hour gate) / startup | `true` | `false` | `true` / `false` |
| `GATHER_PAST_CONDITION_RETRY` | per-coordinate retry count `PastConditionGather.start` passes to `requestDataByUpdateList` | `10` | (unused; divisor set) | integer ≥ 1 |
| `GATHER_PAST_CONDITION_RETRY_DIVISOR` | when > 0, the retry count is `ceil(updateList.length / divisor)` instead | `0` (off) | `20` | integer ≥ 0 |
| `GATHER_KAQ_MIN_MODEL_IMAGES` | minimum `PM2_5.09KM` model images before KAQ forecasts are parsed | `4` | `2` | integer 1–4 |

Empty values count as unset. An invalid value throws when the module loads, so the process fails at startup with `Invalid <NAME>: ...` rather than silently running master defaults. Check the PM2 error log after changing these variables.

This applies to every `SERVER_MODE`, not only gather: `app.js` loads `controllerManager` in all modes, and service routes load the KAQ controller. An invalid `GATHER_*` value in a service process environment or its `server/.env` also stops the API server. Service processes ignore valid values, because only gather work reads them.

The per-task retry values are grouped (one town, one mid variable) because the host uses the same value within each group. The `AsosHistory` task stays gated by `ASOS_HISTORY_ENABLED` (`config.history.enabled`), unchanged.

The consumers require `config/gather.js` directly rather than a `config.gather` section, because the host runs its own private `config/config.js` (see [gather source reconciliation](../architecture/gather-source-reconciliation.md#complete-appendix-disposition)). Adding a section there would require patching that file as well.

## Semantics notes

- **`PastConditionGather` "batch size".** The host edit replaces the retry-count argument (`10`), not a batch size. Concurrency stays at `async.mapLimit(updateList, 20)` in `requestDataByUpdateList`.
- **Divisor rounding.** The host computes `updateList.length/20` without rounding. A fractional count (for example 2.25) decrements through 0.25 to −0.75 and never reaches zero, so a coordinate that keeps failing is retried without end. The divisor mode rounds up: integer quotients are identical to the host, and fractional quotients get one extra pass and then stop. A result of 0 becomes 1. This is the only intended difference from the host patch. It has no effect while `GATHER_PAST_ENABLED=false`, unless someone calls `/gather/past` by hand.
- **KAQ upper check.** More than four model images is still rejected ("Maybe found new modelimg"). Only the minimum changes, as on the host.
- **Delay count.** Every failed pass schedules one timer, including the last one that then stops on the zero count. This matches master.

## Production settings

These values come from the issue's host-versus-master inventory. The town retry reflects the 2026-09-26 quota hotfix in [#2604](https://github.com/WizardFactory/TodayWeather/issues/2604), which lowered the host literal from 180 to 10 as a temporary measure. This change did not re-inspect the gather host. Recheck the values against the host source before relying on them.

```sh
GATHER_TOWN_RETRY=10
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

1. Back up the three host files and the PM2 dump. Read the actual literals from the backed-up files and compare them with the Production column above. The column comes from the issue inventory and the #2604 note, not from a host inspection, so correct any mismatch before continuing.
2. Add the variables to the gather process environment (the PM2 `www` app on the gather host), for example via the ecosystem file or by exporting them before `pm2 restart www --update-env`. Then run `pm2 save` and confirm the dump contains them. Alternatively, put them in `server/.env`, which `config/env.js` loads at startup (#2566). A variable already set in the process environment takes precedence over the file.
3. Replace `server/config/gather.js`, `controllers/controllerManager.js`, `lib/PastConditionGather.js` and `controllers/kaq.hourly.forecast.controller.js` with the master copies. First read "Remaining drift" below: the master `controllerManager.js` also changes the schedule.
4. Verify in the log: no `Past` task at minute 2, no `getKaqHourlyForecast` at minute 7, the `start tasks counts` loop continues, `/health` returns 200.
5. Roll back by restoring the backed-up files and the previous PM2 environment or `server/.env`.

## Remaining drift not covered by #2588

The [gather source reconciliation](../architecture/gather-source-reconciliation.md#legacy-gather-policy-snapshot--documented-inactive) records further host-only edits. This change does not make them configurable, so replacing the host `controllerManager.js` with master still changes the following:

- The schedule minutes for `midtemp` (40), `midland` (48), `midforecast` (30), `midsea` (58), `shortrss` (1), `short` (24) and `shortest` (44/54/4/14).
- `current` at minute 34 only, with no `putAll` branch.
- `kecoSido` disabled.
- The startup `checkTimeAndRequestTask(true)` disabled.

The host `lib/collectTownForecast.js` also has smaller request-index cutoffs (`i > 20`, `i >= 50`), and other files carry log-level edits. These need a separate decision before the host can run master source unchanged.

The 2026-09-26 quota hotfix ([#2604](https://github.com/WizardFactory/TodayWeather/issues/2604)) is also host-only. It adds quota detection in `collectTownForecast.js` `_requestPage` and an early return in `_recursiveRequestData`. Replacing the host `controllerManager.js` or `collectTownForecast.js` with master before #2604 lands in master removes that protection and restores the per-grid retry storm on a quota day.
