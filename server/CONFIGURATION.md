# Server configuration

Install the server dependencies in the intended runtime environment. Copy
[.env.example](.env.example) to `server/.env` and fill the settings needed by the
selected mode. Keep the file private (for example, `chmod 600 server/.env` from
the repository root). Local `.env` and `.env.*` files are ignored by Git; only
sanitized `.env.example` files are tracked.

Start from the repository root with `npm --prefix server start` or
`node server/bin/www`, or run `npm start` from `server/`.
[app.js](app.js) loads [config/env.js](config/env.js) before Express and all
configuration consumers. The loader always reads `server/.env`, independent of
the working directory. Importing `app.js` directly uses the same bootstrap.
Importing `config/config.js` alone does not bootstrap the environment.

## Paseo workspaces

The repository's [paseo.json](../paseo.json) extends the existing AWS-file setup
to copy `$PASEO_SOURCE_CHECKOUT_PATH/server/.env` into `server/.env` when a new
worktree workspace is initialized. Paseo supplies the original checkout path;
the setup runs in the new workspace. New copies have permissions `0600`.
Existing workspace files or symlinks are preserved, and missing source files
are reported by filename and skipped. No environment values are printed.

Setup leaves tracked files and ignore files in the work tree unchanged. If Git
already ignores `server/.env`, for example through the root `.env` rule, nothing
is written. Otherwise setup appends `/server/.env` to the repository's local
exclude file (`git rev-parse --git-path info/exclude`, shared by linked
worktrees), so copied credentials remain ignored even on branches without the
root dotenv rules. If Git still does not ignore the file, for example because of
a `!.env` negation, setup stops without copying it. Symlinked destination
`server` directories or exclude files are refused.
The source checkout must provision and ignore its own private `server/.env`.
The source file is copied once; subsequent changes are not synchronized.

Paseo seeds the source `paseo.json` only if the new worktree has no configuration
of its own. A target branch with an older/custom `paseo.json` uses that file;
include this setup change in such branches to enable environment copying there.
This setup applies to new worktree workspaces, not existing/local workspaces,
and does not install dependencies or start the weather server.

## Precedence and syntax

- Existing process environment variables win over file values, including empty
  strings. Existing `config.js` fallback behavior for empty strings is unchanged.
- An absent `.env` is allowed for deployments that provide all settings through
  the process environment. Other read failures stop startup with a generic error
  and an error code; file contents and raw error details are not printed.
- `dotenv` is pinned to `10.0.0` (Node.js >=10), compatible with the Node 16.20.2
  target pinned in [.nvmrc](.nvmrc). Use npm 8 with the committed lockfile.
  This does not certify the complete legacy dependency tree on every Node version.
- Use one `KEY=value` assignment per line. Balanced single/double quotes are
  removed; JSON arrays remain strings, e.g. `DONGNAE_SECRET_KEYS='["key1","key2"]'`.
  Double-quoted `\n` becomes a newline. This version ignores non-assignment lines
  and does not reject malformed syntax or unmatched quotes. Put comments on
  separate lines; inline comments, `export` prefixes and shell variable expansion
  are not supported. No custom parser or strict schema validator is added.
- `OPENSHIFT_NODEJS_PORT` overrides `PORT`. Avoid conflicting values.

## Gather configuration notes

