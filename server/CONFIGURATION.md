# Server configuration

Install the server dependencies in the intended runtime environment. Copy
[.env.example](.env.example) to `server/.env` and fill the settings needed by the
selected mode. Keep the file private (for example, `chmod 600 server/.env` from
the repository root). Local `.env` and `.env.*` files are ignored by Git; only
sanitized `.env.example` files are tracked.

Start from the repository root with `npm --prefix server start` or
`node server/bin/www`, or run `npm start` from `server/`.
[app.js](app.js) loads [config/env.js](config/env.js) before New Relic and all
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

Setup adds `/.env` to `server/.gitignore`, preserving existing rules, so copied
credentials remain ignored even on branches without the root dotenv rules.
Symlinked destination `server` directories or `.gitignore` files are refused.
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
- `dotenv` is pinned to `10.0.0` (Node.js >=10), compatible with the Node 10.15.3
  service-host snapshot in the [architecture evidence](../docs/architecture/ec2-internals.md).
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

The reviewed `tw-gather.env` selects gather mode, DB version `2.0`, and port `3000`.
It is an operator-supplied private file, not a repository artifact. It does not
provide `DATA_GO_KR_NORMAL_KEY` or `DATA_GO_KR_CERT_KEY`. AK confirmed on
2026-09-24 that the current production server does not use these two settings;
they can remain unset for current operation. This is an operator-confirmed
deployment fact, not a new live-server inspection. The configuration fields are
retained for legacy source callers, and `TEST_*` settings do not automatically
substitute for them. Other optional settings depend on the features used; this
example is not a complete production configuration.

`TWA_S3_REGION` and `TWA_S3_WEATHER_DATA_BUCKET_NAME` in that file have no consumers
in the current server source. Loading them does not enable an S3 integration.

## Offline verification

With the isolated dependencies described in [test/offline/README.md](test/offline/README.md):

```sh
node server/test/offline/env-startup.test.js
npm --prefix server run test:offline
```

The environment regression runs real dotenv in temporary server layouts and
stops at the first New Relic import, before providers, databases, timers or HTTP
listeners initialize. Do not use a real gather startup as a configuration probe.
