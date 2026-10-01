# Visual Crossing overseas weather: deployment checklist (#2585)

Overseas weather (`/v00090x/dsf/coord`, the widgets' `/ww/...`) comes from Visual Crossing since [PR #2603](https://github.com/WizardFactory/TodayWeather/pull/2603). Design and behaviour: [weather collection](../architecture/weather-collection.md#overseas-visual-crossing-request-time-collection); owner decisions: [D52](../rewrite/decisions-and-open-questions.md). This checklist is for the human-owned deployment of the EC2 service host. It records environment variable names only, never values.

## Before deploying

1. **Plan and key.** Choose the Visual Crossing plan (Free: 1,000 records/day and one concurrent request; Metered: the same free 1,000/day, then per record, no concurrency limit). Keep the account key available for the host's environment.
2. **Host configuration.** The service host runs a hand-edited `server/config/config.js` ([EC2 internals](../architecture/ec2-internals.md)). Reconcile it with master so that it contains `vc: {dailyRecordLimit: ...}` and `keyString.vc_key` read from the environment; otherwise the key is not read and every overseas request fails or serves stored data.
3. **Environment** (`server/.env` or the PM2 environment):
   - `VC_SECRET_KEY`: required. With it unset, no provider call is made. dotenv strips surrounding quotes.
   - `VC_DAILY_RECORD_LIMIT`: optional daily record budget per UTC day (owner decision: `5000`). Unset or `0` means no budget.
4. **Runtime.** The host runs Node 10.15.3 and mongoose 5.1.2; the Visual Crossing path is checked on Node 10.15.3 in CI (`vc-node10`).

## After deploying

1. **Smoke:** `GET http://tw-svc-spot.wizardfactory.net/v000903/dsf/coord/35.68,139.76` returns 200 JSON with `"source":"VC"` (AC10). The public `/weather/v000903/coord` path also depends on the Lambda geocoder (#2601).
2. **Usage:** `db.vc.usage.find().sort({_id: -1}).limit(3)` shows per UTC day `calls`, `records`, `failures`, `http429` and `slow`. Cost per location: 49 records for a new location, 25 a day when the location is requested daily, 1 per 15-minute refresh.
3. **Logs** (the production console shows `error` only): lines starting `VC>` (failed calls), `cDsf > Visual Crossing marked unavailable` (rejected key or daily limit: calls stop for 10 minutes), `cDsf > serving stored overseas records` (fallback up to 6 hours old) and `cDsf > VC response without the local yesterday`.
4. **Retention:** `dsfforecasts` records older than four days are removed only by `maintainDB` in a gather or local process. Confirm such a process runs against the production database; service mode never prunes them.

## Kill switch and rollback

- **Kill switch:** unset `VC_SECRET_KEY` and restart. Requests then serve stored data up to 6 hours old, or fail.
- **Rollback:** redeploy the previous checkout. No data migration is involved; the old Dark Sky path fails again.

## Offline Mongo verification

The `vc-lock-mongo` CI job keeps real MongoDB coverage for single-flight fetching, usage counters, owner-token release, backoff and provider markers. The smoke harness observes the actual callbacks of controller background writes and drains them before database assertions, advancing the fixture clock, and disconnecting. It fails on logged write errors or a missing callback (10-second watchdog); it does not retry assertions or infer completion from a fixed sleep. Production request ordering is unchanged.

Run the dependency-free observer regressions with `node --test server/test/offline/mongo-operation-tracker.test.js`. With isolated mongoose 5.13.22, async 2.5.0 and mongodb-memory-server-core 10.1.4 dependencies, run:

```sh
NODE_PATH=<isolated-dependencies>/node_modules TZ=UTC node server/test/offline/vc-lock-mongo-smoke.js --hold-writes
```

The `--hold-writes` regression deliberately withholds the first usage write and lock release until the concurrent responses have finished. It verifies that the usage row is still absent and the lock still exists, then releases the writes and checks the persisted result after callback completion. This exercises the ordering that made the former 50ms wait unreliable without depending on machine speed. Omitting the flag exercises ordinary scheduling. The isolated mongod disables its wall-clock TTL sweeper because expiry fixtures use a captured date; the TTL index configuration and controller takeover behavior remain checked. An existing `TW_MONGO_URL` must point to an isolated instance started with `--setParameter ttlMonitorEnabled=false`; the smoke verifies this prerequisite without changing an existing server setting. Failed-lock polling is checked by its scheduled poll count, not an elapsed-time threshold. No live weather provider is called. The Mongo instance and database must be isolated: the smoke clears its dedicated database.