`SERVER_MODE=gather` automatically starts collection and database maintenance.
The example selects `service` to avoid automatically starting background workers;
startup still connects to the configured database and initializes application
dependencies. See the [runtime modes](../docs/architecture/service-overview.md#runtime-modes).

`DONGNAE_SECRET_KEYS` is the sole key source for forecast/mid, warnings, UV/pollen,
KASI and forecast-zone clients. Supply a JSON array in intended rotation order.
Unset, malformed, non-array and placeholder-only lists supply no keys; affected
requests fail before HTTP. Auth/quota failures (HTTP 401/403/429, provider codes
20/22/30/31/32) try each list key once per logical request or forecast cycle.
Other failures do not rotate credentials. Repeated UV setup replaces its list.
Legacy data.go.kr environment settings are ignored and produce a startup warning
listing names only. Remove them from process-manager environments and `.env`.

Required subscriptions for at least one key per used service:

| Client | data.go.kr service approval |
| --- | --- |
| Grid forecast/current/shortest | `VilageFcstInfoService_2.0` |
| Mid forecast/land/temp/sea | `MidFcstInfoService` |
| Warnings | `WthrWrnInfoService` |
| UV | `LivingWthrIdxServiceV5` |
| Seasonal oak/pine/weed pollen | `HealthWthrIdxServiceV3` |
| KASI rise/set | `RiseSetInfoService` (`B090041`) |
| Legacy forecast-zone startup refresh | `ForecastZoneInfoService` (legacy endpoint; availability unverified) |
| AirKorea, when the same account is used | `ArpltnInforInqireSvc` and other enabled AirKorea operations |

AirKorea retains `AIRKOREA_SECRET_KEYS`; opt-in historical ASOS recovery retains
its explicit `ASOS_HISTORY_SERVICE_KEY` subscription/rollout contract. Health-day
and retired life-index endpoints removed by #2650 remain removed. Key approval
does not establish that the legacy forecast-zone endpoint still works.
See the [migration and verification runbook](../docs/operations/data-go-kr-keys.md).

## Push store

`PUSH_STORE=sqlite` with `PUSH_DB_PATH` keeps push registrations in a SQLite file
on this host instead of MongoDB (#2626). Every service worker and the single
[push worker](bin/push-worker) must see the same settings. Unset `PUSH_STORE` to
return to MongoDB. See the [push store runbook](../docs/operations/push-sqlite.md).

## Offline verification

With the isolated dependencies described in [test/offline/README.md](test/offline/README.md):

```sh
node server/test/offline/env-startup.test.js
npm --prefix server run test:offline
```

The environment regression runs real dotenv in temporary server layouts and
stops at the first Express import, before providers, databases, timers or HTTP
listeners initialize. Do not use a real gather startup as a configuration probe.

### S3 push registrations and delivery (#2626)

`PUSH_STORE=s3` forwards existing push routes to `PUSH_SOCKET_PATH` (an absolute,
mode-0600 Unix socket). One `node bin/push-coordinator` owns registration writes,
in-memory time/region indexes and delivery. `PUSH_S3_BUCKET` is required;
`PUSH_S3_PREFIX` defaults to `push/v2`; `AWS_REGION` and the AWS default credential
chain select the storage account. API workers do not need S3 credentials.

`PUSH_SEND_CONCURRENCY=128` bounds concurrent preparations/submissions and
`PUSH_SEND_RATE=500` limits each Firebase project's attempted submissions per second
with a 100ms token bucket. Urgent work has reserved capacity. `WARNING_PUSH_ENABLED`
and the gather-side `PUSH_WARNING_FEED_ENABLED` default to false. The latter also
requires the existing KMA warning collector to be enabled. `SERVER_MODE=push` is
rejected in S3 mode; do not run the legacy/SQLite sender alongside the coordinator.
See [S3 operations](../docs/operations/push-s3.md) before activation.


`GATHER_FORECAST_DEADLINE_MS` defaults to 540000 ms (positive integer, maximum 2147483647).
It bounds each short/ultra-short publication run independently from
`GATHER_CURRENT_DEADLINE_MS`, cancels HTTP/retry admission and fences new forecast
writes after expiry. Polling and formats are unchanged. Issued Mongo operations
may settle later but are publication-fenced and cannot replace a newer publication.
`GATHER_FORECAST_READ_TIMEOUT_MS` (default 3000, minimum 1001) bounds the coordinate
read and each forecast coverage read wait; Mongo coverage `maxTimeMS` is one second
shorter (the coordinate read has no `maxTimeMS`). A failed read leaves
the run incomplete and, before collection, sends no forecast HTTP.
`GATHER_SHORTEST_REFRESH_AFTER_MS` (default 2400000, `0` disables) starts a one-hour
window after an ultra-short publication's base time in which each process refreshes
every grid once, because KMA updates ultra-short values every ten minutes. The
window must contain a scheduled shortest poll: an HH30 publication is polled about
18/24/34/44 minutes after its base time, so the default 40 minutes uses the +44 poll;
any value above 2640000 leaves no scheduled poll in the window (later polls request
the next publication), effectively disabling refresh. Only a successful full walk
consumes the refresh; a failed or expired refresh stays due for later calls inside
the window. A refresh that joins an already active run of the publication does not
walk separately; stored same-publication data remains.
See [forecast coverage and rollout](../docs/operations/current-grid-collection.md#forecast-completion-2676).
