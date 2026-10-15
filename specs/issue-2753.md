# S10e specification: legacy settings and server2/.env

Source: [intent](../intent/issue-2753.md), issue #2753. Base dbf3a4bc.

## Requirements

R1. Loading. `server2` and the seed importers read `.env` from the working directory with the
dotenv 10.0.0 rules (`^\s*([\w.-]+)\s*=\s*(.*)?\s*$` per `\r\n|\n|\r` line; matching quotes removed,
`\n` expanded in double quotes, other values trimmed; last duplicate wins). A variable present in
the process environment wins, even when empty. A missing file is allowed; another read error stops
startup with the error kind only. No legacy file is read. The test-only `loopback_server` example
reads the process environment only.

R2. Listener (legacy `config.js`). Address `OPENSHIFT_NODEJS_IP` (default `127.0.0.1`); port
`OPENSHIFT_NODEJS_PORT`, else `PORT`, else `3000`; empty values are unset. Metrics listen on the
loopback address of the same family at the public port + 1 (port 0: ephemeral). Invalid values stop
startup before binding. Worker/blocking threads, CPU, in-flight, cache bytes, connection limit and
lifetime are built in (2, 4, 2, 40, 16 MiB, 128, 9 s; 12 s with the gateway).

R3. S3. `AWS_ACCESS_KEY`, `AWS_SECRET_KEY`, `TWA_S3_REGION` (default `ap-northeast-2`) and the
server2-only `SERVER2_S3_BUCKET`; endpoint `https://s3.<region>.amazonaws.com/`. Required when a
family is native; the importers use the same settings.

R4. Keys. `DONGNAE_SECRET_KEYS` (required with `kma`), `AIRKOREA_SECRET_KEYS`, `GEOCODER_KAKAO_KEYS`,
`GEOCODER_GOOGLE_KEY`, `VC_SECRET_KEY` (required with `dsf`), `GOOGLE_SECRET_KEY`, `OWM_SECRET_KEY`,
`WAQI_SECRET_KEY`, with their legacy parse and validity rules.

R5. Quotas. Legacy settings where they exist: `VC_DAILY_RECORD_LIMIT` (positive; otherwise the
1,000-record free plan), `AIR_GOOGLE_MONTHLY_CAP` / `AIR_OWM_MONTHLY_CAP` (defaults 10,000 /
1,000,000; whole numbers or startup fails; `ceil(0.95 cap)` units a month; 0 leaves the provider
out). Built in with documented sources: data.go.kr ASOS 10,000 per key and KST day, AirKorea 500 per
key and KST day, Kakao 100,000 per key and UTC day, Google geocoder 322 per UTC day, WAQI
2,678,400,000 per month. Quota owners derive from keys (`server2-world-quota-v1` for VC and air).

R6. Endpoints are built in (`gateway::runtime::Builtins::production`). Tests build other values
through `Builtins`, `S3Settings::from_vars_at` and `GeocoderConfig::from_vars_at`; no variable
overrides an endpoint (legacy's test-only `GEOCODER_*_BASE_URL` are not read).

R7. Kept server2 variables: `SERVER2_GATEWAY_LEGACY_URL`, `SERVER2_NATIVE_FAMILIES`,
`SERVER2_WORLD_VERSIONS` (coexistence, removed with legacy retirement) and `SERVER2_S3_BUCKET`.

R8. Paseo `worktree.setup` copies `$PASEO_SOURCE_CHECKOUT_PATH/server2/.env` to `server2/.env`
when the branch has `server2/`: refuse a symlinked `server2`, keep an existing target, skip a
symlinked or missing source, install with mode 600, and ensure Git ignores it (local exclude
fallback, stop if still not ignored). No value is printed.

## Alternatives rejected

- Keep `SERVER2_*` keys/units: contradicts AK's decision.
- Locate `.env` from the build directory or the executable path: build-machine paths or target
  layouts differ; dotenv's default is the working directory.
- Endpoint variables for smokes: AK's rule forbids test overrides; the smokes run the test-only
  `loopback_server` example instead.
- `TWA_S3_WEATHER_DATA_BUCKET_NAME` as the bucket: it is the legacy weather-data bucket; AK listed
  the server2 raw-record bucket as a server2-only value. Reusing it remains an open question.

## Verification strategy

Red: `legacy_env_alone_builds_every_native_family` fails on the base (missing `SERVER2_*`
settings). Green: workspace tests (runtime configuration, dotenv parser, listener rules, binary
`.env` loading and precedence, quota helpers, S3 settings). Functional: release smokes with the new
names in empty working directories; the Paseo setup block in scratch repositories; an in-process
configuration check from the operator's `server2/.env` that prints names and booleans only.
