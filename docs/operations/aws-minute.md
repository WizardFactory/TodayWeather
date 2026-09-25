# AWS minute collection and current-weather enrichment

Issue [#2573](https://github.com/WizardFactory/TodayWeather/issues/2573). Implementation and offline verification do **not** establish production recovery. Keep the issue open until approved operational checks pass. No command in this runbook has been run on production by the implementation task.

## Configuration and ownership

| Setting | Default | Effect |
| --- | --- | --- |
| `AWS_MINUTE_COLLECT_ENABLED` | off | Only the exact string `true` lets the new headless worker connect/write. It does not alter `SERVER_MODE` or normal gather. |
| `AWS_MINUTE_ENRICH_ENABLED` | off | Exact `true` initializes `config.awsMinute.enrichEnabled` for KMA service startup. Changes require a targeted service restart/reload. |
| `AWS_MINUTE_MONGODB_URI` | absent | Explicit writer/verification connection URI, including database; supply out of band. Must select the same database the service already uses. |
| `--dry-run` | absent | Explicit read-only HTTP/parse probe; allowed even with collection off. No DB module/connection, owner, index, cleanup or S3 operation. |
| `--once` | absent | One poll, clean stop; exit nonzero for a failed poll. Without it, schedule the next poll 120 seconds **after** completion. |

CLI switches only select dry-run/once; no URL, IP, clock, timeout or TTL overrides are exposed. Collector activation reads the environment directly, so host `config.js` overrides cannot implicitly enable it. Enrichment reads the loaded repository config (environment-derived in this revision); a deployed config override must explicitly preserve that binding. Inventory effective config before activating; do not copy this checkout over host overrides. Existing service DB configuration remains authoritative. PM2 environment is snapshotted: `--update-env`/process recreation and saved ecosystem settings matter; changing a shell export alone does not change running workers.

Use one `todayweather-aws-minute` fork worker via [PM2 configuration](../../server/config/pm2.aws-minute.config.js). A unique `minute-writer` owner document prevents multiple processes/hosts sharing this database from writing. The token is deliberately **non-expiring**: a paused process cannot lose its lock to another writer and resume concurrently. Clean shutdown releases it. An abrupt kill leaves the owner in place and subsequent workers fail before fetching. This favors safety over automatic takeover. It does not coordinate writers pointing at different databases; confirm a single target and inventory external/legacy writers.

SIGINT/SIGTERM cancels queued polling and in-flight HTTP; no subsequent writes are admitted. An active DB operation drains under the configured socket/operation timeout, then releases ownership and disconnects. PM2 kill timeout is 15 seconds. Do not use cluster mode or start another unchanged `bin/www`.

## Data and service contract

`aws_minute_observations` is separate from `kmastnminute2`/`kmastnhourly2`. `_id` is `stationId:ISO-UTC-observation-time`. The existing unique `_id` index provides idempotency without an index migration. `$setOnInsert` keeps an accepted station/time immutable. A later poll with an older publication cannot replace the newest read. Native reads use a station-prefixed `_id` interval, descending order, projection, limit 1 and `maxTimeMS:1500`. Review the actual explain plan before production approval; do not create the legacy duplicate indexes.

The legacy source publication `2026.09.25.14:09` KST is explicitly `2026-09-25T05:09:00.000Z`. Every record retains station ID/name, source `KMA_AWS_MINUTE`, `timeBasis:UTC`, the KST publication string and per-field values. No legacy timestamp migration, shared query mixing wall-clock dates with UTC, or DB_DATA_VERSION change occurs. Parser time/field behavior is tested in UTC and Asia/Seoul.

Admit observations only when `0 <= now - observedAt < 20 minutes`; exact age 20 minutes, future, malformed and empty publications fail. HTTP deadline is 10 seconds per attempt, with at most two transport/timeout attempts, no HTTP redirect following, and a 2 MiB response limit. Decoding accepts EUC-KR or explicit UTF-8 with fatal errors. At most 1000 rows are accepted for processing; duplicate station IDs reject the snapshot. A bad station row is rejected independently. Numeric syntax is strict: temperature `(-50,60]`, humidity `[0,100]`, wind direction `[0,360]`, wind speed `[0,100]`, all finite; invalid fields are omitted, all valid zeros retained. Poll work has a 60-second admission budget, sequential writes, and each DB operation has a five-second server limit/six-second socket limit; a final admitted operation can finish beyond the admission deadline.

Rain retains raw provider field names `rs15m/rs1h/rs3h/rs6h/rs12h/rs1d` and `rns` only when present/valid. These are precipitation depth readings in the source's labelled accumulation periods, not interchangeable instantaneous rain rates; the day bucket's precise boundary is not reinterpreted. Missing rain stays absent. The new overlay does not change `rn1`, cloud, sky, lightning, precipitation type or weather text.

Station mapping deliberately preserves the existing city-station restriction: `isCityWeather:true`, longitude/latitude legacy `2d` proximity within **one planar degree**, excluding `isMountain:true` and invalid/missing station identity/coordinates. One degree is **not one kilometre**. It is the existing city mapping ceiling, not a newly validated meteorological equivalence guarantee. Check actual selected stations/proximity during rollout; local rain stations do not supply these four current fields.

The additional overlay runs after history/forecast composition and before current indices, icons, units and summary. Normal legacy composition remains available and its failures fall through; the new collection is never fed into legacy minute/history helpers. Each of `t1h`, `reh`, `vec`, `wsd` is replaced only if the minute value is valid and strictly newer than its proven original observation time. A valid field with unknown or changed provenance remains intact; an invalid/missing field can be filled. This conservative rule can leave forecast-synthesized values unchanged. Ordinary fallback and arrays survive a disabled, unsuitable, stale, missing or failed new read.

`minuteObservation.fields` lists only replaced fields, each with source/station/UTC time. Station mapping and KST `observationDate` are additive provenance. `liveTime` and additive `liveDate` advance only when **temperature** changes source; a humidity-only replacement never relabels an older temperature. Legacy `date`/`time` keep their original hour/day comparison conventions; consumers of the minute display time must pair it with `liveDate`/`observationDate`, especially at midnight. Server day/night icon lookup uses `liveDate` when present. No historical/forecast array gets a minute snapshot. Existing Celsius/Fahrenheit conversion and summary rules remain (including the API's Fahrenheit flooring).

## Retention

There is **no automatic deletion or TTL index**. First verification must leave cleanup disabled. The operational retention target is 48 hours for this new collection; an approved separate maintenance schedule must enforce it after initial verification. Until then, bound the verification duration and monitor growth (up to roughly 720 polls/station/day at the configured cadence, generally less). Do not run indefinitely without an approved retention owner. No legacy collection may be deleted to satisfy tests/rollout.

After separate cleanup approval, a native shell may remove only records whose explicit UTC `observedAt` is older than 48 hours. Inspect counts/query plan before scheduling; an `observedAt` index is a separate reviewed change. Example, **not an activation step**:

```javascript
// mongosh against the explicitly approved database, credentials supplied out of band.
const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
db.aws_minute_observations.countDocuments({timeBasis: 'UTC', observedAt: {$lt: cutoff}});
// Execute only after the count/query plan and cleanup operation are approved:
db.aws_minute_observations.deleteMany({timeBasis: 'UTC', observedAt: {$lt: cutoff}});
```

## Local verification

With normal server dependencies installed, these commands need no Internet, credentials, SSH or database:

```sh
cd server
TZ=UTC npm run test:aws-minute
TZ=Asia/Seoul npm run test:aws-minute
npm run test:offline
```

The synthetic HTML is labelled under `test/offline/fixtures/aws-minute/`. Tests inject HTTP/store/timers; none imports app.js. The existing RSS tests now use an injected publication-window clock rather than failing as calendar time advances.

The separate integration command requires a preinstalled `mongod` and test-only `mongodb-memory-server-core@10.1.4` / `mongodb@6.21.0` accessible via Node resolution. Provision those outside CI's offline test phase. It refuses to download a binary and **never accepts a DB URI**: it starts/owns a localhost temporary Mongo, creates test station/index data there, then shuts it down. Run on Node 22 for this test toolchain:

```sh
# These variables select local test tooling, never production resources.
export NODE_PATH=/path/to/isolated-test-dependencies/node_modules:/path/to/server-dependencies/node_modules
export MONGOMS_SYSTEM_BINARY=/path/to/installed/test/mongod
export MONGOMS_VERSION=7.0.14
npm run test:aws-minute:integration
```

This checks concurrent duplicate upserts, immutable replays, out-of-order reads, owner exclusion, built-in `_id` query plan, plus real localhost HTTP → parser/collector → Mongo → current overlay. Test-only native driver 6 with Mongo 7 does **not** certify the production Mongoose 5.1.2/driver 3.0.8 connection stack. That stack uses legacy wire opcodes rejected by Mongo 7; no runtime upgrade is included. Verify deployed Mongo compatibility during operator inventory. Runtime-independent focused checks also run under repository Node 16.20.2.

## Approved activation procedure

All steps below require operational approval. Use current host inventory, not historical addresses. Keep credentials/URIs out of comments, reports and shell tracing.

1. Record collector/service hosts, exact deployed revision and local overrides, effective flags/DB target, Mongo compatibility, existing PM2 process/restart counts, normal gather publication and representative response. Confirm no other minute writer. Reconcile only scoped candidate changes with host overrides.
2. Remove **only** the stale `www.weather.go.kr` hosts entry through the approved provisioning/configuration path. Do not replace it with another IP or use a request lookup override. Record `/etc/hosts` provenance, AMI/user-data/config management source and replacement-instance persistence. Verify normal OS and Node application DNS lookup; an existing process may hold the legacy 300-second dnscache entry. Allow expiry or approve a targeted affected-process restart, then verify an unmodified request. Do not restart normal gather solely to satisfy a probe.
3. With enrichment off, run at least three advancing source snapshots. Each `--once` is read-only; wait for advancing provider publications between invocations. Check publication, accepted/rejected totals, failure reason and stations 108/159/184; do not require a fixed 745 count or invent missing station fields.

```sh
cd /approved/candidate/server
node bin/collect-aws-minute.js --dry-run --once
# Repeat twice after source time advances. No DB URI or collection flag needed.
```

The poll log reports overall publication/counts; to inspect representative source values in dry-run use the `samples` log field. Last successful write stays null in dry-run.

4. Set `AWS_MINUTE_MONGODB_URI` securely to the approved database. Keep service enrichment off. Start only the new process and read back samples with the native read-only verifier:

```sh
AWS_MINUTE_COLLECT_ENABLED=true pm2 start config/pm2.aws-minute.config.js --only todayweather-aws-minute
node bin/verify-aws-minute.js
pm2 logs todayweather-aws-minute --lines 30 --nostream
```

Require advancing source/storage times, idempotency and no cleanup/S3/index activity. Do not run the isolated integration command against this DB. The verifier only reads fresh 108/159/184 records with projection/limits/timeouts; null means a gap, not zero weather.

5. Enable `AWS_MINUTE_ENRICH_ENABLED=true` on the **identified existing service application** through its reconciled config; targeted command: `AWS_MINUTE_ENRICH_ENABLED=true pm2 reload "$SERVICE_APP" --update-env`. Set `SERVICE_APP` from inventory, never an assumed name or `all`. Compare provider/store/selected station/API values and source times on `/v000903/kma/coord/37.5665,126.9780` and the actual public `/weather/v000903/coord/37.5665,126.9780`. Use normal requests and record `Date`, `Age`, `Cache-Control`, observed lag and the next response after natural cache expiry; cache-busting alone is insufficient.
6. Observe at least three collection cycles **and one advancing normal current-gather publication**. Require no crashes/restart loop, duplicate writer or fallback regression. Validate saved process/config restoration once in a safe candidate. Save only the approved process/config inventory through the existing host PM2/provisioning workflow; a blanket `pm2 save` can capture unrelated current process changes. Verify boot scripts restore worker flags, secure URI binding and targeted DNS repair without a production reboot.

## Cache budget and closure evidence

Polling is two minutes plus work/provider lag, not minute-by-minute delivery. Origin enriched responses use `max-age=min(120, remaining 20-minute eligibility seconds)`. The recorded 2026-09-20 public weather Lambda success header is **300 seconds** and may override origin headers; public CloudFront weather defaults are not proof of an hourly response cache. Legacy direct KMA behavior had 300-second min/default and 600-second max. Recheck actual routing/cache policy before activation; adjust only a proven obstructing route within separate operational approval. No global flush is required. The app also gates ordinary refresh for ten minutes independently of HTTP caching. The current task does not change that UI cadence or promise a hard two-minute screen refresh.

Attach tested revision, focused/offline/integration results, actual flags/policies, three advancing dry-run/store samples, origin/public API/station correlation, cache-expiry observation, normal gather stability, startup persistence and rollback result. Live gaps must remain explicit. Do not use a closing PR keyword or auto-close on merge alone.

## Rollback and crash-owner recovery

Rollback only the new enrichment/worker:

```sh
AWS_MINUTE_ENRICH_ENABLED=false pm2 reload "$SERVICE_APP" --update-env
pm2 stop todayweather-aws-minute
node bin/verify-aws-minute.js
```

Restore disabled flags/worker state in the same reconciled ecosystem/provisioning records used for activation; verify they survive the safe candidate restoration check. Confirm ordinary origin/public fallback and normal gather still work. If needed restore only this feature's prior code with host overrides preserved. Do not restore the stale hosts pin, stop normal gather, delete observations or run a global cache flush.

If an abrupt worker exit left `AWS_MINUTE_WRITER_BUSY`, stop **every** minute worker across the inventoried hosts, confirm no PID/PM2/boot job can still write, and preserve diagnostic owner metadata. In the approved native DB shell inspect the owner and remove **only that exact observed token**:

```javascript
const owner = db.aws_minute_owners.findOne({_id: 'minute-writer'});
// Only after proving every old worker is stopped and obtaining recovery approval:
if (owner) db.aws_minute_owners.deleteOne({_id: owner._id, token: owner.token});
```

Then start one worker with the approved configuration. Never delete/expire an owner merely because its timestamp is old. The owner token is internal coordination metadata, not a provider credential; omit it from public comments anyway.
